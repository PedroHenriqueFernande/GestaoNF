import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, CheckCircle2, Download, Eye, LoaderCircle, RefreshCw, Send, ShieldCheck, X } from 'lucide-react';
import { api } from '../../api/client';
import type { NfsePreviewInput } from '../../api/nfse.types';
import { DanfsePreview } from './DanfsePreview';
import './nfse.css';

const statusName: Record<string, string> = { RESERVED: 'Preparando', READY: 'Pronta para envio', SENDING: 'Enviando', UNKNOWN: 'Consultando resultado', REJECTED: 'Rejeitada', AUTHORIZED: 'Autorizada', PROCESSING: 'Processando', PARTIAL: 'Parcialmente concluída' };
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }

export function NfseSaleActions({ companyId, saleId, saleVersion, disabled = false }: { companyId: string; saleId: string; saleVersion: number; disabled?: boolean }) {
  const [mode, setMode] = useState<'preview' | 'emit' | null>(null);
  return <div className="nfse-sale-actions">
    <div><button type="button" className="button button--secondary" onClick={() => setMode('preview')} disabled={disabled}><Eye size={15} /> Pré-visualizar NFS-e</button>
      <button type="button" className="button button--primary" onClick={() => setMode('emit')} disabled={disabled}><Send size={15} /> Emitir NFS-e</button></div>
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
  const emissions = useQuery({ queryKey: ['nfse-emissions', companyId, saleId], queryFn: () => api.nfseEmissions(companyId, saleId), refetchInterval: query => query.state.data?.some(e => !['AUTHORIZED', 'REJECTED'].includes(e.status)) ? 4000 : false });
  const emit = useMutation({ mutationFn: () => { key.current ??= crypto.randomUUID(); return api.emitNfse(companyId, saleId, preview.data!.id, key.current); },
    onSuccess: () => { setError(''); void queryClient.invalidateQueries({ queryKey: ['nfse-emissions', companyId, saleId] }); void queryClient.invalidateQueries({ queryKey: ['fiscal-series', companyId] }); },
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
  const alreadyRequested = !!emissions.data?.length;
  return <div className="nfse-backdrop" data-nfse-dialog onMouseDown={event => { if (event.target === event.currentTarget && !emit.isPending) onClose(); }}>
    <div className="nfse-dialog" ref={panel} role="dialog" aria-modal="true" aria-labelledby="nfse-title" tabIndex={-1}>
      <header><div><span>FISCAL / NOTA DE SERVIÇO</span><h2 id="nfse-title">{mode === 'emit' ? 'Emitir NFS-e' : 'Pré-visualizar NFS-e'}{data ? ` · #${data.orderCode}` : ''}</h2></div><button type="button" onClick={onClose} aria-label="Fechar nota" disabled={emit.isPending}><X size={21} /></button></header>
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
        {emissions.data?.map(emission => <section className="nfse-emission" key={emission.id}><h3><CheckCircle2 size={18} /> Emissão em {emission.environment === 'HOMOLOGATION' ? 'homologação' : 'produção'} <span>{statusName[emission.status] || emission.status}</span></h3>{emission.items.map(item => <div className="nfse-emission__item" key={item.id}><div><strong>DPS {item.seriesNumber}/{item.number}</strong><span>{statusName[item.status] || item.status}</span></div>{item.document && <><p>NFS-e nº {item.document.number}</p><small>Chave: {item.document.accessKey}</small><button className="button button--secondary" type="button" onClick={() => void saveXml(item.document!.id, item.document!.number)}><Download size={14} /> Baixar XML autorizado</button></>}{item.lastError && <p className="nfse-emission__error">{item.lastError}</p>}{canManage && !['AUTHORIZED', 'REJECTED'].includes(item.status) && <button className="button button--secondary" type="button" disabled={resume.isPending} onClick={() => resume.mutate(item.id)}><RefreshCw size={14} />{item.status === 'UNKNOWN' ? 'Consultar resultado' : 'Retomar processamento'}</button>}</div>)}<details><summary>Histórico da emissão</summary>{emission.events.map(event => <p key={event.id}>{new Date(event.createdAt).toLocaleString('pt-BR')} · {event.message}</p>)}</details></section>)}
        {emissions.isError && <p role="alert" className="nfse-alert">Não foi possível consultar as emissões anteriores. <button type="button" onClick={() => void emissions.refetch()}>Tentar novamente</button></p>}
        {error && <p role="alert" className="nfse-alert">{error}</p>}
      </div>
      <footer className="nfse-dialog__footer"><button type="button" className="button button--secondary" onClick={onClose} disabled={emit.isPending}>Fechar</button>{data && <button type="button" className="button button--secondary" onClick={() => void savePdf()} disabled={downloading || optionsChanged}>{downloading ? <LoaderCircle size={15} className="is-spinning" /> : <Download size={15} />} Baixar prévia em PDF</button>}{mode === 'emit' && !alreadyRequested && <button type="button" className="button button--primary" disabled={!data?.canEmit || !canManage || emit.isPending || emissions.isPending || emissions.isError || optionsChanged} onClick={() => emit.mutate()}>{emit.isPending ? <LoaderCircle size={15} className="is-spinning" /> : <Send size={15} />} Confirmar emissão em homologação</button>}</footer>
    </div>
  </div>;
}
