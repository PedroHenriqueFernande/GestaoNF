import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Building2, CalendarDays, ChevronDown, CreditCard, Plus, Trash2, UsersRound, X } from 'lucide-react';
import { api, ApiError, type Company, type Customer, type CustomerInput, type PaymentMethod, type SaleDetail, type SaleInput, type Service } from '../../api/client';
import { CustomerForm } from '../customers/CustomerForm';
import { SaleDropdown } from './SaleDropdown';

type ItemLine = { key: string; serviceId: string; name: string; quantity: string; unitPrice: string; discountAmount: string; discountPercent: string; discountBasis: 'AMOUNT' | 'PERCENT' };
type PaymentLine = { key: string; paymentMethod: PaymentMethod; amount: string; dueOn: string; state: 'PAID' | 'PENDING'; receivedOn: string };
const methods: { value: PaymentMethod; label: string }[] = [
  { value: 'PIX', label: 'PIX' }, { value: 'CASH', label: 'Dinheiro' }, { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' }, { value: 'BOLETO', label: 'Boleto' }, { value: 'TRANSFER', label: 'Transferência' }, { value: 'OTHER', label: 'Outra' },
];
const paymentStates: { value: PaymentLine['state']; label: string }[] = [{ value: 'PENDING', label: 'Pendente' }, { value: 'PAID', label: 'Já recebida' }];
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

export function SaleEditor({ companyId, companies, draft, onCompanyChange, onClose, onCreated }: {
  companyId: string; companies: Company[]; draft?: SaleDetail | null; onCompanyChange: (id: string) => void; onClose: () => void; onCreated: (sale: SaleDetail) => void;
}) {
  const [customerId, setCustomerId] = useState(draft?.customerId ?? '');
  const [customerInput, setCustomerInput] = useState(draft?.customerNameSnapshot ?? '');
  const [customerTerm, setCustomerTerm] = useState('');
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerHighlight, setCustomerHighlight] = useState(0);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [serviceInput, setServiceInput] = useState('');
  const [serviceTerm, setServiceTerm] = useState('');
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceHighlight, setServiceHighlight] = useState(0);
  const [items, setItems] = useState<ItemLine[]>(draft?.items.map((item) => ({ key: crypto.randomUUID(), serviceId: item.serviceId, name: item.serviceNameSnapshot, quantity: item.quantity, unitPrice: item.unitPrice, discountAmount: item.discountAmount, discountPercent: discountPercent(item.discountAmount, Math.round(Number(item.grossAmount) * 100)), discountBasis: 'AMOUNT' })) ?? []);
  const [serviceDraft, setServiceDraft] = useState<ItemLine | null>(null);
  const [payments, setPayments] = useState<PaymentLine[]>(draft?.installments.map((part) => ({ key: crypto.randomUUID(), paymentMethod: part.paymentMethod, amount: part.amount, dueOn: part.dueOn ?? today(), state: part.initialReceivedOn ? 'PAID' : 'PENDING', receivedOn: part.initialReceivedOn ?? today() })) ?? [{ key: crypto.randomUUID(), paymentMethod: 'PIX', amount: '', dueOn: today(), state: 'PENDING', receivedOn: today() }]);
  const [soldOn, setSoldOn] = useState(draft?.soldOn ?? today());
  const [workOrderNumber, setWorkOrderNumber] = useState(draft?.workOrderNumber ?? '');
  const [notes, setNotes] = useState(draft?.notes ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<SaleDetail | null>(draft ?? null);
  const createKey = useRef(crypto.randomUUID());
  const paymentRef = useRef<HTMLElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const serviceInputRef = useRef<HTMLInputElement>(null);
  const serviceToggleRef = useRef<HTMLButtonElement>(null);
  const customerSavePending = useRef(false);
  const queryClient = useQueryClient();

  const customers = useQuery({ queryKey: ['sales-customers', companyId, customerTerm], queryFn: () => api.customers(companyId, { search: customerTerm, status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId });
  const services = useQuery({ queryKey: ['sales-services', companyId, serviceTerm], queryFn: () => api.services(companyId, { search: serviceTerm, status: 'ACTIVE', page: 0, limit: 100 }), enabled: !!companyId });
  const serviceOptions = services.data?.items ?? [];
  const customerOptions = customers.data?.items ?? [];
  const total = items.reduce((sum, line) => sum + lineTotalCents(line), 0) / 100;
  const paymentTotal = payments.reduce((sum, line) => sum + (money(line.amount) || 0), 0);

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
    setCustomerHighlight(0);
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
    if (event.key === 'Escape') { setCustomerOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!customerOpen) { setCustomerOpen(true); return; }
      if (customerOptions.length) setCustomerHighlight((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + customerOptions.length) % customerOptions.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (customerOpen && customerOptions[customerHighlight]) chooseCustomer(customerOptions[customerHighlight]);
    }
  }

  function chooseService(service: Service) {
    setSelectedService(service);
    setServiceDraft({ key: crypto.randomUUID(), serviceId: service.id, name: service.name, quantity: '1', unitPrice: service.suggestedUnitPrice ?? '0.00', discountAmount: '0.00', discountPercent: '0.00', discountBasis: 'AMOUNT' });
    setServiceInput(service.name);
    setServiceTerm('');
    setServiceOpen(false);
    setServiceHighlight(0);
  }

  function handleServiceKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') { setServiceOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!serviceOpen) { setServiceOpen(true); return; }
      if (serviceOptions.length) setServiceHighlight((current) => (current + (event.key === 'ArrowDown' ? 1 : -1) + serviceOptions.length) % serviceOptions.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (serviceOpen && serviceOptions[serviceHighlight]) chooseService(serviceOptions[serviceHighlight]);
    }
  }

  function changeCompany(id: string) {
    if (id === companyId) return;
    onCompanyChange(id);
    setCustomerId(''); setCustomerTerm(''); setCustomerInput(''); setCustomerOpen(false); setCustomerHighlight(0); setServiceTerm(''); setServiceInput('');
    setSelectedService(null); setServiceDraft(null); setServiceOpen(false); setServiceHighlight(0); setItems([]); setPendingDraft(null); createKey.current = crypto.randomUUID();
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
    setError('');
    setItems((current) => [...current, serviceDraft]);
    closeServiceModal();
  }

  function addPayment() {
    setPayments((current) => [...current, { key: crypto.randomUUID(), paymentMethod: 'PIX', amount: '', dueOn: today(), state: 'PENDING', receivedOn: today() }]);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!companyId || !customerId || !items.length || !soldOn) { setError('Selecione a empresa e o cliente e adicione ao menos um serviço.'); return; }
    if (!payments.length || items.some((line) => !validItem(line)) ||
      payments.some((line) => !fixed(line.amount, 2) || (line.state === 'PENDING' ? !line.dueOn : !line.receivedOn))) {
      setError('Revise quantidade, valores e datas dos serviços e dos recebimentos.'); return;
    }
    if (Math.abs(Math.round(total * 100) - Math.round(paymentTotal * 100)) > 0 || total <= 0) {
      setError('A soma das formas de pagamento precisa ser igual ao total dos serviços.'); paymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    const payload: SaleInput = {
      customerId, soldOn, workOrderNumber: workOrderNumber.trim() || null, notes: notes.trim() || null,
      items: items.map((line) => ({ serviceId: line.serviceId, quantity: fixed(line.quantity, 4)!, unitPrice: fixed(line.unitPrice, 2)!, discountAmount: fixed(line.discountAmount || '0', 2)! })),
      installments: payments.map((line) => ({ paymentMethod: line.paymentMethod, amount: fixed(line.amount, 2)!, ...(line.state === 'PAID' ? { receivedOn: line.receivedOn } : { dueOn: line.dueOn }) })),
    };
    setSaving(true);
    try {
      const draft = pendingDraft ? await api.updateSale(companyId, pendingDraft.id, pendingDraft.version, payload) : await api.createSale(companyId, payload, createKey.current);
      setPendingDraft(draft);
      const initialReceipts = payments.flatMap((line, index) => line.state === 'PAID' ? [{ installmentId: draft.installments[index].id, amount: fixed(line.amount, 2)!, paymentMethod: line.paymentMethod, receivedOn: line.receivedOn }] : []);
      const confirmed = await api.confirmSale(companyId, draft.id, draft.version, initialReceipts);
      onCreated(confirmed);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409 && pendingDraft) {
        const latest = await api.sale(companyId, pendingDraft.id).catch(() => null);
        if (latest?.status === 'CONFIRMED') { onCreated(latest); return; }
      }
      setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a venda. Tente novamente.');
    } finally { setSaving(false); }
  }

  return <main id="workspace-main" className="sale-editor-page" tabIndex={-1}>
    <div className="sale-editor-topline"><button type="button" className="sale-back" onClick={onClose} disabled={saving}><ArrowLeft size={17} /> Portal de Serviços</button><span>{draft ? `RASCUNHO #${draft.orderCode}` : 'NOVO LANÇAMENTO'}</span></div>
    <div className="sale-editor-heading"><div><span className="sale-eyebrow">GESTÃO DE SERVIÇOS</span><h1>{draft ? `Continuar pedido #${draft.orderCode}` : 'Nova venda de serviço'}</h1><p>Registre o serviço, combine os recebimentos e marque o que já foi recebido.</p></div><div className="sale-editor-heading__total"><span>TOTAL DA VENDA</span><strong>{brl(total)}</strong></div></div>
    <form onSubmit={submit} className="sale-editor-form">
      <section className="sale-editor-section sale-editor-section--identity"><div className="sale-section-heading"><div className="sale-section-number">01</div><div><h2>Dados do lançamento</h2><p>Empresa, cliente e referências da venda</p></div></div>
        <div className="sale-identity-grid">
          <div className="sale-field"><span><Building2 size={14} /> Empresa</span><SaleDropdown label="Empresa" value={companyId} options={companies.map((company) => ({ value: company.id, label: company.name }))} onChange={changeCompany} disabled={saving || !!draft} /></div>
          <div className="sale-field sale-field--customer"><span><UsersRound size={14} /> Cliente <button type="button" className="sale-customer-new" onClick={() => { setCustomerOpen(false); customerSave.reset(); setCustomerModalOpen(true); }} disabled={saving} aria-label="Novo cliente"><Plus size={13} /> Novo</button></span>
            <div className="sale-lookup-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setCustomerOpen(false); }}>
              <div className="sale-lookup-combobox">
                <input ref={customerInputRef} role="combobox" aria-label="Buscar cliente" aria-autocomplete="list" aria-expanded={customerOpen} aria-controls="sale-customer-options" aria-activedescendant={customerOpen && customerOptions[customerHighlight] ? `sale-customer-option-${customerOptions[customerHighlight].id}` : undefined} autoComplete="off" placeholder="Buscar ou selecionar cliente" value={customerInput} disabled={saving} onFocus={() => setCustomerOpen(true)} onChange={(event) => { setCustomerInput(event.target.value); setCustomerId(''); setCustomerOpen(true); setCustomerHighlight(0); }} onKeyDown={handleCustomerKeyDown} />
                <button type="button" aria-label="Mostrar clientes" aria-expanded={customerOpen} disabled={saving} onClick={() => { const shouldOpen = !customerOpen; customerInputRef.current?.focus(); setCustomerOpen(shouldOpen); }}><ChevronDown size={16} /></button>
              </div>
              {customerOpen && <div id="sale-customer-options" className="sale-lookup-options" role="listbox" aria-label="Clientes cadastrados">
                {customers.isPending ? <div className="sale-lookup-message">Carregando clientes...</div> : customers.isError ? <div className="sale-lookup-message">Não foi possível carregar clientes. <button type="button" onClick={() => customers.refetch()}>Tentar novamente</button></div> : customerOptions.length ? <>
                  {customerOptions.map((entry, index) => <button key={entry.id} id={`sale-customer-option-${entry.id}`} type="button" role="option" aria-selected={entry.id === customerId} className={`sale-lookup-option${index === customerHighlight ? ' is-highlighted' : ''}`} onMouseEnter={() => setCustomerHighlight(index)} onClick={() => chooseCustomer(entry)}><strong>{entry.name}</strong>{(entry.taxId || entry.phone) && <small>{[entry.taxId, entry.phone].filter(Boolean).join(' · ')}</small>}</button>)}
                  {(customers.data?.total ?? 0) > customerOptions.length && <div className="sale-lookup-message">Digite para encontrar outros clientes.</div>}
                </> : <div className="sale-lookup-message">Nenhum cliente encontrado.</div>}
              </div>}
            </div>
          </div>
          <label className="sale-field"><span><CalendarDays size={14} /> Data da venda</span><input type="date" value={soldOn} onChange={(event) => setSoldOn(event.target.value)} required /></label>
          <label className="sale-field"><span>Número da OS</span><input value={workOrderNumber} onChange={(event) => setWorkOrderNumber(event.target.value)} maxLength={40} placeholder="Opcional · Ex.: OS-0021" /></label>
        </div>
        <div className="sale-identity-continue"><span>Os demais campos já estão disponíveis para preenchimento.</span></div>
      </section>

      <section className="sale-editor-section"><div className="sale-section-heading"><div className="sale-section-number">02</div><div><h2>Serviços vendidos</h2><p>Adicione um ou mais serviços e ajuste os valores desta venda</p></div></div>
        <div className="sale-add-service">
          <div className="sale-lookup-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setServiceOpen(false); }}>
            <div className="sale-lookup-combobox">
              <input ref={serviceInputRef} role="combobox" aria-label="Buscar serviço" aria-autocomplete="list" aria-expanded={serviceOpen} aria-controls="sale-service-options" aria-activedescendant={serviceOpen && serviceOptions[serviceHighlight] ? `sale-service-option-${serviceOptions[serviceHighlight].id}` : undefined} autoComplete="off" placeholder="Buscar ou selecionar serviço" value={serviceInput} disabled={saving} onFocus={() => setServiceOpen(true)} onChange={(event) => { setServiceInput(event.target.value); setSelectedService(null); setServiceOpen(true); setServiceHighlight(0); }} onKeyDown={handleServiceKeyDown} />
              <button ref={serviceToggleRef} type="button" aria-label="Mostrar serviços" aria-expanded={serviceOpen} disabled={saving} onClick={() => { const shouldOpen = !serviceOpen; serviceInputRef.current?.focus(); setServiceOpen(shouldOpen); }}><ChevronDown size={16} /></button>
            </div>
            {serviceOpen && <div id="sale-service-options" className="sale-lookup-options" role="listbox" aria-label="Serviços cadastrados">
              {services.isPending ? <div className="sale-lookup-message">Carregando serviços...</div> : services.isError ? <div className="sale-lookup-message">Não foi possível carregar serviços. <button type="button" onClick={() => services.refetch()}>Tentar novamente</button></div> : serviceOptions.length ? <>
                {serviceOptions.map((service, index) => <button key={service.id} id={`sale-service-option-${service.id}`} type="button" role="option" aria-selected={service.id === selectedService?.id} className={`sale-lookup-option${index === serviceHighlight ? ' is-highlighted' : ''}`} onMouseEnter={() => setServiceHighlight(index)} onClick={() => chooseService(service)}><strong>{service.name}</strong>{(service.internalCode || service.suggestedUnitPrice) && <small>{[service.internalCode, service.suggestedUnitPrice ? brl(Number(service.suggestedUnitPrice)) : null].filter(Boolean).join(' · ')}</small>}</button>)}
                {(services.data?.total ?? 0) > serviceOptions.length && <div className="sale-lookup-message">Digite para encontrar outros serviços.</div>}
              </> : <div className="sale-lookup-message">Nenhum serviço encontrado.</div>}
            </div>}
          </div>
        </div>
        {!items.length ? <div className="sale-empty-lines">Nenhum serviço adicionado. Selecione um serviço acima para começar.</div> : <div className="sale-lines-scroll">
          <div className="sale-lines-head"><span>Serviço</span><span>Quantidade</span><span>Valor unitário</span><span>Desconto</span><span>Total</span><span /></div>
          {items.map((line) => <div key={line.key} className="sale-item-line">
            <strong title={line.name}>{line.name}</strong>
            <label className="sale-item-input"><span>Quantidade</span><input type="number" min="0.0001" step="any" aria-label={`Quantidade de ${line.name}`} value={line.quantity} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'quantity', event.target.value) : entry))} /></label>
            <label className="sale-item-input"><span>Valor unitário</span><input type="number" min="0" step="0.01" aria-label={`Valor unitário de ${line.name}`} value={line.unitPrice} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'unitPrice', event.target.value) : entry))} /></label>
            <div className="sale-line-discounts">
              <label className="sale-item-input"><span>Desconto em R$</span><input type="number" min="0" step="0.01" aria-label={`Desconto em reais de ${line.name}`} value={line.discountAmount} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'discountAmount', event.target.value) : entry))} /></label>
              <label className="sale-item-input"><span>Desconto em %</span><input type="number" min="0" max="100" step="0.01" aria-label={`Desconto percentual de ${line.name}`} value={line.discountPercent} onChange={(event) => setItems((current) => current.map((entry) => entry.key === line.key ? changeItem(entry, 'discountPercent', event.target.value) : entry))} /></label>
            </div>
            <span className="sale-line-total">{brl(lineTotalCents(line) / 100)}</span>
            <button type="button" className="sale-remove-line" onClick={() => setItems((current) => current.filter((entry) => entry.key !== line.key))} aria-label={`Remover ${line.name}`}><Trash2 size={16} /></button>
          </div>)}
        </div>}
        <div className="sale-subtotal"><span>Total dos serviços</span><strong>{brl(total)}</strong></div>
      </section>

      <section ref={paymentRef} id="sale-payment-section" className="sale-editor-section"><div className="sale-section-heading"><div className="sale-section-number">03</div><div><h2>Formas de pagamento</h2><p>Defina valores, vencimentos e recebimentos já realizados</p></div></div>
        <div className="sale-payment-list">{payments.map((line, index) => <div key={line.key} className="sale-payment-card"><div className="sale-payment-card__title"><strong>{index === 0 ? 'Recebimento' : `Recebimento ${index + 1}`}</strong><button type="button" aria-label={`Remover recebimento ${index + 1}`} onClick={() => setPayments((current) => current.filter((entry) => entry.key !== line.key))}><Trash2 size={15} /></button></div><div className="sale-payment-grid">
          <div className="sale-field"><span>Forma planejada</span><SaleDropdown label={`Forma planejada do recebimento ${index + 1}`} value={line.paymentMethod} options={methods} onChange={(paymentMethod) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, paymentMethod } : entry))} /></div>
          <label className="sale-field"><span>Valor</span><input type="number" min="0.01" step="0.01" value={line.amount} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, amount: event.target.value } : entry))} placeholder="0,00" /></label>
          <div className="sale-field"><span>Situação</span><SaleDropdown label={`Situação do recebimento ${index + 1}`} value={line.state} options={paymentStates} onChange={(state) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, state } : entry))} /></div>
          {line.state === 'PENDING' && <label className="sale-field"><span>Vencimento</span><input type="date" value={line.dueOn} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, dueOn: event.target.value } : entry))} required /></label>}
          {line.state === 'PAID' && <label className="sale-field"><span>Recebido em</span><input type="date" value={line.receivedOn} onChange={(event) => setPayments((current) => current.map((entry) => entry.key === line.key ? { ...entry, receivedOn: event.target.value } : entry))} required /></label>}
        </div></div>)}</div>
        <button type="button" className="sale-add-payment" onClick={addPayment}><Plus size={15} /> Adicionar forma de pagamento</button>
        <div className={`sale-payment-balance${Math.round(total * 100) === Math.round(paymentTotal * 100) && total > 0 ? ' is-matched' : ''}`}><span>Distribuído nos recebimentos</span><strong>{brl(paymentTotal)} <small>de {brl(total)}</small></strong></div>
      </section>

      <section className="sale-editor-section sale-editor-section--notes"><label className="sale-field"><span>Observações da venda</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} placeholder="Informações úteis para acompanhar este serviço" rows={3} /></label></section>
      {error && <div className="sale-form-error" role="alert">{error}{pendingDraft && <span> Rascunho #{pendingDraft.orderCode} preservado; tente confirmar novamente.</span>}</div>}
      <footer className="sale-editor-footer"><div><CreditCard size={18} /><span>Pedido e recebimentos serão registrados na empresa selecionada.</span></div><div><button type="button" className="button button--secondary" onClick={onClose} disabled={saving}>Cancelar</button><button type="submit" className="button button--primary" disabled={saving}>{saving ? 'Registrando...' : draft ? 'Confirmar pedido' : pendingDraft ? 'Tentar confirmar' : 'Registrar venda de serviço'}</button></div></footer>
    </form>
    {selectedService && serviceDraft && <SaleServiceModal
      service={selectedService}
      line={serviceDraft}
      onChange={(field, value) => setServiceDraft((current) => current ? changeItem(current, field, value) : null)}
      onSave={saveService}
      onClose={closeServiceModal}
      returnFocus={serviceToggleRef}
    />}
    {customerModalOpen && <CustomerForm onClose={closeCustomerModal} onSave={async (input) => { await customerSave.mutateAsync(input); }} saving={customerSave.isPending} saveError={customerSave.error} />}
  </main>;
}

function SaleServiceModal({ service, line, onChange, onSave, onClose, returnFocus }: {
  service: Service;
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
          <label className="sale-field"><span>Valor unitário (R$)</span><input type="number" min="0" step="0.01" value={line.unitPrice} onChange={(event) => { setError(''); onChange('unitPrice', event.target.value); }} required /></label>
          <label className="sale-field"><span>Desconto em R$</span><input type="number" min="0" step="0.01" value={line.discountAmount} onChange={(event) => { setError(''); onChange('discountAmount', event.target.value); }} /></label>
          <label className="sale-field"><span>Desconto em %</span><input type="number" min="0" max="100" step="0.01" value={line.discountPercent} onChange={(event) => { setError(''); onChange('discountPercent', event.target.value); }} /></label>
        </div>
        <div className="sale-service-modal__summary"><div><span>Valor bruto</span><strong>{brl(grossCents(line) / 100)}</strong></div><div><span>Desconto</span><strong>{brl((discountCents(line.discountAmount) || 0) / 100)}</strong></div><div><span>Total do item</span><strong>{brl(lineTotalCents(line) / 100)}</strong></div></div>
        {error && <p className="sale-service-modal__error" role="alert">{error}</p>}
        <footer className="sale-service-modal__footer"><button type="button" className="button button--secondary" onClick={onClose}>Cancelar</button><button type="submit" className="button button--primary">Salvar serviço</button></footer>
      </form>
    </div>
  </div>;
}
