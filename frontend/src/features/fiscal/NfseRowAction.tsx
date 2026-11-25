import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, LoaderCircle, Send } from 'lucide-react';
import { api, type Sale } from '../../api/client';
import type { PermissionView } from '../permissions/usePermissions';
import { NfseDialog, nfsePermissions } from './NfseSaleActions';
import './nfse.css';

const message = (cause: unknown, fallback: string) => cause instanceof Error && cause.message ? cause.message : fallback;

/**
 * Botão de NFS-e da linha do Portal de Serviços: emite direto da lista e, autorizada a nota, vira "Ver nota".
 * A emissão não passa pela tela de prévia: o servidor exige o retrato fiscal que ela grava, então ele é gerado em
 * segundo plano e enviado na mesma ação. Pendências bloqueantes voltam como erro da emissão e aparecem no aviso.
 */
export function NfseRowAction({ sale, access, onNotice }: { sale: Sale; access: Pick<PermissionView, 'can'>; onNotice: (text: string) => void }) {
  const { companyId, id: saleId, orderCode } = sale;
  const queryClient = useQueryClient();
  const nfse = nfsePermissions(access);
  const [dialog, setDialog] = useState<'preview' | 'history' | null>(null);
  /** Momento em que a emissão foi aceita; só um estado buscado depois dele diz o resultado. */
  const [sentAt, setSentAt] = useState<number | null>(null);
  const state = useQuery({ queryKey: ['nfse-state', companyId, saleId], queryFn: () => api.nfseState(companyId, saleId), enabled: sale.status === 'CONFIRMED', staleTime: 30_000,
    refetchInterval: query => query.state.data?.inProgress ? 4000 : false });
  const refresh = () => { for (const key of ['nfse-state', 'nfse-emissions']) void queryClient.invalidateQueries({ queryKey: [key, companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['fiscal-series', companyId] }); };

  const emit = useMutation({
    mutationFn: async () => {
      const preview = await api.previewNfse(companyId, saleId, { expectedSaleVersion: sale.version }, crypto.randomUUID());
      await api.emitNfse(companyId, saleId, preview.id, crypto.randomUUID());
    },
    onSuccess: () => { setSentAt(Date.now()); refresh(); },
    onError: cause => { onNotice(`NFS-e do pedido #${orderCode} não emitida: ${message(cause, 'tente novamente.').replace(/\s*\n\s*/g, '; ')}`); refresh(); },
  });

  useEffect(() => {
    const data = state.data;
    if (sentAt === null || !data || state.dataUpdatedAt <= sentAt || data.inProgress) return;
    setSentAt(null);
    if (data.hasActiveDocuments && data.emitMode === null) { onNotice(`NFS-e do pedido #${orderCode} autorizada.`); return; }
    const fallback = `A NFS-e do pedido #${orderCode} não foi autorizada. Abra o pedido para ver o motivo.`;
    api.nfseEmissions(companyId, saleId)
      .then(list => { const reason = list.at(-1)?.items.find(item => item.lastError)?.lastError; onNotice(reason ? `A NFS-e do pedido #${orderCode} não foi autorizada: ${reason}` : fallback); })
      .catch(() => onNotice(fallback));
  }, [sentAt, state.data, state.dataUpdatedAt, companyId, saleId, orderCode, onNotice]);

  if (sale.status !== 'CONFIRMED' || !state.data) return null;
  const busy = emit.isPending || sentAt !== null || state.data.inProgress;
  const canIssue = nfse.issue && state.data.emitMode === 'ISSUE';
  /** Prévia é opcional e só consulta: não reserva numeração nem condiciona a emissão. */
  const canPreview = (nfse.issue || nfse.correct) && state.data.emitMode === 'ISSUE' && !busy;
  const label = `NFS-e do pedido #${orderCode}`;
  let button;
  /** Sem nota ativa o andamento é a emissão; com nota, é um cancelamento ou substituição em curso. */
  const busyText = emit.isPending || sentAt !== null || !state.data.hasActiveDocuments ? 'Emitindo' : 'Processando';
  if (busy) button = <button type="button" className="nfse-row-action is-busy" disabled aria-label={`${busyText} ${label}`}><LoaderCircle size={14} className="nfse-row-action__spin" aria-hidden="true" /> {busyText}…</button>;
  else if (canIssue) button = <button type="button" className="nfse-row-action nfse-row-action--emit" onClick={() => emit.mutate()} aria-label={`Emitir ${label}`}><Send size={13} aria-hidden="true" /> Emitir NFS-e</button>;
  else if (state.data.hasActiveDocuments) button = <button type="button" className="nfse-row-action" onClick={() => setDialog('history')} aria-label={`Ver ${label}`}><FileText size={13} aria-hidden="true" /> Ver nota</button>;
  else button = null;
  if (!button && !canPreview) return null;
  // stopPropagation: o clique no botão ou no diálogo não pode abrir a linha da tabela (eventos do portal sobem pela árvore React).
  return <div className="nfse-row" onClick={event => event.stopPropagation()}>
    {canPreview && <button type="button" className="nfse-row-action nfse-row-action--preview" onClick={() => setDialog('preview')} aria-label={`Prévia da ${label}`}><Eye size={13} aria-hidden="true" /> Prévia NFS-e</button>}
    {button}
    {dialog && createPortal(<NfseDialog companyId={companyId} saleId={saleId} saleVersion={sale.version} mode={dialog} nfse={nfse} onClose={() => { setDialog(null); refresh(); }} />, document.body)}
  </div>;
}
