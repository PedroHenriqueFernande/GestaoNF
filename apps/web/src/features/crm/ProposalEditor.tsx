import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertCircle, ArrowRight, Check, Copy, Download, FileText, History, Plus, Send, Trash2, X } from 'lucide-react';
import { api, type ProposalDetail, type ProposalInput, type ProposalItemInput, type ProposalPrefill, type ProposalResult, type Service } from '../../api/client';
import { dateOnly, money, normalizeMoney, shortDateTime } from './crm-utils';
import { QuickServiceModal } from './QuickServiceModal';

export type ProposalSource = { id: string } | { opportunityId: string } | { customerId: string };
type Row = { key: string; serviceId: string; quantity: string; unitPrice: string; discountType: 'AMOUNT' | 'PERCENT'; discountInput: string; description: string };
type Draft = { title: string; commercialDescription: string; paymentTerms: string; notes: string; terms: string; validUntil: string; items: Row[]; customerMode: 'NEW' | 'EXISTING'; customerId: string; customerKind: 'PF' | 'PJ' | ''; customerName: string; customerTaxId: string; customerEmail: string; customerPhone: string; createOpportunity: boolean; contactId: string };
const emptyRow = (): Row => ({ key: crypto.randomUUID(), serviceId: '', quantity: '1', unitPrice: '0,00', discountType: 'AMOUNT', discountInput: '0,00', description: '' });
const pt = (value: string | null | undefined) => value ? value.replace('.', ',') : '0,00';
const text = (value: string) => value.trim() || null;
function fromPrefill(data: ProposalPrefill): Draft {
  const customer = data.customer;
  return { title: data.opportunity?.title ?? '', commercialDescription: data.interestDescription ?? '', paymentTerms: '', notes: '', terms: '', validUntil: '',
    items: data.suggestedItems?.length ? data.suggestedItems.map(item => ({ key: crypto.randomUUID(), serviceId: item.serviceId, quantity: String(Number(item.quantity)), unitPrice: pt(item.unitPrice), discountType: item.discountType, discountInput: pt(item.discountInput), description: data.service?.description ?? '' })) : [emptyRow()],
    customerMode: customer ? 'EXISTING' : 'NEW', customerId: customer?.id ?? '', customerKind: data.customerDraft?.kind ?? '', customerName: data.customerDraft?.name ?? customer?.name ?? '', customerTaxId: data.customerDraft?.taxId ?? '', customerEmail: data.customerDraft?.email ?? '', customerPhone: data.customerDraft?.phone ?? '', createOpportunity: !data.opportunity, contactId: data.contacts?.length === 1 ? data.contacts[0].id : '' };
}
function fromDetail(data: ProposalDetail): Draft {
  return { title: data.title, commercialDescription: data.commercialDescription ?? '', paymentTerms: data.paymentTerms ?? '', notes: data.notes ?? '', terms: data.terms ?? '', validUntil: data.validUntil ?? '', customerMode: 'EXISTING', customerId: data.customerId, customerKind: 'PF', customerName: data.recipientName, customerTaxId: data.recipientTaxId ?? '', customerEmail: data.recipientEmail ?? '', customerPhone: '', createOpportunity: false, contactId: data.contactId,
    items: data.items.map(item => ({ key: item.id, serviceId: item.serviceId, quantity: String(Number(item.quantity)), unitPrice: pt(item.unitPrice), discountType: item.discountType, discountInput: pt(item.discountInput), description: item.descriptionSnapshot ?? '' })) };
}
function payloadRows(items: Row[]): ProposalItemInput[] {
  if (!items.length || items.length > 100) throw new Error('Adicione entre 1 e 100 serviços.');
  return items.map((item) => {
    const quantity = Number(item.quantity.replace(',', '.'));
    const unitPrice = normalizeMoney(item.unitPrice), discountInput = normalizeMoney(item.discountInput);
    if (!item.serviceId) throw new Error('Selecione um serviço em cada linha.');
    if (!/^(?:0|[1-9]\d{0,10})(?:[.,]\d{1,4})?$/.test(item.quantity) || !Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantidade inválida. Use até 4 casas decimais.');
    if (!unitPrice || !discountInput) throw new Error('Informe preços e descontos válidos.');
    if (item.discountType === 'PERCENT' && Number(discountInput) > 100) throw new Error('O desconto percentual não pode superar 100%.');
    if (item.discountType === 'AMOUNT' && Number(discountInput) > Math.round(quantity * Number(unitPrice) * 100) / 100) throw new Error('O desconto em reais não pode superar o valor bruto do item.');
    return { serviceId: item.serviceId, quantity: quantity.toFixed(4), unitPrice, discountType: item.discountType, discountInput, description: text(item.description) };
  });
}
const actions: Record<string, string> = { CREATED: 'Proposta criada', UPDATED: 'Rascunho atualizado', SENT: 'Envio registrado', ACCEPTED: 'Aceite registrado', DECLINED: 'Recusa registrada', CONVERTED: 'Pedido criado' };

export function ProposalEditor({ companyId, source, onClose, onSaved }: { companyId: string; source: ProposalSource; onClose: () => void; onSaved: (id: string, message: string) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const id = 'id' in source ? source.id : null;
  const detail = useQuery({ queryKey: ['proposal', companyId, id], queryFn: () => api.proposal(companyId, id!), enabled: !!id });
  const prefill = useQuery({ queryKey: ['proposal-prefill', companyId, source], queryFn: () => api.proposalPrefill(companyId, source as { opportunityId?: string; customerId?: string }), enabled: !id });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(!id);
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);
  const [createdServices, setCreatedServices] = useState<Service[]>([]);
  const [serviceSearch, setServiceSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'NONE' | 'DECLINE' | 'DUPLICATE' | 'HISTORY'>('NONE');
  const [reason, setReason] = useState('');
  const [duplicateDate, setDuplicateDate] = useState('');
  const services = useQuery({ queryKey: ['crm-services', companyId, serviceSearch], queryFn: () => api.services(companyId, { search: serviceSearch, status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId });
  const history = useQuery({ queryKey: ['proposal-history', companyId, id], queryFn: () => api.proposalHistory(companyId, id!), enabled: !!id && panel === 'HISTORY' });
  const loaded = id ? detail.data : prefill.data;
  useEffect(() => { if (!loaded || draft) return; setDraft(id ? fromDetail(loaded as ProposalDetail) : fromPrefill(loaded as ProposalPrefill)); }, [loaded, draft, id]);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !quickServiceOpen) onClose(); }; document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close); }, [onClose, quickServiceOpen]);
  const current = detail.data;
  const candidates = prefill.data?.customerCandidates ?? [];
  const availableServices = useMemo(() => {
    const map = new Map<string, Service>();
    if (prefill.data?.service) map.set(prefill.data.service.id, prefill.data.service);
    services.data?.items.forEach(service => map.set(service.id, service));
    createdServices.forEach(service => map.set(service.id, service));
    return [...map.values()];
  }, [services.data, prefill.data, createdServices]);
  const totals = useMemo(() => {
    let gross = 0, discount = 0;
    for (const item of draft?.items ?? []) {
      const amount = Number(item.quantity.replace(',', '.')) * Number(normalizeMoney(item.unitPrice) ?? 0);
      const input = Number(normalizeMoney(item.discountInput) ?? 0);
      if (Number.isFinite(amount)) { gross += amount; discount += item.discountType === 'PERCENT' ? Math.round(amount * input) / 100 : input; }
    }
    return { gross, discount, total: Math.max(0, gross - discount) };
  }, [draft?.items]);
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(valueDraft => valueDraft ? { ...valueDraft, [key]: value } : valueDraft);
  const updateRow = (key: string, change: Partial<Row>) => setDraft(value => value ? { ...value, items: value.items.map(row => row.key === key ? { ...row, ...change } : row) } : value);
  const refresh = async () => { await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['proposals', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm-opportunities', companyId] })]); };
  const save = useMutation({ mutationFn: async () => {
    if (!draft) throw new Error('Aguarde o carregamento da proposta.');
    if (!draft.title.trim()) throw new Error('Informe o título da proposta.');
    const items = payloadRows(draft.items);
    const common = { title: draft.title.trim(), commercialDescription: text(draft.commercialDescription), paymentTerms: text(draft.paymentTerms), notes: text(draft.notes), terms: text(draft.terms), validUntil: draft.validUntil || null, items };
    if (id) return api.updateProposal(companyId, id, { ...common, expectedVersion: current!.version });
    const input: ProposalInput = { ...common };
    if ('opportunityId' in source) input.opportunityId = source.opportunityId;
    else if ('customerId' in source) {
      input.customerId = source.customerId;
      input.createOpportunity = true;
      if ((prefill.data?.contacts?.length ?? 0) > 1) { if (!draft.contactId) throw new Error('Selecione o contato deste cliente.'); input.contactId = draft.contactId; }
    }
    if ('opportunityId' in source && !prefill.data?.customer) {
      if (draft.customerMode === 'EXISTING') { if (!draft.customerId) throw new Error('Selecione um cliente cadastrado.'); input.customerId = draft.customerId; }
      else { if (!draft.customerKind) throw new Error('Selecione se o cliente é pessoa física ou jurídica.'); if (!draft.customerName.trim()) throw new Error('Informe o nome do cliente que será cadastrado.'); input.newCustomer = { kind: draft.customerKind, name: draft.customerName.trim(), taxId: text(draft.customerTaxId), email: text(draft.customerEmail), phone: text(draft.customerPhone) }; }
    }
    return api.createProposal(companyId, input, crypto.randomUUID());
  }, onSuccess: async (result) => { setError(''); if (id) { await refresh(); setDraft(null); setEditing(false); setNotice('Rascunho salvo.'); } else onSaved(result.proposalId, 'Proposta criada e cliente vinculado.'); }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a proposta.') });
  const command = useMutation({ mutationFn: async (input: { action: 'send' | 'accept' | 'decline' | 'duplicate' | 'convert'; reason?: string; validUntil?: string | null }) => {
    if (!current) throw new Error('Proposta indisponível.');
    return api.proposalAction(companyId, current.id, input.action, { expectedVersion: current.version, ...(input.action === 'decline' ? { reason: text(input.reason ?? '') } : {}), ...(input.action === 'duplicate' ? { validUntil: input.validUntil ?? null } : {}) }, crypto.randomUUID());
  }, onSuccess: async (result: ProposalResult, variables) => {
    setPanel('NONE'); setReason(''); setError('');
    if (variables.action === 'duplicate') return onSaved(result.proposalId, 'Nova versão criada como rascunho.');
    await refresh();
    if (variables.action === 'convert' && result.reviewUrl) { navigate(result.reviewUrl); return; }
    setNotice(variables.action === 'send' ? 'Envio registrado. Compartilhe o PDF com o cliente.' : variables.action === 'accept' ? 'Aceite registrado.' : 'Recusa registrada.');
  }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.') });
  const pdf = useMutation({ mutationFn: () => api.proposalPdf(companyId, id!), onSuccess: (blob) => { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${current?.proposalCode ?? 'proposta'}.pdf`; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o PDF.') });
  const busy = save.isPending || command.isPending || pdf.isPending;
  function submit(event: FormEvent) { event.preventDefault(); setError(''); save.mutate(); }
  function action(value: 'send' | 'accept' | 'decline' | 'duplicate' | 'convert') { setError(''); command.mutate({ action: value, ...(value === 'decline' ? { reason } : {}), ...(value === 'duplicate' ? { validUntil: duplicateDate || null } : {}) }); }
  return <div className="proposal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}><section className="proposal-dialog" role="dialog" aria-modal="true" aria-labelledby="proposal-editor-title">
    <header className="proposal-dialog__head"><div><span>{id ? `PROPOSTA ${current?.proposalCode ?? ''}` : 'NOVA PROPOSTA COMERCIAL'}</span><h2 id="proposal-editor-title">{id ? current?.title ?? 'Carregando proposta...' : 'Construir proposta'}</h2><p>{id ? `${current?.recipientName ?? ''} · ${current?.proposalCode ?? ''}` : 'Defina serviços, condições e validade. O cliente será cadastrado ao salvar.'}</p></div><button type="button" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={20} /></button></header>
    {!loaded || !draft ? <div className="proposal-dialog__body proposal-loading">{detail.isError || prefill.isError ? <><AlertCircle size={20} /> Não foi possível carregar. <button type="button" onClick={() => id ? detail.refetch() : prefill.refetch()}>Tentar novamente</button></> : 'Carregando dados da proposta...'}</div> : <>
      {id && <div className="proposal-ribbon"><span className={`proposal-status proposal-status--${current!.effectiveStatus.toLowerCase()}`}>{({ DRAFT: 'Rascunho', SENT: 'Enviada', ACCEPTED: 'Aceita', DECLINED: 'Recusada', EXPIRED: 'Vencida', CONVERTED: 'Convertida' } as const)[current!.effectiveStatus]}</span><strong>{money(current!.totalAmount)}</strong><span>Validade: {current!.validUntil ? dateOnly(current!.validUntil) : 'sem prazo'}</span></div>}
      {id && <nav className="proposal-dialog__tabs" aria-label="Detalhes da proposta"><button type="button" className={panel !== 'HISTORY' ? 'is-active' : ''} onClick={() => setPanel('NONE')}><FileText size={15} /> Documento</button><button type="button" className={panel === 'HISTORY' ? 'is-active' : ''} onClick={() => setPanel('HISTORY')}><History size={15} /> Histórico</button></nav>}
      {panel === 'HISTORY' ? <div className="proposal-dialog__body"><h3>Histórico da proposta</h3>{history.isPending ? <p>Carregando...</p> : history.isError ? <p role="alert">Não foi possível carregar o histórico.</p> : <ol className="proposal-history">{history.data?.items.map(event => <li key={event.id}><strong>{actions[event.eventType] ?? event.eventType}</strong><span>{shortDateTime(event.recordedAt)} · {event.actorType === 'USER' ? 'Usuário' : event.actorType}</span>{event.reason && <p>{event.reason}</p>}</li>)}</ol>}</div> : <form id="proposal-form" onSubmit={submit}><div className="proposal-dialog__body">
        <div className="proposal-block"><div className="proposal-block__title"><span>01</span><div><h3>Destinatário</h3><p>Cliente e negociação vinculados a esta oferta.</p></div></div><div className="proposal-fields__two"><label>Contato<input value={prefill.data?.contact?.name ?? current?.contactName ?? current?.recipientName ?? prefill.data?.customer?.name ?? ''} readOnly /></label><label>Negociação<input value={prefill.data?.opportunity?.title ?? current?.title ?? (draft.createOpportunity ? 'Nova negociação para este cliente' : '')} readOnly /></label></div>
          {!id && 'opportunityId' in source && !prefill.data?.customer && <div className="proposal-customer-box"><p>Este lead será cadastrado como cliente ao salvar a proposta.</p><div className="proposal-choice"><label><input type="radio" checked={draft.customerMode === 'NEW'} onChange={() => update('customerMode', 'NEW')} /> Novo cadastro</label><label><input type="radio" checked={draft.customerMode === 'EXISTING'} onChange={() => update('customerMode', 'EXISTING')} /> Cliente existente</label></div>{draft.customerMode === 'NEW' ? <div className="proposal-fields__two"><label>Tipo de pessoa<select value={draft.customerKind} onChange={(event) => update('customerKind', event.target.value as 'PF' | 'PJ' | '')}><option value="">Selecione</option><option value="PF">Pessoa física</option><option value="PJ">Pessoa jurídica</option></select></label><label>Nome do cliente<input value={draft.customerName} onChange={(event) => update('customerName', event.target.value)} maxLength={200} /></label><label>CPF ou CNPJ<input value={draft.customerTaxId} onChange={(event) => update('customerTaxId', event.target.value)} placeholder="Opcional" /></label><label>E-mail<input type="email" value={draft.customerEmail} onChange={(event) => update('customerEmail', event.target.value)} /></label><label>Telefone<input value={draft.customerPhone} onChange={(event) => update('customerPhone', event.target.value)} /></label></div> : <label>Selecionar cliente<select value={draft.customerId} onChange={(event) => update('customerId', event.target.value)}><option value="">Selecione um cliente</option>{candidates.filter(candidate => candidate.status === 'ACTIVE').map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.taxId ? ` · ${candidate.taxId}` : ''}</option>)}</select><small>Se não aparecer, cadastre o cliente na área Clientes e abra novamente.</small></label>}</div>}
          {!id && 'customerId' in source && (prefill.data?.contacts?.length ?? 0) > 1 && <label>Contato desta proposta<select value={draft.contactId} onChange={(event) => update('contactId', event.target.value)}><option value="">Selecione o contato</option>{prefill.data?.contacts?.map(contact => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>}
        </div>
        <div className="proposal-block"><div className="proposal-block__title"><span>02</span><div><h3>Oferta</h3><p>Serviços, quantidade, preço e desconto negociado.</p></div></div><div className="proposal-fields"><label>Título da proposta<input value={draft.title} onChange={(event) => update('title', event.target.value)} readOnly={!editing} maxLength={200} /></label><label>Descrição comercial<textarea value={draft.commercialDescription} onChange={(event) => update('commercialDescription', event.target.value)} readOnly={!editing} maxLength={5000} rows={2} /></label></div>
          {editing && <div className="proposal-service-search"><label>Buscar serviço<input value={serviceSearch} onChange={(event) => setServiceSearch(event.target.value)} placeholder="Nome do serviço" /></label><button type="button" className="proposal-inline-new" onClick={() => setQuickServiceOpen(true)}><Plus size={14} /> Novo serviço</button></div>}
          <div className="proposal-items">{draft.items.map((item, index) => <div className="proposal-item" key={item.key}><div className="proposal-item__top"><strong>Serviço {index + 1}</strong>{editing && draft.items.length > 1 && <button type="button" onClick={() => update('items', draft.items.filter(row => row.key !== item.key))} aria-label={`Remover serviço ${index + 1}`}><Trash2 size={16} /></button>}</div><div className="proposal-item__grid"><label className="proposal-item__service">Serviço<select value={item.serviceId} onChange={(event) => { const selected = availableServices.find(service => service.id === event.target.value); updateRow(item.key, { serviceId: event.target.value, unitPrice: pt(selected?.suggestedUnitPrice), description: selected?.description ?? '' }); }} disabled={!editing}><option value="">Selecione</option>{!availableServices.some(service => service.id === item.serviceId) && item.serviceId && <option value={item.serviceId}>{current?.items.find(row => row.serviceId === item.serviceId)?.serviceNameSnapshot ?? 'Serviço selecionado'}</option>}{availableServices.map(service => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Quantidade<input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(event) => updateRow(item.key, { quantity: event.target.value })} readOnly={!editing} /></label><label>Preço unitário<input inputMode="decimal" value={item.unitPrice} onChange={(event) => updateRow(item.key, { unitPrice: event.target.value })} readOnly={!editing} /></label><label>Desconto<select value={item.discountType} onChange={(event) => updateRow(item.key, { discountType: event.target.value as 'AMOUNT' | 'PERCENT', discountInput: '0,00' })} disabled={!editing}><option value="AMOUNT">R$</option><option value="PERCENT">%</option></select></label><label>Valor desconto<input inputMode="decimal" value={item.discountInput} onChange={(event) => updateRow(item.key, { discountInput: event.target.value })} readOnly={!editing} /></label><label className="proposal-item__description">Descrição do item<input value={item.description} onChange={(event) => updateRow(item.key, { description: event.target.value })} readOnly={!editing} maxLength={1000} /></label></div></div>)}</div>{editing && <button type="button" className="proposal-add-item" onClick={() => update('items', [...draft.items, emptyRow()])} disabled={draft.items.length >= 100}><Plus size={16} /> Adicionar outro serviço</button>}<div className="proposal-totals"><span>Subtotal <strong>{money(totals.gross.toFixed(2))}</strong></span><span>Desconto <strong>{money(totals.discount.toFixed(2))}</strong></span><span>Total <strong>{money(totals.total.toFixed(2))}</strong></span></div>
        </div>
        <div className="proposal-block"><div className="proposal-block__title"><span>03</span><div><h3>Condições</h3><p>Validade, pagamento e informações para o cliente.</p></div></div><div className="proposal-fields"><div className="proposal-fields__two"><label>Validade<input type="date" value={draft.validUntil} onChange={(event) => update('validUntil', event.target.value)} readOnly={!editing} /></label><label>Forma e prazo de pagamento<input value={draft.paymentTerms} onChange={(event) => update('paymentTerms', event.target.value)} readOnly={!editing} maxLength={2000} placeholder="Ex.: Entrada de 50% e saldo em 30 dias" /></label></div><label>Condições comerciais<textarea rows={3} value={draft.terms} onChange={(event) => update('terms', event.target.value)} readOnly={!editing} maxLength={10000} /></label><label>Observações internas<textarea rows={2} value={draft.notes} onChange={(event) => update('notes', event.target.value)} readOnly={!editing} maxLength={2000} /></label></div></div>
        {current?.sale && <div className="proposal-linked-sale"><Check size={17} /> Pedido {current.sale.orderCode} vinculado. <button type="button" onClick={() => navigate(`/portal-de-servicos?editar=${current.sale!.id}&empresa=${companyId}`)}>Abrir pedido <ArrowRight size={14} /></button></div>}
        {panel === 'DECLINE' && <div className="proposal-action-panel"><strong>Registrar recusa</strong><label>Motivo (opcional)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={1000} placeholder="O que o cliente informou?" /></label><button type="button" className="button button--primary" onClick={() => action('decline')} disabled={busy}>Confirmar recusa</button></div>}
        {panel === 'DUPLICATE' && <div className="proposal-action-panel"><strong>Nova versão da proposta</strong><label>Nova validade (opcional)<input type="date" value={duplicateDate} onChange={(event) => setDuplicateDate(event.target.value)} /></label><button type="button" className="button button--primary" onClick={() => action('duplicate')} disabled={busy}>Criar rascunho</button></div>}
        {notice && <p className="proposal-notice" role="status"><Check size={16} />{notice}</p>}{error && <p className="proposal-error" role="alert"><AlertCircle size={16} />{error}{id && <button type="button" onClick={async () => { await detail.refetch(); setDraft(null); setError(''); }}>Recarregar</button>}</p>}
      </div></form>}
      <footer className="proposal-dialog__footer"><div>{id && <button type="button" className="button button--secondary" onClick={() => pdf.mutate()} disabled={busy}><Download size={16} /> {pdf.isPending ? 'Gerando...' : 'PDF'}</button>}{current && current.effectiveStatus !== 'DRAFT' && current.status !== 'CONVERTED' && <button type="button" className="button button--secondary" onClick={() => { setDuplicateDate(''); setPanel('DUPLICATE'); }} disabled={busy}><Copy size={15} /> Duplicar</button>}</div><div>{editing ? <><button type="button" className="button button--secondary" onClick={() => { if (!id) onClose(); else { setDraft(fromDetail(current!)); setEditing(false); setError(''); } }} disabled={busy}>Cancelar</button><button type="submit" form="proposal-form" className="button button--primary" disabled={busy}>{save.isPending ? 'Salvando...' : 'Salvar rascunho'}</button></> : <><button type="button" className="button button--secondary" onClick={onClose}>Fechar</button>{current?.status === 'DRAFT' && <><button type="button" className="button button--secondary" onClick={() => { setDraft(fromDetail(current)); setEditing(true); setError(''); }}>Editar</button><button type="button" className="button button--primary" onClick={() => action('send')} disabled={busy}><Send size={15} /> Registrar envio</button></>}{current?.effectiveStatus === 'SENT' && <><button type="button" className="button button--secondary" onClick={() => setPanel('DECLINE')} disabled={busy}>Registrar recusa</button><button type="button" className="button button--primary" onClick={() => action('accept')} disabled={busy}><Check size={15} /> Registrar aceite</button></>}{current?.status === 'ACCEPTED' && <button type="button" className="button button--primary" onClick={() => action('convert')} disabled={busy}>Criar pedido <ArrowRight size={15} /></button>}</>}</div></footer>
    </>}
    {quickServiceOpen && <QuickServiceModal companyId={companyId} onClose={() => setQuickServiceOpen(false)} onCreated={(service) => { setCreatedServices(current => [...current, service]); if (draft) { const row = draft.items.find(item => !item.serviceId); if (row) updateRow(row.key, { serviceId: service.id, unitPrice: pt(service.suggestedUnitPrice), description: service.description ?? '' }); else update('items', [...draft.items, { ...emptyRow(), serviceId: service.id, unitPrice: pt(service.suggestedUnitPrice), description: service.description ?? '' }]); } setQuickServiceOpen(false); }} />}
  </section></div>;
}
