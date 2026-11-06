import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, Download, Eye, LoaderCircle, RefreshCw, Replace, Send, ShieldCheck, Undo2, X } from 'lucide-react';
import { api } from '../../api/client';
import type { NfsePreviewInput } from '../../api/nfse.types';
import { DanfsePreview } from './DanfsePreview';
import { NfseEmissionHistory } from './NfseEmissionHistory';
import './nfse.css';

function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function NfseSaleActions({ companyId, saleId, saleVersion, disabled = false }: { companyId: string; saleId: string; saleVersion: number; disabled?: boolean }) {
  const [mode, setMode] = useState<'preview' | 'emit' | null>(null);
  const [error, setError] = useState('');
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ['nfse-state', companyId, saleId], queryFn: () => api.nfseState(companyId, saleId), refetchInterval: query => query.state.data?.inProgress ? 4000 : false });
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const canManage = ['OWNER', 'ADMIN'].includes(companies.data?.find(c => c.id === companyId)?.role ?? '');
  const discard = useMutation({ mutationFn: () => api.discardNfseSubstitution(companyId, state.data!.substitution!.documentId),
    onSuccess: () => { setError(''); void queryClient.invalidateQueries({ queryKey: ['nfse-state', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['nfse-emissions', companyId, saleId] }); },
    onError: cause => setError(cause instanceof Error ? cause.message : 'Não foi possível desistir da substituição.') });
  const substitution = state.data?.substitution;
  const emitLabel = state.data?.emitMode === 'SUBSTITUTION' ? 'Emitir substituta' : state.data?.emitMode == null && (state.data?.hasActiveDocuments || state.data?.inProgress) ? 'Ver NFS-e' : 'Emitir NFS-e';
  return <div className="nfse-sale-actions">
    {substitution && <div className="nfse-banner" role="status"><Replace size={17} /><p><strong>Substituição da NFS-e nº {substitution.number} em andamento.</strong><span>Corrija a venda e clique em “Emitir substituta”. A nota atual só é substituída quando a nova for autorizada.</span></p>
      {canManage && <button type="button" className="button button--secondary" disabled={discard.isPending} onClick={() => discard.mutate()}>{discard.isPending ? <LoaderCircle size={14} className="is-spinning" /> : <Undo2 size={14} />} Desistir</button>}</div>}
    {error && <p role="alert" className="nfse-alert">{error}</p>}
    <div><button type="button" className="button button--secondary" onClick={() => setMode('preview')} disabled={disabled}><Eye size={15} /> Pré-visualizar NFS-e</button>
      <button type="button" className="button button--primary" onClick={() => setMode('emit')} disabled={disabled}><Send size={15} /> {emitLabel}</button></div>
    {disabled && <small>Salve as alterações para usar os dados atualizados na nota.</small>}
    {mode && <NfseDialog key={`${companyId}:${saleId}`} companyId={companyId} saleId={saleId} saleVersion={saleVersion} mode={mode} onClose={() => setMode(null)} />}
  </div>;
}

function NfseDialog({ companyId, saleId, saleVersion, mode, onClose }: { companyId: string; saleId: string; saleVersion: number; mode: 'preview' | 'emit'; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [request, setRequest] = useState(() => ({ key: crypto.randomUUID(), input: { expectedSaleVersion: saleVersion } as NfsePreviewInput }));
  const [competence, setCompetence] = useState('');
  const [totalTax, setTotalTax] = useState('');
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const key = useRef<string | null>(null);
  const queryClient = useQueryClient();
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const canManage = ['OWNER', 'ADMIN'].includes(companies.data?.find(c => c.id === companyId)?.role ?? '');
  const preview = useQuery({ queryKey: ['nfse-preview', companyId, saleId, request.key], queryFn: () => api.previewNfse(companyId, saleId, request.input, request.key), staleTime: Infinity });
  const cancelling = (statuses: string[] | undefined) => !!statuses?.some(status => ['PENDING', 'READY', 'SENDING', 'UNKNOWN'].includes(status));
  const emissions = useQuery({ queryKey: ['nfse-emissions', companyId, saleId], queryFn: () => api.nfseEmissions(companyId, saleId),
    refetchInterval: query => query.state.data?.some(e => !['AUTHORIZED', 'REJECTED'].includes(e.status) || cancelling(e.items.map(item => item.document?.cancellation?.status ?? ''))) ? 4000 : false });
  const state = useQuery({ queryKey: ['nfse-state', companyId, saleId], queryFn: () => api.nfseState(companyId, saleId), refetchInterval: query => query.state.data?.inProgress ? 4000 : false });
  const emit = useMutation({ mutationFn: () => { key.current ??= crypto.randomUUID(); return api.emitNfse(companyId, saleId, preview.data!.id, key.current); },
    onSuccess: () => { setError(''); void queryClient.invalidateQueries({ queryKey: ['nfse-emissions', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['nfse-state', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['fiscal-series', companyId] }); },
    onError: cause => { setError(cause instanceof Error ? cause.message : 'Não foi possível solicitar a emissão.'); void emissions.refetch(); } });
  const resume = useMutation({ mutationFn: (id: string) => api.reconcileNfse(companyId, id), onSuccess: () => void emissions.refetch(), onError: cause => setError(cause instanceof Error ? cause.message : 'Não foi possível consultar o resultado.') });
  const close = useRef(onClose); close.current = onClose;
  const busy = useRef(false); busy.current = emit.isPending;
  useEffect(() => {
    const old = document.body.style.overflow;
    const focus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); if (!busy.current) close.current(); }
      if (event.key !== 'Tab') return;
      event.stopImmediatePropagation();
      const items = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]') ?? []).filter(e => e.getClientRects().length);
      const first = items[0], last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keyboard, true);
    return () => { document.body.style.overflow = old; document.removeEventListener('keydown', keyboard, true); focus?.focus(); };
  }, []);

  function refresh(event: FormEvent) {
    event.preventDefault(); key.current = null; emit.reset(); setError('');
    setRequest({ key: crypto.randomUUID(), input: { expectedSaleVersion: saleVersion, ...(competence ? { competence } : {}), ...(totalTax ? { simplesTotalTaxPercent: totalTax.replace(',', '.') } : {}) } });
  }
  async function savePdf() {
    if (!preview.data) return;
    setDownloading(true); setError('');
    try { download(await api.nfsePreviewPdf(companyId, preview.data.id), `previa-nfse-${preview.data.orderCode}.pdf`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível baixar a prévia.'); }
    finally { setDownloading(false); }
  }
  async function saveXml(id: string, number: string) {
    try { download(await api.nfseXml(companyId, id), `nfse-${number}.xml`); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível baixar o XML.'); }
  }
  const data = preview.data;
  const optionsChanged = !!data && (competence !== (data.input.competence ?? '') || totalTax.replace(',', '.') !== (data.input.simplesTotalTaxPercent ?? ''));
  const issues = data ? [...data.issues, ...(mode === 'emit' ? data.emissionIssues : [])].filter((issue, i, all) => all.findIndex(x => x.code === issue.code && x.message === issue.message) === i) : [];
  const canEmitNow = !!state.data?.emitMode;
  const substituting = state.data?.emitMode === 'SUBSTITUTION';
  const retrying = !substituting && !!emissions.data?.length;
  return <div className="nfse-backdrop" data-nfse-dialog onMouseDown={event => { if (event.target === event.currentTarget && !emit.isPending) onClose(); }}>
    <div className="nfse-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="nfse-title" tabIndex={-1}>
      <header><div><span>FISCAL / NOTA DE SERVIÇO</span><h2 id="nfse-title">{mode === 'emit' ? (substituting ? 'Emitir NFS-e substituta' : retrying ? 'Emitir NFS-e novamente' : 'Emitir NFS-e') : 'Pré-visualizar NFS-e'}{data ? ` · #${data.orderCode}` : ''}</h2></div><button type="button" onClick={onClose} aria-label="Fechar nota" disabled={emit.isPending}><X size={21} /></button></header>
      <div className="nfse-dialog__body">
        {preview.isPending ? <div className="nfse-loading" role="status"><LoaderCircle size={24} className="is-spinning" />Preparando a prévia da nota...</div> : preview.isError ? <div className="nfse-alert" role="alert"><AlertCircle size={18} /><div>{preview.error instanceof Error ? preview.error.message : 'Não foi possível gerar a prévia.'}<button type="button" onClick={() => void preview.refetch()}>Tentar novamente</button></div></div> : data && <>
          <div className="nfse-info"><ShieldCheck size={19} /><p><strong>{mode === 'emit' ? 'Confira os dados antes de confirmar.' : 'Esta é uma prévia, sem validade fiscal.'}</strong><span>A pré-visualização não envia dados ao governo nem reserva numeração. {data.environment === 'HOMOLOGATION' ? 'A série está configurada para homologação.' : data.environment === 'PRODUCTION' ? 'A série está em produção; o envio neste ambiente ainda não está disponível.' : 'Configure uma série padrão para emitir.'}</span></p></div>
          <form className="nfse-options" onSubmit={refresh}>
            <label>Competência da prestação<input type="date" value={competence} onChange={event => setCompetence(event.target.value)} disabled={emit.isPending} /><small>Vazia: utiliza a data de cada serviço ou da venda.</small></label>
            {data.simplesOption === '3' && <label>Total aproximado dos tributos do Simples (%)<input value={totalTax} onChange={event => setTotalTax(event.target.value)} inputMode="decimal" placeholder="Ex.: 6,00" pattern="[0-9]{1,2}([.,][0-9]{1,2})?" disabled={emit.isPending} /><small>Informe o percentual aplicável, conforme orientação contábil.</small></label>}
            <button type="submit" className="button button--secondary" disabled={emit.isPending}><RefreshCw size={14} /> Atualizar prévia</button>
          </form>
          {optionsChanged && <p className="nfse-alert" role="status">Atualize a prévia para aplicar os dados alterados antes de emitir.</p>}
          {data.stale && <p className="nfse-alert" role="alert">A venda foi alterada. Feche esta janela e reabra o pedido para gerar uma nova prévia.</p>}
          {issues.length > 0 && <section className="nfse-pendencies"><h3><AlertCircle size={17} /> Conferências antes da emissão</h3><ul>{issues.map((issue, i) => <li key={`${issue.code}:${i}`} className={issue.severity === 'WARNING' ? 'is-warning' : ''}>{issue.message}</li>)}</ul><nav><Link to="/empresa">Cadastro da empresa</Link><Link to="/Clientes">Cadastro do cliente</Link><Link to="/servicos">Cadastro do serviço</Link><Link to="/fiscal/series">Configurar série</Link></nav></section>}
          <DanfsePreview preview={data} />
        </>}
        {substituting && state.data?.substitution && <p className="nfse-info nfse-info--substitution" role="status"><ShieldCheck size={19} /><span>Esta emissão <strong>substitui a NFS-e nº {state.data.substitution.number}</strong>. A nota atual só será marcada como substituída quando a nova for autorizada.</span></p>}
        {state.data?.lockReason && !canEmitNow && state.data.hasActiveDocuments && <p className="nfse-info" role="status"><ShieldCheck size={19} /><span>{state.data.lockReason}</span></p>}
        {emissions.data && <NfseEmissionHistory companyId={companyId} saleId={saleId} emissions={emissions.data} state={state.data} canManage={canManage} resuming={resume.isPending} onResume={id => resume.mutate(id)} onXml={(id, number) => void saveXml(id, number)} onError={setError} />}
        {emissions.isError && <p role="alert" className="nfse-alert">Não foi possível consultar as emissões anteriores. <button type="button" onClick={() => void emissions.refetch()}>Tentar novamente</button></p>}
        {error && <p role="alert" className="nfse-alert">{error}</p>}
      </div>
      <footer className="nfse-dialog__footer"><button type="button" className="button button--secondary" onClick={onClose} disabled={emit.isPending}>Fechar</button>{data && <button type="button" className="button button--secondary" onClick={() => void savePdf()} disabled={downloading || optionsChanged}>{downloading ? <LoaderCircle size={15} className="is-spinning" /> : <Download size={15} />} Baixar prévia em PDF</button>}{mode === 'emit' && canEmitNow && <button type="button" className="button button--primary" disabled={!data?.canEmit || !canManage || emit.isPending || emissions.isPending || emissions.isError || state.isPending || optionsChanged} onClick={() => emit.mutate()}>{emit.isPending ? <LoaderCircle size={15} className="is-spinning" /> : <Send size={15} />} {substituting ? 'Confirmar substituição em homologação' : 'Confirmar emissão em homologação'}</button>}</footer>
    </div>
  </div>;
}
