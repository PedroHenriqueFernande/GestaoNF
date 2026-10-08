import { Fragment, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, ArrowDownLeft, ArrowRight, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Filter, Landmark, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { api, type FinanceFilters, type FinancePayment, type FinanceSettlement, type PaymentMethod, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { FinancePaymentModal } from './FinancePaymentModal';
import { currency, methodName, methodOptions, shortDate } from './finance-utils';
import './finance.css';

const PAGE_SIZE = 20;
const emptyFilters = (): FinanceFilters => ({ dateBasis: 'SALE', settlement: 'ALL', overdue: 'ALL' });

function paymentState(payment: FinancePayment): string {
  if (payment.isOverdue) return 'Vencido';
  return payment.settlement === 'PAID' ? 'Recebido' : payment.settlement === 'PARTIAL' ? 'Parcial' : 'Pendente';
}

function paymentStatusClass(payment: FinancePayment): string {
  return payment.isOverdue ? 'overdue' : payment.settlement.toLowerCase();
}

export function FinancePage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [draft, setDraft] = useState<FinanceFilters>(emptyFilters);
  const [applied, setApplied] = useState<FinanceFilters>(emptyFilters);
  const [filterError, setFilterError] = useState('');
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [pageIndex, setPageIndex] = useState(0);
  const [selectedPayment, setSelectedPayment] = useState<{ saleId: string; installmentId: string } | null>(null);
  const [toast, setToast] = useState('');
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => { if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(timer); }, [toast]);
  const cursor = cursors[pageIndex] ?? null;
  const list = useQuery({ queryKey: ['finance-receivables', companyId, applied, cursor], queryFn: () => api.financeReceivables(companyId, applied, cursor, PAGE_SIZE), enabled: !!companyId });
  const summary = useQuery({ queryKey: ['finance-summary', companyId, applied], queryFn: () => api.financeSummary(companyId, applied), enabled: !!companyId });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/financeiro'); } });

  function changeCompany(next: string) {
    setCompanyId(next); setDraft(emptyFilters()); setApplied(emptyFilters()); setCursors([null]); setPageIndex(0);
    setSelectedPayment(null); setFilterError(''); setToast('');
  }

  function changeDraft<K extends keyof FinanceFilters>(key: K, value: FinanceFilters[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    if (filterError) setFilterError('');
  }

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const orderCode = draft.orderCode?.trim() ?? '';
    const paycode = draft.paycode?.trim() ?? '';
    if (orderCode && !/^\d{5}$/.test(orderCode)) { setFilterError('O número do pedido deve ter cinco dígitos.'); return; }
    if (paycode && !/^\d{4}$/.test(paycode)) { setFilterError('O número do recebimento (Código do pagamento) deve ter quatro dígitos.'); return; }
    if (draft.dateFrom && draft.dateTo && draft.dateFrom > draft.dateTo) { setFilterError('A data inicial deve ser anterior à data final.'); return; }
    const next: FinanceFilters = {
      dateBasis: draft.dateBasis, settlement: draft.settlement, overdue: draft.overdue,
      ...(draft.search?.trim() ? { search: draft.search.trim() } : {}),
      ...(orderCode ? { orderCode } : {}), ...(paycode ? { paycode } : {}),
      ...(draft.workOrderNumber?.trim() ? { workOrderNumber: draft.workOrderNumber.trim() } : {}),
      ...(draft.dateFrom ? { dateFrom: draft.dateFrom } : {}), ...(draft.dateTo ? { dateTo: draft.dateTo } : {}),
      ...(draft.paymentMethod ? { paymentMethod: draft.paymentMethod } : {}),
    };
    setApplied(next); setCursors([null]); setPageIndex(0); setFilterError('');
  }

  function clearFilters() {
    setDraft(emptyFilters()); setApplied(emptyFilters()); setCursors([null]); setPageIndex(0); setFilterError('');
  }

  function nextPage() {
    if (!list.data?.nextCursor) return;
    setCursors((current) => [...current.slice(0, pageIndex + 1), list.data!.nextCursor]);
    setPageIndex((value) => value + 1);
  }

  function changed(message: string) {
    setToast(message);
    queryClient.invalidateQueries({ queryKey: ['finance-receivables', companyId] });
    queryClient.invalidateQueries({ queryKey: ['finance-summary', companyId] });
  }

  const filtered = !!(applied.search || applied.orderCode || applied.paycode || applied.workOrderNumber || applied.dateFrom || applied.dateTo || applied.paymentMethod || applied.settlement !== 'ALL' || applied.overdue !== 'ALL');
  const count = summary.data?.paymentCount ?? 0;

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={changeCompany} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="finance-workspace">
    <main id="workspace-main" className="finance-main" tabIndex={-1}>
      <header className="finance-page-header"><div><span className="finance-eyebrow">GESTÃO / CONTAS A RECEBER</span><h1>Financeiro</h1><p>Acompanhe o que entrou, o que falta receber e os vencimentos de cada venda.</p></div><button type="button" className="finance-refresh" onClick={() => { list.refetch(); summary.refetch(); }} disabled={list.isFetching || summary.isFetching || !companyId}><RefreshCw size={16} className={list.isFetching || summary.isFetching ? 'is-spinning' : ''} /> Atualizar</button></header>

      <section className="finance-overview" aria-label="Resumo financeiro">
        <div className="finance-overview__lead"><span className="finance-overview__eyebrow"><Landmark size={15} /> CARTEIRA DE RECEBIMENTOS</span><span className="finance-overview__label">Em aberto</span><strong>{summary.isPending ? '—' : summary.isError ? 'Indisponível' : currency(summary.data.remainingAmount)}</strong><small>{summary.isError ? 'Não foi possível atualizar o resumo' : `${summary.data?.saleCount ?? '—'} vendas no período selecionado`}</small></div>
        <div className="finance-overview__metrics"><div><span>Total previsto</span><strong>{summary.data ? currency(summary.data.originalAmount) : '—'}</strong><small>Valor das formas de pagamento</small></div><div><span>Já recebido</span><strong>{summary.data ? currency(summary.data.paidAmount) : '—'}</strong><small>Baixas líquidas registradas</small></div><div className="finance-overview__late"><span>Em atraso</span><strong>{summary.data ? currency(summary.data.overdueAmount) : '—'}</strong><small>Saldo com vencimento ultrapassado</small></div></div>
      </section>

      <section className="finance-filters" aria-labelledby="finance-filter-heading"><div className="finance-filters__heading"><div><Filter size={17} /><h2 id="finance-filter-heading">Filtrar recebimentos</h2></div><span>Os filtros afetam a lista e o resumo acima</span></div>
        <form onSubmit={applyFilters}>
          <div className="finance-filters__lookup">
            <label className="finance-field finance-field--search"><span>Cliente</span><span className="finance-input-icon"><Search size={15} /><input value={draft.search ?? ''} onChange={(event) => changeDraft('search', event.target.value)} placeholder="Buscar pelo nome do cliente" maxLength={100} /></span></label>
            <label className="finance-field"><span>Nº do pedido</span><input inputMode="numeric" value={draft.orderCode ?? ''} onChange={(event) => changeDraft('orderCode', event.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="Código de 5 dígitos" maxLength={5} /></label>
            <label className="finance-field"><span>Nº do recebimento</span><input inputMode="numeric" value={draft.paycode ?? ''} onChange={(event) => changeDraft('paycode', event.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Código do pagamento · 4 dígitos" maxLength={4} /></label>
          </div>
          <div className="finance-filters__primary">
            <label className="finance-field"><span>Situação</span><span className="finance-native-select"><select value={draft.settlement} onChange={(event) => changeDraft('settlement', event.target.value as FinanceSettlement)}><option value="ALL">Todas</option><option value="PENDING">Pendente</option><option value="PARTIAL">Parcial</option><option value="PAID">Recebido</option></select><ChevronDown size={15} /></span></label>
            <label className="finance-field"><span>Período por</span><span className="finance-native-select"><select value={draft.dateBasis} onChange={(event) => changeDraft('dateBasis', event.target.value as FinanceFilters['dateBasis'])}><option value="SALE">Data da venda</option><option value="DUE">Vencimento</option><option value="RECEIPT">Data da baixa</option></select><ChevronDown size={15} /></span></label>
            <label className="finance-field"><span>Data inicial</span><input type="date" value={draft.dateFrom ?? ''} onChange={(event) => changeDraft('dateFrom', event.target.value)} /></label>
            <label className="finance-field"><span>Data final</span><input type="date" value={draft.dateTo ?? ''} onChange={(event) => changeDraft('dateTo', event.target.value)} /></label>
          </div>
          <div className="finance-filters__secondary">
            <label className="finance-field"><span>Vencimento</span><span className="finance-native-select"><select value={draft.overdue} onChange={(event) => changeDraft('overdue', event.target.value as FinanceFilters['overdue'])}><option value="ALL">Todos</option><option value="ONLY">Somente vencidos</option><option value="EXCLUDE">Não vencidos</option></select><ChevronDown size={15} /></span></label>
            <label className="finance-field"><span>Forma de pagamento</span><span className="finance-native-select"><select value={draft.paymentMethod ?? ''} onChange={(event) => changeDraft('paymentMethod', (event.target.value || undefined) as PaymentMethod | undefined)}><option value="">Todas</option>{methodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} /></span></label>
            <label className="finance-field"><span>Nº da OS</span><input value={draft.workOrderNumber ?? ''} onChange={(event) => changeDraft('workOrderNumber', event.target.value)} placeholder="Buscar pela OS" maxLength={40} /></label>
          </div>
          {filterError && <p className="finance-filters__error" role="alert">{filterError}</p>}
          <div className="finance-filters__actions"><div><button type="button" className="finance-clear-button" onClick={clearFilters}><RotateCcw size={14} /> Limpar</button><button type="submit" className="button button--primary"><Search size={15} /> Aplicar filtros</button></div></div>
        </form>
      </section>

      <section className="finance-ledger" aria-labelledby="finance-ledger-heading"><div className="finance-ledger__heading"><div><span className="finance-ledger__accent" /><div><h2 id="finance-ledger-heading">Recebimentos</h2><p>{summary.isPending ? 'Carregando carteira...' : `${count} ${count === 1 ? 'recebimento' : 'recebimentos'} em ${summary.data?.saleCount ?? 0} ${summary.data?.saleCount === 1 ? 'venda' : 'vendas'}`}</p></div></div><span className="finance-ledger__hint"><CircleHelp size={14} /> Cada linha representa uma forma de pagamento</span></div>
        {list.isPending ? <div className="finance-loading" aria-label="Carregando recebimentos"><div /><div /><div /><div /></div> : list.isError ? <div className="finance-empty" role="alert"><AlertCircle size={30} /><h3>Não foi possível carregar os recebimentos</h3><p>Confira sua conexão e tente novamente.</p><button type="button" className="button button--secondary" onClick={() => list.refetch()}>Tentar novamente</button></div> : list.data.items.length === 0 ? <div className="finance-empty"><span className="finance-empty__icon"><ArrowDownLeft size={27} /></span><h3>{filtered ? 'Nenhum recebimento encontrado' : 'Os recebimentos aparecerão aqui'}</h3><p>{filtered ? 'Altere os filtros ou consulte outro período.' : 'Confirme uma venda no Portal de Serviços para acompanhar os pagamentos no Financeiro.'}</p>{filtered ? <button type="button" className="button button--secondary" onClick={clearFilters}>Limpar filtros</button> : <Link to="/portal-de-servicos" className="button button--primary">Ir para o Portal de Serviços <ArrowRight size={15} /></Link>}</div> : <>
          <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Recebimento</th><th>Forma</th><th>Valor</th><th>Baixado</th><th>Em aberto</th><th>Vencimento</th><th>Situação</th><th aria-label="Ações" /></tr></thead><tbody>{list.data.items.map((sale) => <Fragment key={sale.saleId}><tr className="finance-table__group"><td colSpan={8}><div className="finance-group"><div className="finance-group__identity"><span className="finance-group__order">#{sale.orderCode}</span><strong>{sale.customerName}</strong><span>Venda em {shortDate(sale.soldOn)}</span>{sale.workOrderNumber && <span>OS {sale.workOrderNumber}</span>}</div><div className="finance-group__totals"><span>Pedido {currency(sale.totalAmount)}</span><span>Em aberto <strong>{currency(sale.remainingAmount)}</strong></span></div></div></td></tr>{sale.payments.map((payment) => <tr key={payment.receivableId} className={!payment.matchesFilter ? 'finance-table__context' : ''}><td><button type="button" className="finance-payment-link" onClick={() => setSelectedPayment({ saleId: sale.saleId, installmentId: payment.installmentId })}>{payment.number === 1 ? 'Recebimento' : `Recebimento ${payment.number}`}</button><small>Código do pagamento {payment.paycode}{!payment.matchesFilter && <em> · Mesmo pedido</em>}</small></td><td>{methodName(payment.paymentMethod)}</td><td className="finance-money">{currency(payment.originalAmount)}</td><td className="finance-money finance-money--paid"><span className="finance-progress"><span style={{ width: `${Math.min(100, Math.max(0, Number(payment.paidAmount) / Number(payment.originalAmount) * 100))}%` }} /></span>{currency(payment.paidAmount)}</td><td className="finance-money finance-money--open">{currency(payment.remainingAmount)}</td><td><span className={payment.isOverdue ? 'finance-due finance-due--late' : 'finance-due'}>{payment.dueOn ? shortDate(payment.dueOn) : 'Sem vencimento'}</span></td><td><span className={`finance-status finance-status--${paymentStatusClass(payment)}`}>{paymentState(payment)}</span></td><td><button type="button" className="finance-row-open" aria-label={`Abrir recebimento ${payment.paycode} do pedido ${sale.orderCode}`} onClick={() => setSelectedPayment({ saleId: sale.saleId, installmentId: payment.installmentId })}><ArrowRight size={17} /></button></td></tr>)}</Fragment>)}</tbody></table></div>
          <div className="finance-mobile-list">{list.data.items.map((sale) => <section key={sale.saleId} className="finance-mobile-group"><div className="finance-mobile-group__head"><span>#{sale.orderCode}</span><strong>{sale.customerName}</strong><small>{shortDate(sale.soldOn)}{sale.workOrderNumber ? ` · OS ${sale.workOrderNumber}` : ''}</small></div>{sale.payments.map((payment) => <button key={payment.receivableId} type="button" className={`finance-mobile-payment${!payment.matchesFilter ? ' is-context' : ''}`} onClick={() => setSelectedPayment({ saleId: sale.saleId, installmentId: payment.installmentId })}><span><strong>{payment.number === 1 ? 'Recebimento' : `Recebimento ${payment.number}`}</strong><span className={`finance-status finance-status--${paymentStatusClass(payment)}`}>{paymentState(payment)}</span></span><small>Código do pagamento {payment.paycode} · {methodName(payment.paymentMethod)}</small><span><b>{currency(payment.originalAmount)}</b><b className="finance-mobile-payment__open">{currency(payment.remainingAmount)} em aberto</b></span><small>{payment.dueOn ? `Vencimento ${shortDate(payment.dueOn)}` : 'Sem vencimento'}</small></button>)}</section>)}</div>
          <footer className="finance-ledger__footer"><span>Página {pageIndex + 1} · {list.data.items.length} {list.data.items.length === 1 ? 'pedido' : 'pedidos'} nesta página</span><div><button type="button" aria-label="Página anterior" disabled={pageIndex === 0} onClick={() => setPageIndex((value) => value - 1)}><ChevronLeft size={16} /></button><span>{pageIndex + 1}</span><button type="button" aria-label="Próxima página" disabled={!list.data.nextCursor} onClick={nextPage}><ChevronRight size={16} /></button></div></footer>
        </>}
      </section>
    </main>
    {selectedPayment && <FinancePaymentModal companyId={companyId} saleId={selectedPayment.saleId} installmentId={selectedPayment.installmentId} onClose={() => setSelectedPayment(null)} onChanged={changed} />}
    {toast && <div className="action-toast" role="status"><div className="action-toast__body"><strong>Financeiro</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
