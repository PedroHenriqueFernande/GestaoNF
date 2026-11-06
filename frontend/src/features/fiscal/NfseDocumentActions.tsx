import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Download, LoaderCircle, RefreshCw, Replace, Undo2 } from 'lucide-react';
import { api } from '../../api/client';
import type { NfseCancelInput, NfseDocument, NfseSaleState, NfseSubstitutionInput } from '../../api/nfse.types';

const CANCEL_REASONS: Array<[NfseCancelInput['reasonCode'], string]> = [['1', 'Erro na emissão'], ['2', 'Serviço não prestado'], ['9', 'Outros']];
const SUBSTITUTION_REASONS: Array<[NfseSubstitutionInput['reasonCode'], string]> = [
  ['99', 'Correção de dados da nota (outros)'], ['01', 'Desenquadramento do Simples Nacional'], ['02', 'Enquadramento no Simples Nacional'],
  ['03', 'Inclusão retroativa de imunidade ou isenção'], ['04', 'Exclusão retroativa de imunidade ou isenção'], ['05', 'Rejeição pelo tomador ou intermediário'],
];
const CANCELLATION_IN_PROGRESS = ['PENDING', 'READY', 'SENDING', 'UNKNOWN'];
const MIN = 15, MAX = 255;

export const documentStatusName = (document: NfseDocument) => document.status === 'CANCELLED' ? 'Cancelada' : document.status === 'SUBSTITUTED' ? 'Substituída'
  : document.cancellation && CANCELLATION_IN_PROGRESS.includes(document.cancellation.status) ? 'Cancelamento em andamento' : document.substitution ? 'Substituição aberta' : 'Autorizada';

type Panel = 'cancel' | 'substitute' | null;

export function NfseDocumentActions({ companyId, saleId, document, state, canManage, onXml, onError }: {
  companyId: string; saleId: string; document: NfseDocument; state: NfseSaleState | undefined; canManage: boolean;
  onXml: (id: string, number: string) => void; onError: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [cancelCode, setCancelCode] = useState<NfseCancelInput['reasonCode']>('1');
  const [substituteCode, setSubstituteCode] = useState<NfseSubstitutionInput['reasonCode']>('99');
  const [text, setText] = useState('');
  const key = useRef<string | null>(null);
  const refresh = () => { void queryClient.invalidateQueries({ queryKey: ['nfse-emissions', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['nfse-state', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['sale', companyId, saleId] }); };
  const fail = (cause: unknown, fallback: string) => onError(cause instanceof Error ? cause.message : fallback);
  const close = () => { setPanel(null); setText(''); key.current = null; };

  const cancel = useMutation({ mutationFn: () => { key.current ??= crypto.randomUUID(); return api.cancelNfse(companyId, document.id, key.current, { reasonCode: cancelCode, reasonText: text.trim() }); },
    onSuccess: () => { close(); onError(''); refresh(); }, onError: cause => fail(cause, 'Não foi possível solicitar o cancelamento.') });
  const substitute = useMutation({ mutationFn: () => api.openNfseSubstitution(companyId, document.id, { reasonCode: substituteCode, ...(text.trim() ? { reasonText: text.trim() } : {}) }),
    onSuccess: () => { close(); onError(''); refresh(); }, onError: cause => fail(cause, 'Não foi possível abrir a substituição.') });
  const discard = useMutation({ mutationFn: () => api.discardNfseSubstitution(companyId, document.id),
    onSuccess: () => { onError(''); refresh(); }, onError: cause => fail(cause, 'Não foi possível desistir da substituição.') });
  const reconcile = useMutation({ mutationFn: (eventId: string) => api.reconcileNfseCancellation(companyId, eventId),
    onSuccess: () => { onError(''); refresh(); }, onError: cause => fail(cause, 'Não foi possível consultar o cancelamento.') });

  const active = state?.activeDocuments.find(item => item.id === document.id);
  const cancelling = !!document.cancellation && CANCELLATION_IN_PROGRESS.includes(document.cancellation.status);
  const length = text.trim().length;
  const textValid = panel === 'cancel' ? length >= MIN && length <= MAX : substituteCode === '99' ? length >= MIN && length <= MAX : length === 0 || (length >= MIN && length <= MAX);
  const busy = cancel.isPending || substitute.isPending || discard.isPending || reconcile.isPending;
  const submit = (event: FormEvent) => { event.preventDefault(); if (panel === 'cancel') cancel.mutate(); else if (panel === 'substitute') substitute.mutate(); };
  const failed = document.cancellation?.status === 'REJECTED' ? document.cancellation : null;

  return <div className="nfse-document">
    <div className="nfse-document__head"><p>NFS-e nº {document.number}</p><span className={`nfse-chip nfse-chip--${document.status === 'AUTHORIZED' && !cancelling ? (document.substitution ? 'warning' : 'ok') : cancelling ? 'warning' : 'muted'}`}>{documentStatusName(document)}</span></div>
    <small>Chave: {document.accessKey}</small>
    {document.status === 'CANCELLED' && document.cancellation && <small>Motivo do cancelamento: {document.cancellation.reasonText}</small>}
    {failed && <p className="nfse-emission__error">Cancelamento recusado pelo ambiente nacional. A nota continua válida.{failed.lastError ? `\n${failed.lastError}` : ''}</p>}
    {document.substitution && <p className="nfse-document__note">Substituição aberta: corrija a venda e use “Emitir substituta”.</p>}
    <div className="nfse-document__actions">
      <button className="button button--secondary" type="button" onClick={() => onXml(document.id, document.number)}><Download size={14} /> Baixar XML autorizado</button>
      {canManage && document.status === 'AUTHORIZED' && !cancelling && <>
        {active?.canCancel && <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setPanel(panel === 'cancel' ? null : 'cancel'); setText(''); }}><Ban size={14} /> Cancelar NFS-e</button>}
        {active?.canSubstitute && <button className="button button--secondary" type="button" disabled={busy} onClick={() => { setPanel(panel === 'substitute' ? null : 'substitute'); setText(''); }}><Replace size={14} /> Substituir NFS-e</button>}
        {document.substitution && <button className="button button--secondary" type="button" disabled={busy} onClick={() => discard.mutate()}>{discard.isPending ? <LoaderCircle size={14} className="is-spinning" /> : <Undo2 size={14} />} Desistir da substituição</button>}
      </>}
      {canManage && cancelling && document.cancellation?.status === 'UNKNOWN' && <button className="button button--secondary" type="button" disabled={busy} onClick={() => reconcile.mutate(document.cancellation!.id)}><RefreshCw size={14} /> Consultar resultado do cancelamento</button>}
    </div>
    {panel && <form className="nfse-action-form" onSubmit={submit}>
      {panel === 'cancel' ? <>
        <p>O cancelamento é enviado ao ambiente nacional e <strong>não pode ser desfeito</strong>. A venda e o financeiro não são alterados.</p>
        <label>Motivo<select value={cancelCode} onChange={event => setCancelCode(event.target.value as NfseCancelInput['reasonCode'])} disabled={busy}>{CANCEL_REASONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      </> : <>
        <p>A venda ficará editável. Corrija o que for preciso e emita a nota substituta; a nota atual só é substituída quando a nova for autorizada.</p>
        <p><strong>Para MEI e ME/EPP, a competência, o tomador e o valor do serviço não podem mudar</strong> na substituição. Se o erro estiver em um deles, cancele a nota e emita outra.</p>
        <label>Motivo<select value={substituteCode} onChange={event => setSubstituteCode(event.target.value as NfseSubstitutionInput['reasonCode'])} disabled={busy}>{SUBSTITUTION_REASONS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}</select></label>
      </>}
      <label>Justificativa{panel === 'substitute' && substituteCode !== '99' ? ' (opcional)' : ''}<textarea value={text} maxLength={MAX} rows={3} onChange={event => setText(event.target.value)} disabled={busy} aria-describedby={`nfse-count-${document.id}`} /></label>
      <small id={`nfse-count-${document.id}`} className={textValid ? '' : 'is-invalid'}>{length}/{MAX} caracteres{!textValid ? ` · mínimo de ${MIN}` : ''}</small>
      <div><button type="button" className="button button--secondary" onClick={close} disabled={busy}>Voltar</button>
        <button type="submit" className={`button ${panel === 'cancel' ? 'button--danger' : 'button--primary'}`} disabled={!textValid || busy}>{busy ? <LoaderCircle size={14} className="is-spinning" /> : panel === 'cancel' ? <Ban size={14} /> : <Replace size={14} />} {panel === 'cancel' ? 'Confirmar cancelamento' : 'Abrir substituição'}</button></div>
    </form>}
  </div>;
}
