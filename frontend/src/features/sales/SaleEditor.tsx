import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CalendarDays, ChevronDown, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { PERMISSION_DENIED_MESSAGE } from '@gestaonf/permissions';
import { followedDiscountCents } from '../../utils/reference-discount';
import { api, ApiError, type Company, type ConfirmedSaleInput, type Customer, type CustomerInput, type PaymentMethod, type SaleDetail, type SaleInput, type Service, type StoredFile, type TaxSnapshot } from '../../api/client';
import { CustomerForm } from '../customers/CustomerForm';
import { ServiceCreateModal } from '../services/ServiceCreateModal';
import { SaleDropdown } from './SaleDropdown';
import { SaleAttachments } from '../files/SaleAttachments';
import { NfseSaleActions } from '../fiscal/NfseSaleActions';
import { usePermissions } from '../permissions/usePermissions';

type ItemLine = { key: string; id?: string; serviceId: string; name: string; taxProfileId?: string | null; taxSnapshot?: TaxSnapshot | null; description?: string | null; performedOn?: string | null; quantity: string; unitPrice: string; discountAmount: string; discountPercent: string; discountBasis: 'AMOUNT' | 'PERCENT'; referencePrice: string | null; referenceDiscount: Readonly<{ amount: string; quantity: string }> | null };
type PaymentLine = { key: string; id?: string; paycode?: string | null; hasHistory?: boolean; initiallyPaid?: boolean; paidAmount?: string; paymentMethod: PaymentMethod; amount: string; dueOn: string; state: 'PAID' | 'PENDING'; receivedOn: string };
const methods: { value: PaymentMethod; label: string }[] = [
  { value: 'PIX', label: 'PIX' }, { value: 'CASH', label: 'Dinheiro' }, { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' }, { value: 'BOLETO', label: 'Boleto' }, { value: 'TRANSFER', label: 'Transferência' }, { value: 'OTHER', label: 'Outra' },
];
const paymentStates: { value: PaymentLine['state']; label: string }[] = [{ value: 'PENDING', label: 'Pendente' }, { value: 'PAID', label: 'Já recebida' }];
const saleSections = {
  'sale-identity-section': 'Dados do lançamento',
  'sale-services-section': 'Serviços vendidos',
  'sale-payment-section': 'Formas de pagamento',
};
type SaleEditorError = { message: string; section?: keyof typeof saleSections };
const today = () => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const brl = (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
const money = (value: string) => Number(value.replace(',', '.'));
const fixed = (value: string, places: number) => Number.isFinite(money(value)) && money(value) >= 0 ? money(value).toFixed(places) : null;
const grossCents = (line: Pick<ItemLine, 'quantity' | 'unitPrice'>) => {
  const gross = Math.round(money(line.quantity) * money(line.unitPrice) * 100);
  return Number.isFinite(gross) ? gross : 0;
};
const discountCents = (value: string) => Math.round(money(value || '0') * 100);
const discountPercent = (amount: string, gross: number) => gross > 0 && Number.isFinite(discountCents(amount)) ? (discountCents(amount) / gross * 100).toFixed(2) : '0.00';
const lineTotalCents = (line: ItemLine) => Math.max(0, grossCents(line) - discountCents(line.discountAmount));
/** Sem a chave, preço e desconto seguem a referência; serviço sem preço no catálogo e sem original é livre (D6). */
const priceLocked = (line: Pick<ItemLine, 'referencePrice'>, canChangePrice: boolean) => !canChangePrice && line.referencePrice !== null;
/** Sem a chave, o desconto em R$ acompanha a quantidade sem passar do da referência, no total nem por unidade (regra em `followedDiscountCents`). */
function followReferenceDiscount(line: ItemLine): ItemLine {
  if (!line.referenceDiscount) return line;
  const cents = followedDiscountCents(discountCents(line.referenceDiscount.amount), line.referenceDiscount.quantity, line.quantity);
  if (cents === null) return line;
  const discountAmount = (cents / 100).toFixed(2);
  return { ...line, discountBasis: 'AMOUNT', discountAmount, discountPercent: discountPercent(discountAmount, grossCents(line)) };
}
/** A parcela que o servidor conta como baixa na criação (D6): no rascunho, toda "Já recebida"; no "Editar venda", só a que ainda não era. */
const needsReceivePermission = (line: PaymentLine, confirmedEdit: boolean) => line.state === 'PAID' && !(confirmedEdit && line.initiallyPaid);
function changeItem(line: ItemLine, field: 'quantity' | 'unitPrice' | 'discountAmount' | 'discountPercent', value: string): ItemLine {
  const next = { ...line, [field]: value };
  const gross = grossCents(next);
  if (field === 'discountPercent' || ((field === 'quantity' || field === 'unitPrice') && line.discountBasis === 'PERCENT')) {
    const percent = money(next.discountPercent || '0');
    return { ...next, discountBasis: 'PERCENT', discountAmount: Number.isFinite(percent) ? (Math.round(gross * percent / 100) / 100).toFixed(2) : '0.00' };
  }
  return { ...next, discountBasis: 'AMOUNT', discountPercent: discountPercent(next.discountAmount, gross) };
}
function validItem(line: ItemLine) {
  const gross = grossCents(line);
  const percent = money(line.discountPercent || '0');
  return money(line.quantity) > 0 && fixed(line.quantity, 4) !== null && fixed(line.unitPrice, 2) !== null &&
    fixed(line.discountAmount || '0', 2) !== null && Number.isFinite(percent) && percent >= 0 && percent <= 100 &&
    Number.isFinite(discountCents(line.discountAmount)) && discountCents(line.discountAmount) <= gross;
}

function nextLookupIndex(current: number | null, count: number, direction: 1 | -1) {
  if (current === null) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

export function SaleEditor({ companyId, companies, draft, onCompanyChange, onClose, onCreated }: {
  companyId: string; companies: Company[]; draft?: SaleDetail | null; onCompanyChange: (id: string) => void; onClose: () => void; onCreated: (sale: SaleDetail) => void;
}) {
  const confirmedEdit = draft?.status === 'CONFIRMED';
  const mainRef = useRef<HTMLElement>(null);
  /** Abrir o editor (menu, linha ou ?editar=) leva o foco a ele (Spec D15); o painel/menu que o abriu já foi desmontado. */
  useEffect(() => { mainRef.current?.focus({ preventScroll: true }); }, []);
  const access = usePermissions(companyId);
  const canChangePrice = access.can('sales.change_price'), canAttach = access.can('sales.attachments_view'), canReceive = access.can('finance.receive');
  const [customerId, setCustomerId] = useState(draft?.customerId ?? '');
  const [customerInput, setCustomerInput] = useState(draft?.customerNameSnapshot ?? '');
  const [customerTerm, setCustomerTerm] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerHighlight, setCustomerHighlight] = useState<number | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [serviceInput, setServiceInput] = useState('');
  const [serviceTerm, setServiceTerm] = useState('');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceCreateOpen, setServiceCreateOpen] = useState(false);
  const [serviceHighlight, setServiceHighlight] = useState<number | null>(null);
  const [items, setItems] = useState<ItemLine[]>(draft?.items.map((item) => ({ key: crypto.randomUUID(), id: item.id, serviceId: item.serviceId, name: item.serviceNameSnapshot, taxProfileId: draft.status === 'DRAFT' ? item.taxSnapshot?.profileId ?? null : undefined, taxSnapshot: item.taxSnapshot, description: item.descriptionSnapshot, performedOn: item.performedOn, quantity: item.quantity, unitPrice: item.unitPrice, discountAmount: item.discountAmount, discountPercent: discountPercent(item.discountAmount, Math.round(Number(item.grossAmount) * 100)), discountBasis: 'AMOUNT', referencePrice: item.unitPrice, referenceDiscount: { amount: item.discountAmount, quantity: item.quantity } })) ?? []);
  const [selectedTaxProfileId, setSelectedTaxProfileId] = useState<string>(() => {
    const profiles = new Set(draft?.items.map(item => item.taxSnapshot?.profileId ?? '') ?? []);
    return profiles.size > 1 ? '__mixed__' : [...profiles][0] ?? '';
  });
  const [ruleChanged, setRuleChanged] = useState(false);
  const [serviceDraft, setServiceDraft] = useState<ItemLine | null>(null);
  const [payments, setPayments] = useState<PaymentLine[]>(draft?.installments.map((part) => ({ key: crypto.randomUUID(), id: part.id, paycode: part.paycode, hasHistory: part.movements.length > 0, initiallyPaid: !!part.initialReceivedOn, paidAmount: part.paidAmount, paymentMethod: part.paymentMethod, amount: part.amount, dueOn: part.dueOn ?? today(), state: part.initialReceivedOn ? 'PAID' : 'PENDING', receivedOn: part.initialReceivedOn ?? today() })) ?? [{ key: crypto.randomUUID(), paymentMethod: 'PIX', amount: '', dueOn: today(), state: 'PENDING', receivedOn: today() }]);
  const receiptBlocked = !canReceive && payments.some((line) => needsReceivePermission(line, confirmedEdit));
  const [soldOn, setSoldOn] = useState(draft?.soldOn ?? today());
  const [workOrderNumber, setWorkOrderNumber] = useState(draft?.workOrderNumber ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [error, setError] = useState<SaleEditorError | null>(null);
  /** Negação de permissão: o aviso fica só com o texto padrão, sem o complemento do rascunho. */
  const [denied, setDenied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<StoredFile[]>(draft?.attachments ?? []);
  const [uploading, setUploading] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<SaleDetail | null>(draft ?? null);
  const createKey = useRef(crypto.randomUUID());
  const errorRef = useRef<HTMLDivElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const serviceInputRef = useRef<HTMLInputElement>(null);
  const serviceToggleRef = useRef<HTMLButtonElement>(null);
  const customerSavePending = useRef(false);
  const queryClient = useQueryClient();
  const nfseState = useQuery({ queryKey: ['nfse-state', companyId, draft?.id], queryFn: () => api.nfseState(companyId, draft!.id), enabled: confirmedEdit });

  const customers = useQuery({ queryKey: ['sales-customers', companyId, customerTerm], queryFn: () => api.customers(companyId, { search: customerTerm, status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId });
  const services = useQuery({ queryKey: ['sales-services', companyId, serviceTerm], queryFn: () => api.services(companyId, { search: serviceTerm, status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId });
  const taxRules = useQuery({ queryKey: ['fiscal-tax', companyId], queryFn: () => api.taxProfiles(companyId), enabled: !!companyId });
  const companyProfile = useQuery({ queryKey: ['company', companyId], queryFn: () => api.company(companyId), enabled: !!companyId });
  const availableRules = taxRules.data?.filter(rule => rule.status === 'ACTIVE' && rule.revisions.some(revision => revision.effectiveFrom <= soldOn) &&
    (items.length ? items.every(line => rule.scope === 'COMPANY' || rule.serviceId === line.serviceId &&
      (rule.scope === 'SERVICE' || rule.municipalityIbgeCode === companyProfile.data?.cityIbgeCode))
      : rule.scope === 'COMPANY')) ?? [];
  const selectedRuleMissing = selectedTaxProfileId !== '' && selectedTaxProfileId !== '__mixed__' &&
    !availableRules.some(rule => rule.id === selectedTaxProfileId);
  const selectedRuleUnavailable = selectedTaxProfileId !== '' && selectedTaxProfileId !== '__mixed__' &&
    (!draft || ruleChanged || items.some(line => !line.id)) &&
    items.length > 0 && !taxRules.isPending && !companyProfile.isPending && selectedRuleMissing;
  const serviceOptions = services.data?.items ?? [];
  const customerOptions = customers.data?.items ?? [];
  const activeCustomer = customerHighlight === null ? undefined : customerOptions[customerHighlight];
  const activeService = serviceHighlight === null ? undefined : serviceOptions[serviceHighlight];
  const total = items.reduce((sum, line) => sum + lineTotalCents(line), 0) / 100;
  const paymentTotal = payments.reduce((sum, line) => sum + (money(line.amount) || 0), 0);
  const unallocatedCents = Math.round(total * 100) - Math.round(paymentTotal * 100);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  useEffect(() => {
    if (customerId) return;
    const timeout = window.setTimeout(() => setCustomerTerm(customerInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [customerId, customerInput]);

  useEffect(() => {
    if (selectedService) return;
    const timeout = window.setTimeout(() => setServiceTerm(serviceInput.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [selectedService, serviceInput]);

  function chooseCustomer(customer: Customer) {
    setCustomerId(customer.id);
    setCustomerInput(customer.name);
    setCustomerTerm('');
    setCustomerOpen(false);
    setCustomerHighlight(null);
  }

  const closeCustomerModal = useCallback(() => {
    if (!customerSavePending.current) setCustomerModalOpen(false);
  }, []);

  const customerSave = useMutation({
    mutationFn: async (input: CustomerInput) => {
      customerSavePending.current = true;
      try { return await api.createCustomer(companyId, input); }
      finally { customerSavePending.current = false; }
    },
    onSuccess: (customer) => {
      chooseCustomer(customer);
      setCustomerModalOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['sales-customers', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['customers', companyId] });
    },
  });

  function handleCustomerKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setCustomerOpen(false); setCustomerHighlight(null); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCustomerOpen(true);
      if (customerOptions.length) setCustomerHighlight((current) => nextLookupIndex(current, customerOptions.length, event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const customer = customerOptions[customerHighlight ?? 0];
      if (customerOpen && customer) chooseCustomer(customer);
    }
  }

  function chooseService(service: Service) {
    setSelectedService(service);
    setServiceDraft({ key: crypto.randomUUID(), serviceId: service.id, name: service.name, taxProfileId: selectedTaxProfileId && selectedTaxProfileId !== '__mixed__' ? selectedTaxProfileId : null, quantity: '1', unitPrice: service.suggestedUnitPrice ?? '0.00', discountAmount: '0.00', discountPercent: '0.00', discountBasis: 'AMOUNT', referencePrice: service.suggestedUnitPrice ?? null, referenceDiscount: null });
    setServiceInput(service.name);
    setServiceTerm('');
    setServiceOpen(false);
    setServiceHighlight(null);
  }

  function handleServiceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setServiceOpen(false); setServiceHighlight(null); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setServiceOpen(true);
      if (serviceOptions.length) setServiceHighlight((current) => nextLookupIndex(current, serviceOptions.length, event.key === 'ArrowDown' ? 1 : -1));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const service = serviceOptions[serviceHighlight ?? 0];
      if (serviceOpen && service) chooseService(service);
    }
  }

  function changeCompany(id: string) {
    if (id === companyId) return;
    if (uploading) { setError({ message: 'Aguarde o envio do arquivo antes de trocar a empresa.' }); return; }
    setAttachments([]);
    onCompanyChange(id);
    setCustomerId(''); setCustomerTerm(''); setCustomerInput(''); setCustomerOpen(false); setCustomerHighlight(null); setServiceTerm(''); setServiceInput('');
    setSelectedService(null); setServiceDraft(null); setServiceOpen(false); setServiceCreateOpen(false); setServiceHighlight(null); setItems([]); setSelectedTaxProfileId(''); setRuleChanged(false); setPendingDraft(null); createKey.current = crypto.randomUUID();
  }

  function closeServiceModal() {
    setSelectedService(null);
    setServiceDraft(null);
    setServiceInput('');
    setServiceTerm('');
    setServiceOpen(false);
  }

  function saveService() {
    if (!serviceDraft || !validItem(serviceDraft)) return;
    setError(null);
    setItems((current) => [...current, serviceDraft]);
    closeServiceModal();
  }

  function addPayment() {
    setPayments((current) => [...current, { key: crypto.randomUUID(), paymentMethod: 'PIX', amount: '', dueOn: today(), state: 'PENDING', receivedOn: today() }]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setDenied(false);
    if (uploading) { setError({ message: 'Aguarde o envio e a validação dos anexos antes de salvar.' }); return; }
    const saveDraftOnly = draft?.status === 'DRAFT' && (event.nativeEvent as SubmitEvent).submitter?.getAttribute('data-action') === 'save-draft';
    setError(null);
    if (!companyId || !customerId || !soldOn) {
      setError({ message: 'Informe a empresa, o cliente e a data da venda.', section: 'sale-identity-section' }); return;
    }
    if (!items.length) {
      setError({ message: 'Adicione pelo menos um serviço à venda.', section: 'sale-services-section' }); return;
    }
    if (selectedRuleUnavailable) {
      setError({ message: 'A regra tributária selecionada não atende todos os serviços desta venda. Escolha outra regra ou Sem regra.', section: 'sale-identity-section' }); return;
    }
    if (items.some((line) => !validItem(line))) {
      setError({ message: 'Revise as quantidades, os valores e os descontos dos serviços.', section: 'sale-services-section' }); return;
    }
    if (!payments.length) {
      setError({ message: 'Adicione pelo menos uma forma de pagamento.', section: 'sale-payment-section' }); return;
    }
    if (payments.some((line) => !fixed(line.amount, 2) || money(line.amount) <= 0 || (line.state === 'PENDING' ? !line.dueOn : !line.receivedOn))) {
      setError({ message: 'Informe o valor e a data de cada recebimento.', section: 'sale-payment-section' }); return;
    }
    if (receiptBlocked) {
      setError({ message: PERMISSION_DENIED_MESSAGE, section: 'sale-payment-section' }); setDenied(true); return;
    }
    if (unallocatedCents !== 0 || total <= 0) {
      setError({ message: 'A soma das formas de pagamento precisa ser igual ao total dos serviços.', section: 'sale-payment-section' }); return;
    }
    const payload: SaleInput = {
      customerId, soldOn, workOrderNumber: workOrderNumber.trim() || null, notes: notes.trim() || null, ...(canAttach ? { attachmentIds: attachments.map((file) => file.id) } : {}),
      items: items.map((line) => ({ serviceId: line.serviceId, ...(line.taxProfileId !== undefined ? { taxProfileId: line.taxProfileId } : {}), quantity: fixed(line.quantity, 4)!, unitPrice: fixed(line.unitPrice, 2)!, discountAmount: fixed(line.discountAmount || '0', 2)!, ...(line.description !== undefined ? { description: line.description } : {}), ...(line.performedOn !== undefined ? { performedOn: line.performedOn } : {}) })),
      installments: payments.map((line) => ({ paymentMethod: line.paymentMethod, amount: fixed(line.amount, 2)!, ...(line.state === 'PAID' ? { receivedOn: line.receivedOn } : { dueOn: line.dueOn }) })),
    };
    setSaving(true);
    try {
      if (confirmedEdit && draft) {
        const edited: ConfirmedSaleInput = { ...payload, items: items.map((line, index) => ({
          ...payload.items[index], ...(line.id ? { id: line.id } : {}),
        })), installments: payments.map((line, index) => ({
          ...payload.installments[index], ...(line.id ? { id: line.id } : {}),
        })) };
        onCreated(await api.updateConfirmedSale(companyId, draft.id, draft.version, edited));
        return;
      }
      const savedDraft = pendingDraft ? await api.updateSale(companyId, pendingDraft.id, pendingDraft.version, payload) : await api.createSale(companyId, payload, createKey.current);
      setPendingDraft(savedDraft);
      if (saveDraftOnly) { onCreated(savedDraft); return; }
      const initialReceipts = payments.flatMap((line, index) => line.state === 'PAID' ? [{ installmentId: savedDraft.installments[index].id, amount: fixed(line.amount, 2)!, paymentMethod: line.paymentMethod, receivedOn: line.receivedOn }] : []);
      const confirmed = await api.confirmSale(companyId, savedDraft.id, savedDraft.version, initialReceipts);
      onCreated(confirmed);
    } catch (cause) {
      if (!confirmedEdit && cause instanceof ApiError && cause.status === 409 && pendingDraft) {
        const latest = await api.sale(companyId, pendingDraft.id).catch(() => null);
        if (latest?.status === 'CONFIRMED') { onCreated(latest); return; }
      }
      setDenied(cause instanceof ApiError && cause.code === 'PERMISSION_DENIED');
      setError({ message: cause instanceof Error ? cause.message : 'Não foi possível registrar a venda. Tente novamente.' });
    } finally { setSaving(false); }
  }

  const fiscalDirty = !!draft && (customerId !== draft.customerId || soldOn !== draft.soldOn || workOrderNumber !== (draft.workOrderNumber ?? '') || ruleChanged ||
    items.length !== draft.items.length || items.some((line, index) => { const original = draft.items[index]; return !original || line.id !== original.id || line.serviceId !== original.serviceId ||
      fixed(line.quantity, 4) !== fixed(original.quantity, 4) || fixed(line.unitPrice, 2) !== fixed(original.unitPrice, 2) || fixed(line.discountAmount || '0', 2) !== fixed(original.discountAmount, 2) ||
      (line.description ?? null) !== original.descriptionSnapshot || (line.performedOn ?? null) !== original.performedOn; }));
  return <main ref={mainRef} id="workspace-main" className="sale-editor-page" tabIndex={-1}>
    <header className="sale-editor-header">
      <h1 className="sr-only">{confirmedEdit ? `Editar venda #${draft.orderCode}` : draft ? `Rascunho #${draft.orderCode}` : 'Nova venda de serviço'}</h1>
      <button type="button" className="sale-back" onClick={onClose} disabled={saving || uploading}><ArrowLeft size={16} aria-hidden="true" /> Portal de Serviços</button>
      {confirmedEdit && nfseState.data?.lockReason && <p className="sale-field-hint" role="status">{nfseState.data.lockReason}</p>}
    </header>
    <form onSubmit={submit} className="sale-editor-form">
      <div className="sale-editor-fields">
        <div id="sale-identity-section" className="sale-editor-section" role="region" aria-labelledby="sale-identity-heading" tabIndex={-1}>
          <header className="sale-section-heading">
            <div className="sale-section-number" aria-hidden="true">01</div><h2 id="sale-identity-heading">Dados do lançamento</h2>
          </header>
          <div className="sale-identity-grid">
            <div className="sale-field"><span><Building2 size={14} /> Empresa</span><SaleDropdown label="Empresa" value={companyId} options={companies.map((company) => ({ value: company.id, label: company.tradeName }))} onChange={changeCompany} disabled={saving || !!draft} /></div>
            <div className="sale-field sale-field--customer"><span><UsersRound size={14} /> Cliente <button type="button" className="sale-customer-new" onClick={() => { setCustomerOpen(false); customerSave.reset(); setCustomerModalOpen(true); }} disabled={saving} aria-label="Novo cliente"><Plus size={13} /> Novo</button></span>
              <div className="sale-lookup-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCustomerOpen(false); }}>
                <div className="sale-lookup-combobox">
                  <input ref={customerInputRef} role="combobox" aria-label="Buscar cliente" aria-autocomplete="list" aria-expanded={customerOpen} aria-controls="sale-customer-options" aria-activedescendant={customerOpen && activeCustomer ? `sale-customer-option-${activeCustomer.id}` : undefined} autoComplete="off" placeholder="Buscar ou selecionar cliente" value={customerInput} disabled={saving} onFocus={() => { setCustomerOpen(true); setCustomerHighlight(null); }} onChange={(event) => { setCustomerInput(event.target.value); setCustomerId(''); setCustomerOpen(true); setCustomerHighlight(null); }} onKeyDown={handleCustomerKeyDown} />
                  <button type="button" aria-label="Mostrar clientes" aria-expanded={customerOpen} disabled={saving} onClick={() => { const shouldOpen = !customerOpen; customerInputRef.current?.focus(); setCustomerOpen(shouldOpen); setCustomerHighlight(null); }}><ChevronDown size={16} /></button>
                </div>
                {customerOpen && <div id="sale-customer-options" className="sale-lookup-options" role="listbox" aria-label="Clientes cadastrados" onPointerMove={() => { if (customerHighlight !== null) setCustomerHighlight(null); }}>
                  {customers.isPending ? <div className="sale-lookup-message">Carregando clientes...</div> : customers.isError ? <div className="sale-lookup-message">Não foi possível carregar clientes. <button type="button" onClick={() => customers.refetch()}>Tentar novamente</button></div> : customerOptions.length ? <>
                    {customerOptions.map((entry, index) => <button key={entry.id} id={`sale-customer-option-${entry.id}`} type="button" role="option" aria-selected={entry.id === customerId} className={`sale-lookup-option${index === customerHighlight ? ' is-highlighted' : ''}`} onClick={() => chooseCustomer(entry)}><strong>{entry.name}</strong><small>{[entry.taxId, entry.phone].filter(Boolean).join(' · ')}</small></button>)}
                    {(customers.data?.total ?? 0) > customerOptions.length && <div className="sale-lookup-message">Digite para encontrar outros clientes.</div>}
                  </> : <div className="sale-lookup-message">Nenhum cliente encontrado.</div>}
                </div>}
              </div>
            </div>
            <div className="sale-field sale-field--tax"><span>Regra de tributação</span><SaleDropdown label="Regra de tributação" value={selectedTaxProfileId} disabled={saving || taxRules.isPending || companyProfile.isPending}
              options={[
                { value: '', label: 'Sem regra' },
                ...(selectedTaxProfileId === '__mixed__' ? [{ value: '__mixed__', label: 'Manter regras registradas' }] : []),
                ...(selectedRuleMissing ? [{ value: selectedTaxProfileId, label: 'Regra registrada indisponível', disabled: true }] : []),
                ...availableRules.map(rule => ({ value: rule.id, label: rule.name })),
              ]}
              onChange={profileId => {
                if (profileId === selectedTaxProfileId) return;
                setSelectedTaxProfileId(profileId);
                setRuleChanged(true);
                setItems(current => current.map(item => ({ ...item, taxProfileId: profileId || null })));
              }} /></div>
            <label className="sale-field"><span><CalendarDays size={14} /> Data da venda</span><input type="date" value={soldOn} onChange={(event) => setSoldOn(event.target.value)} required /></label>
            <label className="sale-field"><span>Número da OS <small className="sale-optional">Opcional</small></span><input value={workOrderNumber} onChange={(event) => setWorkOrderNumber(event.target.value)} maxLength={40} placeholder="Ex.: OS-0021" /></label>
          </div>
          {selectedRuleUnavailable && <p className="sale-rule-warning" role="alert">A regra selecionada não atende todos os serviços. Escolha outra regra ou Sem regra.</p>}
          {taxRules.isError && <p className="sale-rule-warning" role="alert">Não foi possível carregar as regras de tributação.</p>}
          {(canAttach || confirmedEdit) && <div className="sale-editor-attachments">
            <div className="sale-editor-document-actions">
              {canAttach && <SaleAttachments key={companyId} companyId={companyId} files={attachments} onChange={setAttachments} onBusyChange={setUploading} disabled={saving} />}
              {confirmedEdit && <div className="sale-editor-fiscal-actions"><NfseSaleActions companyId={companyId} saleId={draft.id} saleVersion={draft.version} disabled={saving || uploading || fiscalDirty} /></div>}
            </div>
            {confirmedEdit && <small className="sale-editor-order-code">Pedido #{draft.orderCode}</small>}
          </div>}
        </div>

        <div id="sale-services-section" className="sale-editor-section" role="region" aria-labelledby="sale-services-heading" tabIndex={-1}>
          <header className="sale-section-heading"><div className="sale-section-number" aria-hidden="true">02</div><h2 id="sale-services-heading">Serviços vendidos</h2></header>
          <div className="sale-add-service">
            <div className="sale-lookup-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setServiceOpen(false); }}>
              <div className="sale-lookup-combobox">
                <input ref={serviceInputRef} role="combobox" aria-label="Buscar serviço" aria-autocomplete="list" aria-expanded={serviceOpen} aria-controls="sale-service-options" aria-activedescendant={serviceOpen && activeService ? `sale-service-option-${activeService.id}` : undefined} autoComplete="off" placeholder="Buscar ou selecionar serviço" value={serviceInput} disabled={saving} onFocus={() => { setServiceOpen(true); setServiceHighlight(null); }} onChange={(event) => { setServiceInput(event.target.value); setSelectedService(null); setServiceOpen(true); setServiceHighlight(null); }} onKeyDown={handleServiceKeyDown} />
                <button ref={serviceToggleRef} type="button" aria-label="Mostrar serviços" aria-expanded={serviceOpen} disabled={saving} onClick={() => { const shouldOpen = !serviceOpen; serviceInputRef.current?.focus(); setServiceOpen(shouldOpen); setServiceHighlight(null); }}><ChevronDown size={16} /></button>
              </div>
              {serviceOpen && <div id="sale-service-options" className="sale-lookup-options" role="listbox" aria-label="Serviços cadastrados" onPointerMove={() => { if (serviceHighlight !== null) setServiceHighlight(null); }}>
                {services.isPending ? <div className="sale-lookup-message">Carregando serviços...</div> : services.isError ? <div className="sale-lookup-message">Não foi possível carregar serviços. <button type="button" onClick={() => services.refetch()}>Tentar novamente</button></div> : serviceOptions.length ? <>
                  {serviceOptions.map((service, index) => <button key={service.id} id={`sale-service-option-${service.id}`} type="button" role="option" aria-selected={service.id === selectedService?.id} className={`sale-lookup-option${index === serviceHighlight ? ' is-highlighted' : ''}`} onClick={() => chooseService(service)}><strong>{service.name}</strong><small>{[service.internalCode, service.suggestedUnitPrice ? brl(Number(service.suggestedUnitPrice)) : null].filter(Boolean).join(' · ')}</small></button>)}
                  {(services.data?.total ?? 0) > serviceOptions.length && <div className="sale-lookup-message">Digite para encontrar outros serviços.</div>}
                </> : <div className="sale-lookup-message">Nenhum serviço encontrado.</div>}
              </div>}
            </div>
            {access.can('services.create') && <button type="button" className="sale-service-new" disabled={saving} onClick={() => { setServiceOpen(false); setServiceCreateOpen(true); }}><Plus size={15} aria-hidden="true" /> Cadastrar serviço</button>}
          </div>
          {!canChangePrice && <p id="sale-price-hint" className="sale-field-hint">{PERMISSION_DENIED_MESSAGE}</p>}
          {!items.length ? <div className="sale-empty-lines">Nenhum serviço adicionado.</div> : <div className="sale-lines-scroll">
            <div className="sale-lines-head"><span>Serviço</span><span>Quantidade</span><span>Valor unitário</span><span>Desconto R$</span><span>Desconto %</span><span>Total</span><span /></div>
            {items.map((line) => <div key={line.key} className="sale-item-line">
              <strong title={line.name}>{line.name}</strong>
              <label className="sale-item-input"><span>Quantidade</span><input type="number" min="0.0001" step="any" aria-label={`Quantidade de ${line.name}`} value={line.quantity} onChange={(event) => setItems((current) => current.map((entry) => { if (entry.key !== line.key) return entry; const next = changeItem(entry, 'quantity', event.target.value); return priceLocked(entry, canChangePrice) ? followReferenceDiscount(next) : next; }))} /></label>
              <label className="sale-item-input"><span>Valor unitário</span><input type="number" readOnly={priceLocked(line, canChangePrice)} aria-describedby={priceLocked(line, canChangePrice) ? 'sale-price-hint' : undefined} min="0" step="0.01" aria-label={`Valor unitário de ${line.name}`} value={line.unitPrice} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'unitPrice', event.target.value) : entry))} /></label>
              <label className="sale-item-input"><span>Desconto R$</span><input type="number" readOnly={priceLocked(line, canChangePrice)} aria-describedby={priceLocked(line, canChangePrice) ? 'sale-price-hint' : undefined} min="0" step="0.01" aria-label={`Desconto em reais de ${line.name}`} value={line.discountAmount} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'discountAmount', event.target.value) : entry))} /></label>
              <label className="sale-item-input"><span>Desconto %</span><input type="number" readOnly={priceLocked(line, canChangePrice)} aria-describedby={priceLocked(line, canChangePrice) ? 'sale-price-hint' : undefined} min="0" max="100" step="0.01" aria-label={`Desconto percentual de ${line.name}`} value={line.discountPercent} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'discountPercent', event.target.value) : entry))} /></label>
              <span className="sale-line-total">{brl(lineTotalCents(line) / 100)}</span>
              <button type="button" className="sale-remove-line" onClick={() => setItems((current) => current.filter((entry) => entry.key !== line.key))} aria-label={`Remover ${line.name}`}><Trash2 size={16} /></button>
            </div>)}
          </div>}
          {!!items.length && <div className="sale-subtotal"><span>Total dos serviços</span><strong>{brl(total)}</strong></div>}
        </div>

        <div id="sale-payment-section" className="sale-editor-section" role="region" aria-labelledby="sale-payment-heading" tabIndex={-1}>
          <header className="sale-section-heading"><div className="sale-section-number" aria-hidden="true">03</div><h2 id="sale-payment-heading">Formas de pagamento</h2></header>
          <div className="sale-payment-list">{payments.map((line, index) => <div key={line.key} className="sale-payment-card"><div className="sale-payment-card__title"><strong>{index === 0 ? 'Recebimento' : `Recebimento ${index + 1}`}{line.paycode && <small> · Código {line.paycode}</small>}</strong><button type="button" aria-label={`Remover recebimento ${index + 1}`} title={line.hasHistory ? 'Recebimento com histórico de baixas não pode ser removido' : 'Remover recebimento'} disabled={line.hasHistory} onClick={() => setPayments((current) => current.filter((entry) => entry.key !== line.key))}><Trash2 size={15} /></button></div><div className="sale-payment-grid">
            <div className="sale-field"><span>Forma de pagamento</span><SaleDropdown label={`Forma de pagamento do recebimento ${index + 1}`} value={line.paymentMethod} options={methods} disabled={line.initiallyPaid && line.hasHistory} onChange={(paymentMethod) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, paymentMethod } : entry))} /></div>
            <label className="sale-field"><span>Valor</span><input type="number" min={line.paidAmount && Number(line.paidAmount) > 0 ? line.paidAmount : '0.01'} step="0.01" value={line.amount} disabled={line.initiallyPaid && line.hasHistory} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, amount: event.target.value } : entry))} placeholder="0,00" /></label>
            <div className="sale-field"><span>Situação</span><SaleDropdown label={`Situação do recebimento ${index + 1}`} value={line.state} options={canReceive || line.state === 'PAID' ? paymentStates : paymentStates.filter((option) => option.value === 'PENDING')} disabled={line.hasHistory} describedBy={!canReceive && needsReceivePermission(line, confirmedEdit) ? `sale-receipt-hint-${line.key}` : undefined} onChange={(state) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, state } : entry))} /></div>
            {line.state === 'PENDING' && <label className="sale-field"><span>Vencimento</span><input type="date" value={line.dueOn} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, dueOn: event.target.value } : entry))} required /></label>}
            {line.state === 'PAID' && <label className="sale-field"><span>Recebido em</span><input type="date" value={line.receivedOn} disabled={line.hasHistory || (!canReceive && needsReceivePermission(line, confirmedEdit))} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, receivedOn: event.target.value } : entry))} required /></label>}
          </div>{!canReceive && needsReceivePermission(line, confirmedEdit) && <p id={`sale-receipt-hint-${line.key}`} className="sale-field-hint">{PERMISSION_DENIED_MESSAGE}</p>}{line.hasHistory && <p className="sale-payment-history">{brl(Number(line.paidAmount ?? '0'))} já baixados. O histórico do pagamento será preservado.</p>}</div>)}</div>
          <button type="button" className="sale-add-payment" onClick={addPayment}><Plus size={15} /> Adicionar forma de pagamento</button>
          <div className="sale-payment-balance"><span>Distribuído nos recebimentos</span><strong>{brl(paymentTotal)} <small>de {brl(total)}</small></strong></div>
        </div>

        <div className="sale-editor-notes"><label className="sale-field"><span>Observações da venda <small className="sale-optional">Opcional</small></span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={3} /></label></div>
      </div>
      {error && <div ref={errorRef} className="sale-form-error" role="alert" tabIndex={-1}>
        <p>{error.message}{!denied && !error.section && pendingDraft?.status === 'DRAFT' && <span> Rascunho #{pendingDraft.orderCode} preservado. Tente confirmar novamente.</span>}</p>
        {error.section && <a href={`#${error.section}`} onClick={(event) => {
          event.preventDefault();
          document.getElementById(event.currentTarget.hash.slice(1))?.focus();
        }}>Revisar {saleSections[error.section].toLocaleLowerCase('pt-BR')}</a>}
      </div>}
      <footer className="sale-editor-footer">
        {draft?.status === 'DRAFT' && <button type="submit" data-action="save-draft" className="button button--secondary" disabled={saving || uploading}>Salvar rascunho</button>}
        <div><button type="button" className="button button--secondary" onClick={onClose} disabled={saving || uploading}>Cancelar</button></div>
        <div><button type="submit" className="button button--primary" disabled={saving || uploading}>{saving ? 'Salvando...' : confirmedEdit ? 'Salvar alterações' : draft ? 'Confirmar pedido' : pendingDraft ? 'Tentar confirmar' : 'Registrar venda de serviço'}</button></div>
      </footer>
    </form>
    {selectedService && serviceDraft && <SaleServiceModal
      service={selectedService}
      line={serviceDraft}
      canChangePrice={canChangePrice}
      onChange={(field, value) => setServiceDraft((current) => current ? changeItem(current, field, value) : null)}
      onSave={saveService}
      onClose={closeServiceModal}
      returnFocus={serviceToggleRef}
    />}
    {customerModalOpen && <CustomerForm onClose={closeCustomerModal} onSave={async (input) => { await customerSave.mutateAsync(input); }} saving={customerSave.isPending} saveError={customerSave.error} />}
    {serviceCreateOpen && <ServiceCreateModal companyId={companyId} onClose={() => setServiceCreateOpen(false)} onCreated={(service, municipalCodeSaved) => {
      setServiceCreateOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['sales-services', companyId] });
      if (!municipalCodeSaved) setError({ message: 'Serviço cadastrado, mas o código municipal não foi salvo. Ajuste-o no cadastro de Serviços.' });
      chooseService(service);
    }} />}
  </main>;
}

function SaleServiceModal({ service, line, canChangePrice, onChange, onSave, onClose, returnFocus }: {
  service: Service;
  canChangePrice: boolean;
  line: ItemLine;
  onChange: (field: 'quantity' | 'unitPrice' | 'discountAmount' | 'discountPercent', value: string) => void;
  onSave: () => void;
  onClose: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [error, setError] = useState('');
  closeRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled])') ?? []);
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', onKeyDown); returnFocus.current?.focus(); };
  }, [returnFocus]);

  const locked = priceLocked(line, canChangePrice);
  function submitItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validItem(line)) { setError('Revise a quantidade, o valor e o desconto. O desconto não pode superar o valor do serviço.'); return; }
    onSave();
  }

  return <div className="sale-service-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="sale-service-modal" role="dialog" aria-modal="true" aria-labelledby="sale-service-modal-title">
      <header className="sale-service-modal__header"><div><span>ADICIONAR SERVIÇO</span><h2 id="sale-service-modal-title">{service.name}</h2><p>Defina os valores deste item antes de incluir na venda.</p></div><button type="button" onClick={onClose} aria-label="Fechar janela"><X size={19} /></button></header>
      <form onSubmit={submitItem}>
        <div className="sale-service-modal__fields">
          <label className="sale-field"><span>Quantidade</span><input type="number" min="0.0001" step="any" value={line.quantity} onChange={(event) => { setError(''); onChange('quantity', event.target.value); }} required /></label>
          <label className="sale-field"><span>Valor unitário (R$)</span><input type="number" readOnly={locked} aria-describedby={locked ? 'sale-service-price-hint' : undefined} min="0" step="0.01" value={line.unitPrice} onChange={(event) => { setError(''); onChange('unitPrice', event.target.value); }} required /></label>
          <label className="sale-field"><span>Desconto em R$</span><input type="number" readOnly={locked} aria-describedby={locked ? 'sale-service-price-hint' : undefined} min="0" step="0.01" value={line.discountAmount} onChange={(event) => { setError(''); onChange('discountAmount', event.target.value); }} /></label>
          <label className="sale-field"><span>Desconto em %</span><input type="number" readOnly={locked} aria-describedby={locked ? 'sale-service-price-hint' : undefined} min="0" max="100" step="0.01" value={line.discountPercent} onChange={(event) => { setError(''); onChange('discountPercent', event.target.value); }} /></label>
        </div>
        {!canChangePrice && <p id="sale-service-price-hint" className="sale-field-hint">{PERMISSION_DENIED_MESSAGE}</p>}
        <div className="sale-service-modal__summary"><div><span>Valor bruto</span><strong>{brl(grossCents(line) / 100)}</strong></div><div><span>Desconto</span><strong>{brl((discountCents(line.discountAmount) || 0) / 100)}</strong></div><div><span>Total do item</span><strong>{brl(lineTotalCents(line) / 100)}</strong></div></div>
        {error && <p className="sale-service-modal__error" role="alert">{error}</p>}
        <footer className="sale-service-modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary">Salvar serviço</button></footer>
      </form>
    </div>
  </div>;
}
