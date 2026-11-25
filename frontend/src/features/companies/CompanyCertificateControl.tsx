import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, CheckCircle2, FileBadge, X } from 'lucide-react';
import { api } from '../../api/client';

/** Chave comum das gravações do certificado: o modal usa para não fechar enquanto uma delas está em andamento. */
export const CERTIFICATE_MUTATION_KEY = ['fiscal-certificate-write'];

type Props = {
  companyId: string;
  /** CNPJ salvo no cadastro e o digitado no formulário: o certificado só pode ser enviado com o CNPJ já salvo. */
  savedTaxId: string | null | undefined;
  formTaxId: string;
  canManage: boolean;
  onDone: (message: string) => void;
};

const dateFormat = new Intl.DateTimeFormat('pt-BR');

/**
 * Certificado A1 no topo do cadastro: o botão abre o seletor de arquivo; escolhido o arquivo, aparece a senha.
 * Com certificado ativo, o botão fica esmaecido e o X ao lado desativa o certificado, liberando um novo envio.
 */
export function CompanyCertificateControl({ companyId, savedTaxId, formTaxId, canManage, onDone }: Props) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const certificate = useQuery({ queryKey: ['fiscal-certificate', companyId], queryFn: () => api.fiscalCertificate(companyId), enabled: !!companyId });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['fiscal-certificate', companyId] });
  const upload = useMutation({
    mutationKey: CERTIFICATE_MUTATION_KEY,
    mutationFn: () => api.uploadFiscalCertificate(companyId, file!, password),
    onSuccess: async () => { setFile(null); setPassword(''); await refresh(); onDone('Arquivo, senha e CNPJ do certificado conferidos.'); },
  });
  const remove = useMutation({
    mutationKey: CERTIFICATE_MUTATION_KEY,
    mutationFn: () => api.disableFiscalCertificate(companyId),
    onSuccess: async () => { await refresh(); onDone('Certificado desativado.'); },
  });
  const busy = upload.isPending || remove.isPending;
  const current = certificate.data;
  const cleanTaxId = formTaxId.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

  function pick() {
    setMessage(null); upload.reset();
    if (!savedTaxId || cleanTaxId !== savedTaxId) { setMessage('Salve o CNPJ da empresa antes de adicionar o certificado.'); return; }
    inputRef.current?.click();
  }
  function choose(selected: File | null) {
    if (inputRef.current) inputRef.current.value = '';
    if (!selected) return;
    if (!/\.(pfx|p12)$/i.test(selected.name)) { setMessage('Selecione um arquivo .pfx ou .p12.'); return; }
    setMessage(null); upload.reset(); setPassword(''); setFile(selected);
    window.setTimeout(() => passwordRef.current?.focus(), 0);
  }
  function submit() { if (file && password && !busy) upload.mutate(); }
  // A senha fica dentro do formulário da empresa: Enter envia o certificado, não o cadastro.
  function onPasswordKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') { event.preventDefault(); submit(); }
    if (event.key === 'Escape') { event.stopPropagation(); setFile(null); setPassword(''); }
  }
  function disable() { if (window.confirm('Remover o certificado desta empresa?')) remove.mutate(); }

  const error = message ?? (upload.isError ? errorText(upload.error, 'Falha ao cadastrar o certificado.')
    : remove.isError ? errorText(remove.error, 'Falha ao remover o certificado.')
    : certificate.isError ? 'Não foi possível consultar o certificado.' : null);

  return <div className="company-certificate-control">
    {current && <p className="company-certificate-control__status" data-expired={current.status === 'EXPIRED' || undefined}
      title={`CNPJ ${current.subjectTaxId} · válido até ${dateFormat.format(new Date(current.notAfter))}`}>
      {current.status === 'EXPIRED' ? <AlertTriangle size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}
      {current.status === 'EXPIRED' ? 'Certificado expirado' : 'Certificado adicionado'}
    </p>}
    <div className="company-certificate-control__main">
      <input ref={inputRef} type="file" accept=".pfx,.p12" hidden onChange={(event) => choose(event.target.files?.[0] ?? null)} />
      <button type="button" className="button button--secondary company-certificate-shortcut" onClick={pick}
        disabled={!canManage || !!current || busy || certificate.isPending} title={file ? file.name : undefined}>
        <FileBadge size={16} aria-hidden="true" /><span>{file ? file.name : 'Adicionar certificado'}</span>
      </button>
      {current && canManage && <button type="button" className="company-certificate-control__icon company-certificate-control__icon--remove" onClick={disable} disabled={busy} aria-label="Remover certificado" title="Remover"><X size={15} /></button>}
    </div>
    {file && !current && <div className="company-certificate-control__password">
      {/* new-password: evita o gerenciador de senhas do navegador preencher (e pintar) o campo. */}
      <input ref={passwordRef} type="password" autoComplete="new-password" aria-label="Senha do certificado" placeholder="Senha do certificado"
        value={password} onChange={(event) => { setPassword(event.target.value); upload.reset(); }} onKeyDown={onPasswordKey} disabled={busy} />
      <button type="button" className="company-certificate-control__icon company-certificate-control__icon--confirm" onClick={submit} disabled={!password || busy}
        aria-label={upload.isPending ? 'Validando certificado' : 'Adicionar certificado com esta senha'} title="Adicionar"><Check size={15} /></button>
      <button type="button" className="company-certificate-control__icon company-certificate-control__icon--remove" onClick={() => { setFile(null); setPassword(''); upload.reset(); }} disabled={busy}
        aria-label="Cancelar envio do certificado" title="Cancelar"><X size={15} /></button>
    </div>}
    {error && <p className="company-certificate-control__error" role="alert">{error}{certificate.isError && !message && <button type="button" onClick={() => certificate.refetch()}>Tentar novamente</button>}</p>}
  </div>;
}

const errorText = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
