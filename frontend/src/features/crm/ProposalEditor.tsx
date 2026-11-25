import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertCircle, ArrowRight, Check, Download, FileCheck2, FileText, History, Package, Plus, Trash2, UserRound } from 'lucide-react';
import { api, type ProposalDetail, type ProposalInput, type ProposalItemInput, type ProposalPrefill, type ProposalResult, type Service } from '../../api/client';
import { RegistrationDialog } from '../../components/RegistrationDialog';
import { PERMISSION_DENIED_MESSAGE } from '@gestaonf/permissions';
import { followedDiscountCents } from '../../utils/reference-discount';
import { usePermissions } from '../permissions/usePermissions';
import { money, normalizeMoney, shortDateTime } from './crm-utils';
import { ServiceCreateModal } from '../services/ServiceCreateModal';
import { ProposalServicePicker } from './ProposalServicePicker';

export type ProposalSource = { id: string } | { opportunityId: string } | { customerId: string };
/** Termos de preço de uma linha, comparados como digitados pelo servidor (D6). `quantity` só existe na referência gravada. */
type PriceTerms = { unitPrice: string; discountType: 'AMOUNT' | 'PERCENT'; discountInput: string; quantity?: string };
type Row = Omit<PriceTerms, 'quantity'> & { key: string; serviceId: string; serviceName: string; quantity: string; description: string; reference: PriceTerms | null };
type Draft = { items: Row[]; customerMode: 'NEW' | 'EXISTING'; customerId: string; customerTaxId: string; customerEmail: string; customerPhone: string; contactId: string };
const MAX_ITEMS = 100;
const pt = (value: string | null | undefined) => value ? value.replace('.', ',') : '0,00';
const catalogTerms = (price: string | null | undefined): PriceTerms | null =>
  price ? { unitPrice: pt(price), discountType: 'AMOUNT', discountInput: '0,00' } : null;
/** Sem a chave e com referência, preço e desconto ficam na referência; sem referência, a linha é livre (D6). */
const priceLocked = (row: Pick<Row, 'reference'>, canChangePrice: boolean) => !canChangePrice && row.reference !== null;
const rowFromService = (service: Service): Row => ({ key: crypto.randomUUID(), serviceId: service.id, serviceName: service.name, quantity: '1',
  unitPrice: pt(service.suggestedUnitPrice), discountType: 'AMOUNT', discountInput: '0,00', description: service.description ?? '',
  reference: catalogTerms(service.suggestedUnitPrice) });
/** Sem a chave, numa linha com desconto em R$ e referência, o desconto acompanha a quantidade como no servidor (`followedDiscountCents`, mesma regra do editor de vendas). */
const withQuantity = (row: Row, quantity: string, locked: boolean): Partial<Row> => {
  if (!locked || row.discountType !== 'AMOUNT' || row.reference?.discountType !== 'AMOUNT' || !row.reference.quantity) return { quantity };
  const reference = normalizeMoney(row.reference.discountInput);
  const cents = reference ? followedDiscountCents(Math.round(Number(reference) * 100), row.reference.quantity, quantity) : null;
  return cents === null ? { quantity } : { quantity, discountInput: pt((cents / 100).toFixed(2)) };
};
const text = (value: string) => value.trim() || null;
function fromPrefill(data: ProposalPrefill): Draft {
  const customer = data.customer;
  return { items: data.suggestedItems?.map(item => ({ key: crypto.randomUUID(), serviceId: item.serviceId, serviceName: data.service?.name ?? 'Serviço selecionado', quantity: String(Number(item.quantity)), unitPrice: pt(item.unitPrice), discountType: item.discountType, discountInput: pt(item.discountInput), description: data.service?.description ?? '', reference: catalogTerms(item.unitPrice) })) ?? [],
    customerMode: customer ? 'EXISTING' : 'NEW', customerId: customer?.id ?? '', customerTaxId: data.customerDraft?.taxId ?? '', customerEmail: data.customerDraft?.email ?? '', customerPhone: data.customerDraft?.phone ?? '', contactId: data.contacts?.length === 1 ? data.contacts[0].id : '' };
}
function fromDetail(data: ProposalDetail): Draft {
  return { customerMode: 'EXISTING', customerId: data.customerId, customerTaxId: data.recipientTaxId ?? '', customerEmail: data.recipientEmail ?? '', customerPhone: '', contactId: data.contactId,
    items: data.items.map(item => ({ key: item.id, serviceId: item.serviceId, serviceName: item.serviceNameSnapshot, quantity: String(Number(item.quantity)), unitPrice: pt(item.unitPrice), discountType: item.discountType, discountInput: pt(item.discountInput), description: item.descriptionSnapshot ?? '',
      reference: { unitPrice: pt(item.unitPrice), discountType: item.discountType, discountInput: pt(item.discountInput), quantity: String(Number(item.quantity)) } })) };
}
function payloadRows(items: Row[]): ProposalItemInput[] {
  if (!items.length || items.length > MAX_ITEMS) throw new Error(`Selecione entre 1 e ${MAX_ITEMS} serviços.`);
  return items.map((item) => {
    const quantity = Number(item.quantity.replace(',', '.'));
    const unitPrice = normalizeMoney(item.unitPrice), discountInput = normalizeMoney(item.discountInput);
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
  const access = usePermissions(companyId);
  const canManage = access.can('proposals.manage'), canChangePrice = access.can('proposals.change_price'), canCreateCustomer = access.can('customers.create');
  const detail = useQuery({ queryKey: ['proposal', companyId, id], queryFn: () => api.proposal(companyId, id!), enabled: !!id });
  const prefill = useQuery({ queryKey: ['proposal-prefill', companyId, source], queryFn: () => api.proposalPrefill(companyId, source as { opportunityId?: string; customerId?: string }), enabled: !id });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editing, setEditing] = useState(!id);
  const [quickServiceOpen, setQuickServiceOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'NONE' | 'DECLINE' | 'HISTORY'>('NONE');
  const [reason, setReason] = useState('');
  const [pdfFailed, setPdfFailed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const quickServiceTrigger = useRef<HTMLButtonElement>(null);
  const history = useQuery({ queryKey: ['proposal-history', companyId, id], queryFn: () => api.proposalHistory(companyId, id!), enabled: !!id && panel === 'HISTORY' });
  const loaded = id ? detail.data : prefill.data;
  const ready = !!loaded && !!draft;
  useEffect(() => { if (!loaded || draft) return; setDraft(id ? fromDetail(loaded as ProposalDetail) : fromPrefill(loaded as ProposalPrefill)); }, [loaded, draft, id]);
  useLayoutEffect(() => {
    if (!id && ready) {
      formRef.current?.querySelector<HTMLElement>('.drawer__body :is(input, select, textarea):not([readonly], [type="radio"], :disabled)')?.focus({ preventScroll: true });
    }
  }, [id, ready]);
  useLayoutEffect(() => {
    if (quickServiceOpen) return;
    quickServiceTrigger.current?.focus();
    quickServiceTrigger.current = null;
  }, [quickServiceOpen]);
  const current = detail.data;
  const candidates = prefill.data?.customerCandidates ?? [];
  const totals = useMemo(() => {
    let gross = 0, discount = 0;
    for (const item of draft?.items ?? []) {
      const amount = Number(item.quantity.replace(',', '.')) * Number(normalizeMoney(item.unitPrice) ?? 0);
      const input = Number(normalizeMoney(item.discountInput) ?? 0);
      if (Number.isFinite(amount)) { gross += amount; discount += item.discountType === 'PERCENT' ? Math.round(amount * input) / 100 : input; }
    }
    return { gross, discount, total: Math.max(0, gross - discount) };
  }, [draft?.items]);
  const needsCustomer = 'opportunityId' in source && !prefill.data?.customer;
  const customerMode = canCreateCustomer ? draft?.customerMode : 'EXISTING';
  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(valueDraft => valueDraft ? { ...valueDraft, [key]: value } : valueDraft);
  const updateRow = (key: string, change: Partial<Row>) => setDraft(value => value ? { ...value, items: value.items.map(row => row.key === key ? { ...row, ...change } : row) } : value);
  const refresh = async () => { await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['proposals', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm-opportunities', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm-status-count', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm', 'overview'] })]); };
  const save = useMutation({ mutationFn: async () => {
    if (!draft) throw new Error('Aguarde o carregamento da proposta.');
    const items = payloadRows(draft.items);
    if (id) return api.updateProposal(companyId, id, { items, expectedVersion: current!.version });
    const input: ProposalInput = { items };
    if ('opportunityId' in source) input.opportunityId = source.opportunityId;
    else if ('customerId' in source) {
      input.customerId = source.customerId;
      input.createOpportunity = true;
      if ((prefill.data?.contacts?.length ?? 0) > 1) { if (!draft.contactId) throw new Error('Selecione o contato deste cliente.'); input.contactId = draft.contactId; }
    }
    if (needsCustomer) {
      if (customerMode === 'EXISTING') { if (!draft.customerId) throw new Error('Selecione um cliente cadastrado.'); input.customerId = draft.customerId; }
      else {
        const taxId = draft.customerTaxId.toUpperCase().replace(/[^A-Z0-9]/g, '');
        input.newCustomer = { taxId: taxId || null, email: text(draft.customerEmail), phone: text(draft.customerPhone) };
      }
    }
    return api.createProposal(companyId, input, crypto.randomUUID());
  }, onSuccess: async (result) => {
    setError('');
    if (id) { await refresh(); setDraft(null); setEditing(false); setNotice('Rascunho salvo.'); return; }
    try { await downloadPdf(result.proposalId, result.proposalCode); } catch { setPdfFailed(true); }
  }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a proposta.') });
  const command = useMutation({ mutationFn: async (input: { action: 'send' | 'accept' | 'decline' | 'convert'; reason?: string }) => {
    if (!current) throw new Error('Proposta indisponível.');
    return api.proposalAction(companyId, current.id, input.action, { expectedVersion: current.version, ...(input.action === 'decline' ? { reason: text(input.reason ?? '') } : {}) }, crypto.randomUUID());
  }, onSuccess: async (result: ProposalResult, variables) => {
    setPanel('NONE'); setReason(''); setError('');
    await refresh();
    if (variables.action === 'convert' && result.reviewUrl) { navigate(result.reviewUrl); return; }
    if (variables.action === 'send') pdf.mutate();
    setNotice(variables.action === 'send' ? 'Proposta criada e PDF gerado.' : variables.action === 'accept' ? 'Proposta aceita.' : 'Proposta recusada.');
  }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível concluir a ação.') });
  async function downloadPdf(proposalId: string, code: string) {
    const blob = await api.proposalPdf(companyId, proposalId);
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${code}.pdf`; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  const pdf = useMutation({ mutationFn: () => downloadPdf(id!, current?.proposalCode ?? 'proposta'), onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível gerar o PDF.') });
  const busy = save.isPending || command.isPending || pdf.isPending;
  const created = !id && save.isSuccess ? save.data : null;
  function closeEditor() {
    if (created) onSaved(created.proposalId, pdfFailed ? 'Proposta criada. Não foi possível baixar o PDF; baixe-o pela proposta.' : 'Proposta criada e PDF gerado.');
    else onClose();
  }
  function toggleService(service: Service, checked: boolean) {
    const newItem = checked ? rowFromService(service) : null;
    setDraft(current => {
      if (!current) return current;
      if (!newItem) return { ...current, items: current.items.filter(item => item.serviceId !== service.id) };
      if (current.items.length >= MAX_ITEMS || current.items.some(item => item.serviceId === service.id)) return current;
      return { ...current, items: [...current.items, newItem] };
    });
  }
  function serviceCreated(service: Service, municipalCodeSaved: boolean) {
    toggleService(service, true);
    if (!municipalCodeSaved) setNotice('Serviço cadastrado, mas o código municipal não foi salvo. Ajuste-o no cadastro de Serviços.');
    setQuickServiceOpen(false);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !editing || panel === 'HISTORY') return;
    setError('');
    save.mutate();
  }
  function action(value: 'send' | 'accept' | 'decline' | 'convert') { setError(''); command.mutate({ action: value, ...(value === 'decline' ? { reason } : {}) }); }
  return <RegistrationDialog
    eyebrow={id ? 'PROPOSTA COMERCIAL' : 'NOVA PROPOSTA COMERCIAL'}
    title={id ? current?.proposalCode ?? 'Carregando proposta...' : 'Construir proposta'}
    description={current?.recipientName}
    panelClassName="proposal-editor"
    dismissDisabled={busy}
    closeOnSuccess={!!created}
    onClose={closeEditor}
    overlay={quickServiceOpen ? (
      <ServiceCreateModal companyId={companyId} onClose={() => setQuickServiceOpen(false)} onCreated={serviceCreated} />
    ) : undefined}
  >
    {(requestClose) => !ready || !draft ? (
      <div className="drawer__body proposal-form-body proposal-loading">
        {detail.isError || prefill.isError ? <><AlertCircle size={20} /> Não foi possível carregar. <button type="button" onClick={() => id ? detail.refetch() : prefill.refetch()}>Tentar novamente</button></> : 'Carregando dados da proposta...'}
      </div>
    ) : <>
      {current && <div className="proposal-ribbon"><span className={`proposal-status proposal-status--${current.status.toLowerCase()}`}>{({ DRAFT: 'Rascunho', SENT: 'Enviada', ACCEPTED: 'Aceita', DECLINED: 'Recusada', CONVERTED: 'Convertida' } as const)[current.status]}</span><strong>{money(current.totalAmount)}</strong></div>}
      {id && <nav className="crm-detail-tabs proposal-editor__tabs" aria-label="Detalhes da proposta"><button type="button" className={panel !== 'HISTORY' ? 'is-active' : ''} aria-pressed={panel !== 'HISTORY'} onClick={() => setPanel('NONE')}><FileText size={15} /> Documento</button><button type="button" className={panel === 'HISTORY' ? 'is-active' : ''} aria-pressed={panel === 'HISTORY'} onClick={() => setPanel('HISTORY')}><History size={15} /> Histórico</button></nav>}
      <form ref={formRef} onSubmit={submit}>
        {panel === 'HISTORY' ? <div className="drawer__body proposal-form-body"><h3>Histórico da proposta</h3>{history.isPending ? <p>Carregando...</p> : history.isError ? <p role="alert">Não foi possível carregar o histórico.</p> : <ol className="proposal-history">{history.data?.items.map(event => <li key={event.id}><strong>{actions[event.eventType] ?? event.eventType}</strong><span>{shortDateTime(event.recordedAt)} · {event.actorType === 'USER' ? 'Usuário' : event.actorType}</span>{event.reason && <p>{event.reason}</p>}</li>)}</ol>}</div> : <div className="drawer__body proposal-form-body">
            <div className="proposal-block">
              <div className="form-section-heading proposal-recipient-heading">
                <div className="proposal-recipient-title"><UserRound size={18} /><h3>Destinatário</h3></div>
                {needsCustomer && <div className="proposal-choice" role="radiogroup" aria-label="Cadastro do destinatário">
                  <label><input type="radio" name="proposal-customer-mode" checked={customerMode === 'NEW'} disabled={!canCreateCustomer} onChange={() => update('customerMode', 'NEW')} /> Novo cadastro</label>
                  <label><input type="radio" name="proposal-customer-mode" checked={customerMode === 'EXISTING'} onChange={() => update('customerMode', 'EXISTING')} /> Cliente existente</label>
                </div>}
              </div>
              <div className="form-grid">
                <div className={editing ? 'form-grid form-grid--two' : 'form-grid'}>
                  <label className="field">Contato<input value={prefill.data?.contact?.name ?? current?.contactName ?? current?.recipientName ?? prefill.data?.customer?.name ?? ''} readOnly /></label>
                  {editing && <div className="proposal-service-search">
                    <ProposalServicePicker companyId={companyId} selected={new Set(draft.items.map(item => item.serviceId))}
                      atLimit={draft.items.length >= MAX_ITEMS} onToggle={toggleService} />
                    {access.can('services.create') && <button type="button" className="proposal-inline-new" disabled={draft.items.length >= MAX_ITEMS} onClick={(event) => { quickServiceTrigger.current = event.currentTarget; setQuickServiceOpen(true); }}><Plus size={14} /> Novo serviço</button>}
                  </div>}
                </div>
                {needsCustomer && <>
                  {!canCreateCustomer && <small className="field-hint">{PERMISSION_DENIED_MESSAGE}</small>}
                  {customerMode === 'NEW' ? <>
                    <div className="form-grid proposal-customer-details">
                      <label className="field">CPF ou CNPJ<input value={draft.customerTaxId} onChange={(event) => update('customerTaxId', event.target.value)} placeholder="Opcional" /></label>
                      <label className="field">E-mail<input type="email" value={draft.customerEmail} onChange={(event) => update('customerEmail', event.target.value)} /></label>
                      <label className="field">Telefone<input value={draft.customerPhone} onChange={(event) => update('customerPhone', event.target.value)} /></label>
                    </div>
                    <p className="proposal-muted">Ao salvar a proposta, será criado o cadastro de cliente para esse lead.</p>
                  </> : <label className="field">
                    Selecionar cliente
                    <select value={draft.customerId} onChange={(event) => update('customerId', event.target.value)}>
                      <option value="">Selecione um cliente</option>
                      {candidates.filter(candidate => candidate.status === 'ACTIVE').map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name}{candidate.taxId ? ` · ${candidate.taxId}` : ''}</option>)}
                    </select>
                    <small>Se não aparecer, cadastre o cliente na área Clientes e abra novamente.</small>
                  </label>}
                </>}
                {!id && 'customerId' in source && (prefill.data?.contacts?.length ?? 0) > 1 && <label className="field">Contato desta proposta<select value={draft.contactId} onChange={(event) => update('contactId', event.target.value)}><option value="">Selecione o contato</option>{prefill.data?.contacts?.map(contact => <option key={contact.id} value={contact.id}>{contact.name}</option>)}</select></label>}
              </div>
            </div>
            <div className="proposal-block"><div className="form-section-heading"><Package size={18} /><h3>Oferta</h3></div>
              {editing && !canChangePrice && <small id="proposal-price-hint" className="field-hint">{PERMISSION_DENIED_MESSAGE}</small>}
              {editing && draft.items.length === 0 && <p className="proposal-muted">Selecione os serviços da proposta em Buscar serviço.</p>}
              <div className="proposal-items">
                {draft.items.map((item, index) => <div className="proposal-item" key={item.key}>
                  <div className="proposal-item__top">
                    <strong>Serviço {index + 1}</strong>
                    {editing && <button type="button" onClick={() => update('items', draft.items.filter(row => row.key !== item.key))} aria-label={`Remover serviço ${index + 1}`}><Trash2 size={16} /></button>}
                  </div>
                  <div className="proposal-item__grid">
                    <label className="field proposal-item__service">Serviço<input value={item.serviceName} readOnly /></label>
                    <label className="field">Quantidade<input type="number" min="0.0001" step="0.0001" value={item.quantity} onChange={(event) => updateRow(item.key, withQuantity(item, event.target.value, priceLocked(item, canChangePrice)))} readOnly={!editing} /></label>
                    <label className="field">Preço unitário<input inputMode="decimal" value={item.unitPrice} onChange={(event) => updateRow(item.key, { unitPrice: event.target.value })} readOnly={!editing || priceLocked(item, canChangePrice)} aria-describedby={editing && priceLocked(item, canChangePrice) ? 'proposal-price-hint' : undefined} /></label>
                    <label className="field">Desconto<select value={item.discountType} onChange={(event) => updateRow(item.key, { discountType: event.target.value as 'AMOUNT' | 'PERCENT', discountInput: '0,00' })} disabled={!editing || priceLocked(item, canChangePrice)} aria-describedby={editing && priceLocked(item, canChangePrice) ? 'proposal-price-hint' : undefined}><option value="AMOUNT">R$</option><option value="PERCENT">%</option></select></label>
                    <label className="field">Valor desconto<input inputMode="decimal" value={item.discountInput} onChange={(event) => updateRow(item.key, { discountInput: event.target.value })} readOnly={!editing || priceLocked(item, canChangePrice)} aria-describedby={editing && priceLocked(item, canChangePrice) ? 'proposal-price-hint' : undefined} /></label>
                    <label className="field proposal-item__description">Descrição do item<input value={item.description} onChange={(event) => updateRow(item.key, { description: event.target.value })} readOnly={!editing} maxLength={2000} /></label>
                  </div>
                </div>)}
              </div>
            </div>
            {current?.sale && <div className="proposal-linked-sale"><Check size={17} /> Pedido {current.sale.orderCode} vinculado. <button type="button" onClick={() => navigate(`/portal-de-servicos?editar=${current.sale!.id}&empresa=${companyId}`)}>Abrir pedido <ArrowRight size={14} /></button></div>}
            {panel === 'DECLINE' && <div className="proposal-action-panel"><strong>Proposta recusada</strong><label className="field">Motivo (opcional)<input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={2000} placeholder="O que o cliente informou?" /></label><button type="button" className="button button--primary" onClick={() => action('decline')} disabled={busy}>Confirmar recusa</button></div>}
            {notice && <p className="proposal-notice" role="status"><Check size={16} />{notice}</p>}{error && <p className="proposal-error" role="alert"><AlertCircle size={16} />{error}{id && <button type="button" onClick={async () => { await detail.refetch(); setDraft(null); setError(''); }}>Recarregar</button>}</p>}
        </div>}
        {panel !== 'HISTORY' && <div className="proposal-totals" aria-live="polite"><span>Subtotal <strong>{money(totals.gross.toFixed(2))}</strong></span><span>Desconto <strong>{money(totals.discount.toFixed(2))}</strong></span><span>Total <strong>{money(totals.total.toFixed(2))}</strong></span></div>}
        <footer className="drawer__footer proposal-editor__footer">
          {id && <div>
            <button type="button" className="button button--secondary" onClick={() => pdf.mutate()} disabled={busy}><Download size={16} /> {pdf.isPending ? 'Gerando...' : 'PDF'}</button>
          </div>}
          <div>
            {editing && panel !== 'HISTORY' ? <>
              <button type="button" className="button button--secondary" onClick={() => {
                if (!id) requestClose();
                else { setDraft(fromDetail(current!)); setEditing(false); setError(''); }
              }} disabled={busy}>Cancelar</button>
              <button type="submit" className="button button--primary" disabled={busy}>{save.isPending ? (id ? 'Salvando...' : 'Criando...') : id ? 'Salvar rascunho' : <><FileCheck2 size={15} /> Criar proposta</>}</button>
            </> : <>
              <button type="button" className="button button--secondary" onClick={requestClose} disabled={busy}>Fechar</button>
              {current?.status === 'DRAFT' && canManage && <>
                <button type="button" className="button button--secondary" onClick={() => { setDraft(fromDetail(current)); setEditing(true); setPanel('NONE'); setError(''); }} disabled={busy}>Editar</button>
                <button type="button" className="button button--primary" onClick={() => action('send')} disabled={busy}><FileCheck2 size={15} /> Criar proposta</button>
              </>}
              {current?.status === 'SENT' && canManage && <>
                <button type="button" className="button button--secondary" onClick={() => setPanel('DECLINE')} disabled={busy}>Proposta recusada</button>
                <button type="button" className="button button--primary" onClick={() => action('accept')} disabled={busy}><Check size={15} /> Proposta aceita</button>
              </>}
              {current?.status === 'ACCEPTED' && access.can('proposals.convert') && (
                <button type="button" className="button button--primary" onClick={() => action('convert')} disabled={busy}>Criar pedido <ArrowRight size={15} /></button>
              )}
            </>}
          </div>
        </footer>
      </form>
    </>}
  </RegistrationDialog>;
}
