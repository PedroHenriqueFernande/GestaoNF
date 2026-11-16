import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ImagePlus, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError, type Company, type CompanyLogoMime, type CompanyProfile } from '../../api/client';
import { putSignedUpload } from '../../api/signed-upload';
import { CompanyLogo, COMPANY_LOGOS_KEY } from '../../components/CompanyLogo';
import './company-logo.css';

const LOGO_TYPES: readonly CompanyLogoMime[] = ['image/jpeg', 'image/png', 'image/webp'];
const LOGO_MAX_BYTES = 5 * 1024 * 1024;
export type LogoSelection = { file: File; key: string };
type Step = { selection: LogoSelection } | { fileId: string };
type Status =
  | { kind: 'idle'; message?: string }
  | { kind: 'uploading'; progress: number }
  | { kind: 'processing' }
  | { kind: 'applying' }
  | { kind: 'error'; message: string; retry: Step | null };
type Props =
  | { mode: 'create'; pending: LogoSelection | null; onPendingChange: (selection: LogoSelection | null) => void }
  | { mode: 'edit'; company: Company | undefined; editable: boolean; initialSelection?: LogoSelection | null };

/** Pré-checagem local; o servidor continua sendo a autoridade (assinatura, pixels, dimensões). */
function pickLogo(file: File): LogoSelection | string {
  if (!LOGO_TYPES.includes(file.type as CompanyLogoMime)) return 'Use uma imagem JPEG, PNG ou WebP.';
  if (file.size > LOGO_MAX_BYTES) return 'A imagem deve ter até 5 MB.';
  return { file, key: crypto.randomUUID() };
}

function applyToCache(client: QueryClient, profile: CompanyProfile) {
  // Não grava ['company', id]: o formulário do modal é reiniciado quando esse dado muda e perderia edições não salvas.
  client.setQueryData<Company[]>(['companies'], previous => previous?.map(item => item.id === profile.id ? { ...item, logoId: profile.logoId } : item));
  void client.invalidateQueries({ queryKey: ['company', profile.id], refetchType: 'none' });
  void client.invalidateQueries({ queryKey: ['companies'] });
  void client.invalidateQueries({ queryKey: COMPANY_LOGOS_KEY });
}

function useObjectUrl(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) { setUrl(null); return; }
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

export function CompanyLogoField(props: Props) {
  const client = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const company = props.mode === 'edit' ? props.company : undefined;
  const initial = props.mode === 'edit' ? props.initialSelection ?? null : null;
  const [selection, setSelection] = useState<LogoSelection | null>(initial);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const busy = status.kind === 'uploading' || status.kind === 'processing' || status.kind === 'applying';
  const preview = useObjectUrl((props.mode === 'create' ? props.pending : status.kind === 'idle' ? null : selection)?.file ?? null);

  async function send(companyId: string, step: Step, controller: AbortController) {
    const active = abortRef.current;
    if (busyRef.current && active && active !== controller && !active.signal.aborted) return; // clique repetido
    abortRef.current = controller; busyRef.current = true;
    const update = (value: Status) => { if (!controller.signal.aborted) setStatus(value); };
    let fileId = 'fileId' in step ? step.fileId : undefined;
    try {
      if ('selection' in step) {
        const { file, key } = step.selection;
        update({ kind: 'uploading', progress: 0 });
        const reservation = await api.beginCompanyLogoUpload(companyId, { mimeType: file.type as CompanyLogoMime, sizeBytes: file.size }, key);
        // O abort cancela só o envio ao R2; finalizar e aplicar seguem mesmo se o modal fechar.
        if (reservation.upload) await putSignedUpload(file, reservation.upload, progress => update({ kind: 'uploading', progress }), controller.signal);
        update({ kind: 'processing' });
        fileId = (await api.completeCompanyLogoUpload(companyId, reservation.file.id)).file.id;
      }
      update({ kind: 'applying' });
      applyToCache(client, await api.setCompanyLogo(companyId, fileId!));
      if (!controller.signal.aborted) { setSelection(null); setStatus({ kind: 'idle', message: 'Foto atualizada.' }); }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') return;
      const code = cause instanceof ApiError ? cause.status : 0;
      const restart = code === 400 || code === 410;
      // Conteúdo recusado ou prazo vencido: a próxima tentativa precisa de nova reserva (nova chave).
      if (restart && 'selection' in step) setSelection(current => current?.key === step.selection.key ? { ...current, key: crypto.randomUUID() } : current);
      // A tentativa nasce do próprio passo: `selection` (estado) ainda é a do render anterior quando choose() chama send().
      const retry: Step | null = code === 400 && !fileId ? null : fileId && !restart ? { fileId } : 'selection' in step ? { selection: step.selection } : selection ? { selection } : null;
      const message = cause instanceof Error ? cause.message : 'Não foi possível enviar a foto.';
      // O aviso de "empresa cadastrada" só vale para a foto escolhida no cadastro, não para trocas posteriores.
      const fromSignup = 'selection' in step && !!initial && step.selection.key === initial.key;
      update({ kind: 'error', retry, message: fromSignup ? `A empresa foi cadastrada, mas a foto não foi enviada. ${message}` : message });
    } finally { if (abortRef.current === controller) busyRef.current = false; }
  }

  useEffect(() => () => abortRef.current?.abort(), []);
  const companyId = company?.id;
  useEffect(() => {
    // Continuação do cadastro: a empresa acabou de ser criada com uma foto escolhida.
    // Em StrictMode o efeito roda duas vezes; a 1ª execução é abortada e a reserva é idempotente pela mesma chave.
    if (!initial || !companyId) return;
    const controller = new AbortController();
    void send(companyId, { selection: initial }, controller);
    return () => controller.abort();
  }, [initial, companyId]);

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || busy) return;
    const picked = pickLogo(file);
    if (typeof picked === 'string') { setStatus({ kind: 'error', message: picked, retry: null }); return; }
    if (props.mode === 'create') { props.onPendingChange(picked); setStatus({ kind: 'idle' }); return; }
    if (!company) return;
    setSelection(picked);
    void send(company.id, { selection: picked }, new AbortController());
  }

  function retry() {
    if (status.kind !== 'error' || !status.retry || !company) return;
    const step = 'selection' in status.retry && selection ? { selection } : status.retry;
    void send(company.id, step, new AbortController());
  }

  async function remove() {
    if (!company || busyRef.current) return;
    const controller = new AbortController();
    abortRef.current = controller; busyRef.current = true;
    setStatus({ kind: 'applying' });
    try {
      applyToCache(client, await api.setCompanyLogo(company.id, null));
      if (!controller.signal.aborted) setStatus({ kind: 'idle', message: 'Foto removida.' });
    } catch (cause) {
      if (!controller.signal.aborted) setStatus({ kind: 'error', message: cause instanceof Error ? cause.message : 'Não foi possível remover a foto.', retry: null });
    } finally { if (abortRef.current === controller) busyRef.current = false; }
  }

  const statusText = status.kind === 'uploading' ? `Enviando foto… ${status.progress}%` : status.kind === 'processing' ? 'Processando a imagem…'
    : status.kind === 'applying' ? 'Aplicando a foto…' : status.kind === 'idle' ? status.message ?? '' : '';
  const canEdit = props.mode === 'create' || props.editable;
  const chooseLabel = props.mode === 'create' ? (props.pending ? 'Trocar foto' : 'Escolher foto') : company?.logoId ? 'Trocar foto' : 'Enviar foto';

  return <div className="company-logo-field">
    <div className="company-form__mark company-logo-field__image">
      {preview ? <img src={preview} alt="Prévia da foto selecionada" /> : <CompanyLogo company={company} className="company-logo-field__logo" />}
    </div>
    {canEdit && <div className="company-logo-field__actions">
      <input ref={inputRef} type="file" accept={LOGO_TYPES.join(',')} hidden onChange={choose} />
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => inputRef.current?.click()}><ImagePlus size={15} aria-hidden="true" />{chooseLabel}</button>
      {props.mode === 'create' && props.pending && <button type="button" className="button button--secondary" onClick={() => props.onPendingChange(null)}><Trash2 size={15} aria-hidden="true" />Remover seleção</button>}
      {props.mode === 'edit' && company?.logoId && <button type="button" className="button button--secondary" disabled={busy} onClick={() => void remove()}><Trash2 size={15} aria-hidden="true" />Remover foto</button>}
    </div>}
    {canEdit && <p className="company-logo-field__hint">JPEG, PNG ou WebP, até 5 MB, mínimo 128 × 128 px. Imagens não quadradas são recortadas no centro.{props.mode === 'create' ? ' A foto é enviada logo após cadastrar a empresa.' : ''}</p>}
    <p className="company-logo-field__status" role="status" aria-live="polite">{statusText}</p>
    {status.kind === 'error' && <div className="inline-error" role="alert">{status.message}{status.retry && <button type="button" onClick={retry}><RotateCcw size={14} aria-hidden="true" />Tentar novamente</button>}</div>}
  </div>;
}
