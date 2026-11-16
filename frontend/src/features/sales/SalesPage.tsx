import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { AlertCircle, ArrowUpRight, ChevronLeft, ChevronRight, FilePlus2, Plus, RefreshCw, Search } from 'lucide-react';
import { api, ApiError, type Company, type Sale, type SaleDetail, type SaleStatus, type User } from '../../api/client';
import { CompanyLogo } from '../../components/CompanyLogo';
import { useCompanyScope } from '../../components/company-scope';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { SaleDetailPanel } from './SaleDetailPanel';
import { SaleEditor } from './SaleEditor';
import './sales.css';

const PAGE_SIZE = 20;
const currency = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'A definir';
const statusLabel = (value: SaleStatus) => value === 'CONFIRMED' ? 'Confirmado' : value === 'DRAFT' ? 'Rascunho' : 'Cancelado';
const sumLabel: Record<SaleStatus | 'ALL', string> = { ALL: 'Total sem cancelados', CONFIRMED: 'Total confirmado', DRAFT: 'Total em rascunho', CANCELED: 'Total cancelado' };

/** Identifica a empresa do pedido na visão consolidada: foto ou iniciais (decorativas) + nome para leitor de tela. */
function SaleCompany({ company }: { company: Company | undefined }) {
  const name = company?.name ?? 'Empresa';
  return <span className="sales-company" title={name}><CompanyLogo company={company} className="sales-company__logo" /><span className="sales-company__name">{name}</span></span>;
}

export function SalesPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<SaleStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editingDraft, setEditingDraft] = useState<SaleDetail | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ id: string; companyId: string } | null>(null);
  const [editorCompanyId, setEditorCompanyId] = useState('');
  const [toast, setToast] = useState('');
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const scope = useCompanyScope(user, companies.data);
  const multiple = scope.multiple;
  useEffect(() => {
    const id = params.get('editar');
    if (!id || !companies.data) return;
    const requestedCompany = params.get('empresa') ?? companyId;
    const clear = () => { const next = new URLSearchParams(params); next.delete('editar'); next.delete('empresa'); setParams(next, { replace: true }); };
    if (!companies.data.some(c => c.id === requestedCompany) || !/^[a-f0-9-]{36}$/i.test(id)) { setToast('Pedido ou empresa inválidos.'); clear(); return; }
    const inView = multiple?.ids.includes(requestedCompany) ?? false;
    if (!inView) { if (multiple) scope.clear(); if (companyId !== requestedCompany) { setCompanyId(requestedCompany); return; } }
    let active = true;
    void api.sale(requestedCompany, id).then(detail => {
      if (!active) return;
      if (detail.status === 'CANCELED') openDetail(detail.id, requestedCompany); else openEditor(detail);
      clear();
    }).catch(() => { if (active) { setToast('Não foi possível abrir o pedido. Tente novamente.'); clear(); } });
    return () => { active = false; };
  }, [params, setParams, companyId, companies.data, multiple, scope.clear]);
  useEffect(() => { if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => {
    if (params.get('novo') !== '1' || !companyId || !companies.data?.some((company) => company.id === companyId)) return;
    if (!editing) openEditor(null);
    setParams((previous) => { const next = new URLSearchParams(previous); next.delete('novo'); return next; }, { replace: true });
  }, [params, setParams, companyId, companies.data, editing]);
  useEffect(() => {
    // Clique em "Portal de Serviços" no menu lateral volta para a lista, como o botão de voltar do editor.
    if ((location.state as { workspaceNav?: boolean } | null)?.workspaceNav !== true) return;
    setEditing(false); setEditingDraft(null); setSelected(null);
  }, [location.key, location.state]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 5000); return () => clearTimeout(timer); }, [toast]);
  const list = useQuery({
    queryKey: multiple ? ['sales', 'overview', multiple.scopeKey, status, search, page] : ['sales', companyId, status, search, page],
    // A lista por empresa não tem total somado: `summary: null` mantém um único formato de dados para a tela.
    queryFn: async () => multiple ? api.salesOverview(multiple.param, { status, search, page, limit: PAGE_SIZE }) : { ...await api.sales(companyId, { status, search, page, limit: PAGE_SIZE }), summary: null },
    enabled: multiple ? true : !!companyId,
  });
  const companyById = useMemo(() => new Map((companies.data ?? []).map((company) => [company.id, company])), [companies.data]);
  const summary = list.data?.summary ?? null;
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/portal-de-servicos'); } });
  useEffect(() => {
    // Seleção desatualizada (vínculo ou contratação perdidos): volta para uma empresa, sem novas tentativas.
    if (multiple && list.error instanceof ApiError && list.error.status === 403) {
      scope.clear();
      setToast('Algumas empresas não estão mais disponíveis. Mostrando uma empresa.');
    }
  }, [list.error, multiple, scope.clear]);
  const maxPage = Math.max(0, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE) - 1);

  function changeCompany(next: string) { setCompanyId(next); setPage(0); setSelected(null); setEditing(false); setEditingDraft(null); setSearch(''); setSearchInput(''); setToast(''); }
  /** Seleção única no Portal: encerra a visão múltipla e usa a empresa escolhida. */
  function chooseSingle(next: string) { scope.clear(); changeCompany(next); }
  /** Editor sempre ligado a UMA empresa: a do pedido; na Nova venda, vazia com várias empresas ou a ativa com uma. */
  function openEditor(draft: SaleDetail | null) {
    setEditingDraft(draft);
    setEditorCompanyId(draft ? draft.companyId : multiple ? '' : companyId);
    setSelected(null);
    setEditing(true);
  }
  function openDetail(id: string, saleCompanyId: string) { setSelected({ id, companyId: saleCompanyId }); }
  function changeEditorCompany(next: string) {
    setEditorCompanyId(next);
    if (multiple) return; // com várias empresas, a escolha do editor não muda a visão nem a empresa ativa
    setCompanyId(next); setPage(0); setSearch(''); setSearchInput(''); setToast('');
  }
  function searchSales(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setPage(0); setSearch(searchInput.trim()); }
  function changed(message: string, saleCompanyId: string) {
    setToast(message);
    void queryClient.invalidateQueries({ queryKey: ['sales'] }); // lista por empresa e consolidada
    for (const key of ['sale-detail', 'finance-receivables', 'finance-summary', 'finance-detail']) void queryClient.invalidateQueries({ queryKey: [key, saleCompanyId] });
  }
  function created(sale: Sale) { const existing = editingDraft; setEditing(false); setEditingDraft(null); const action = existing?.status === 'DRAFT' && sale.status === 'CONFIRMED' ? 'confirmado' : existing ? 'atualizado' : 'registrado'; changed(`Pedido #${sale.orderCode} ${action} com sucesso.`, sale.companyId); if (!existing) openDetail(sale.id, sale.companyId); setPage(0); setStatus('ALL'); setSearch(''); setSearchInput(''); }
  function resume(draft: SaleDetail) { openEditor(draft); }
  async function openSale(sale: Sale) {
    if (openingId) return;
    if (sale.status === 'CANCELED') { openDetail(sale.id, sale.companyId); return; }
    setOpeningId(sale.id);
    try { const detail = await api.sale(sale.companyId, sale.id); openEditor(detail); }
    catch { setToast('Não foi possível abrir o pedido. Tente novamente.'); }
    finally { setOpeningId(null); }
  }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={chooseSingle} allowMultiple scope={scope} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="sales-workspace">
    {editing && companies.data ? <SaleEditor companyId={editorCompanyId} companies={companies.data} draft={editingDraft} onCompanyChange={changeEditorCompany} onClose={() => { setEditing(false); setEditingDraft(null); }} onDetails={editingDraft ? () => { setEditing(false); setEditingDraft(null); openDetail(editingDraft.id, editingDraft.companyId); } : undefined} onCreated={created} /> : <main id="workspace-main" className="sales-main" tabIndex={-1}>
      <div className="sales-page-head"><div><span className="sale-eyebrow">VENDAS / SERVIÇOS</span><h1>Portal de Serviços</h1><p>Acompanhe cada lançamento, do serviço vendido aos valores recebidos.</p></div><button type="button" className="button button--primary sales-create-button" onClick={() => openEditor(null)} disabled={!multiple && !companyId}><Plus size={17} /> Nova venda de serviço</button></div>
      {companies.isError && <div className="sales-error" role="alert">Não foi possível carregar suas empresas. <button onClick={() => companies.refetch()}>Tentar novamente</button></div>}
      <section className="sales-ledger" aria-labelledby="sales-ledger-title"><div className="sales-ledger__header"><div><span className="sales-ledger__line" /><h2 id="sales-ledger-title">Lançamentos</h2><span className="sales-ledger__count">{list.data?.total ?? '—'} pedidos</span>{multiple && <span className="sales-ledger__sum">{sumLabel[status]}: {summary ? currency(summary.amount) : '—'}</span>}</div><button type="button" onClick={() => list.refetch()} aria-label="Atualizar vendas" title="Atualizar vendas" disabled={list.isFetching}><RefreshCw size={16} /></button></div>
        <div className="sales-toolbar"><div className="sales-tabs" role="group" aria-label="Filtrar pedidos por situação">{([['ALL', 'Todos'], ['CONFIRMED', 'Confirmados'], ['DRAFT', 'Rascunhos'], ['CANCELED', 'Cancelados']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} className={status === value ? 'is-selected' : ''} onClick={() => { setStatus(value); setPage(0); }}>{label}</button>)}</div><form onSubmit={searchSales} role="search" className="sales-search"><input aria-label="Pesquisar pedidos" placeholder="Pedido, OS ou cliente" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit" aria-label="Pesquisar"><Search size={17} /></button></form></div>
        {list.isPending ? <div className="sales-loading"><div /><div /><div /><div /></div> : list.isError ? <div className="sales-list-error"><AlertCircle size={24} /><strong>Não foi possível carregar as vendas.</strong><button type="button" onClick={() => list.refetch()}>Tentar novamente</button></div> : list.data.items.length === 0 ? <div className="sales-empty"><FilePlus2 size={34} /><strong>{search || status !== 'ALL' ? 'Nenhum pedido encontrado' : 'Seu portal começa aqui'}</strong><p>{search || status !== 'ALL' ? 'Altere a pesquisa ou os filtros para ver outros pedidos.' : 'Registre sua primeira venda de serviço. Os lançamentos aparecerão aqui automaticamente.'}</p>{!search && status === 'ALL' && <button type="button" className="button button--primary" onClick={() => openEditor(null)}>Nova venda de serviço</button>}</div> : <>
          <div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Usuário</th><th>OS</th><th>Data</th><th>Valor</th><th>Situação</th><th aria-label="Abrir pedido" /></tr></thead><tbody>{list.data.items.map((sale) => <tr key={sale.id} onClick={() => void openSale(sale)} aria-busy={openingId === sale.id}><td><button type="button" className="sales-order-link" onClick={(event) => { event.stopPropagation(); void openSale(sale); }}>#{sale.orderCode}</button>{multiple && <SaleCompany company={companyById.get(sale.companyId)} />}</td><td><strong>{sale.customerNameSnapshot}</strong><small>{sale.customerKindSnapshot === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}</small></td><td className="sales-creator" title={sale.createdByUserName}>{sale.createdByUserName}</td><td className="sales-os">{sale.workOrderNumber || <span>—</span>}</td><td>{date(sale.soldOn)}</td><td className="sales-value">{currency(sale.totalAmount)}</td><td><span className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{statusLabel(sale.status)}</span></td><td><button type="button" className="sales-row-open" aria-label={multiple ? `Abrir pedido ${sale.orderCode} de ${companyById.get(sale.companyId)?.name ?? 'Empresa'}` : `Abrir pedido ${sale.orderCode}`} onClick={(event) => { event.stopPropagation(); void openSale(sale); }}><ArrowUpRight size={17} /></button></td></tr>)}</tbody></table></div>
          <div className="sales-mobile-list">{list.data.items.map((sale) => <button key={sale.id} type="button" className="sales-mobile-card" onClick={() => void openSale(sale)} disabled={openingId === sale.id}><div><strong>#{sale.orderCode}</strong>{multiple && <SaleCompany company={companyById.get(sale.companyId)} />}<span className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{statusLabel(sale.status)}</span></div><h3>{sale.customerNameSnapshot}</h3>{multiple && <small className="sales-mobile-card__company">{companyById.get(sale.companyId)?.name ?? 'Empresa'}</small>}<p>{date(sale.soldOn)}{sale.workOrderNumber ? ` · OS ${sale.workOrderNumber}` : ''}</p><p className="sales-mobile-card__creator">Lançado por {sale.createdByUserName}</p><strong className="sales-mobile-card__value">{currency(sale.totalAmount)}</strong></button>)}</div>
          <footer className="sales-ledger__footer"><span>Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, list.data.total)} de {list.data.total}</span><div><button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button><span>Página {page + 1} de {maxPage + 1}</span><button type="button" aria-label="Próxima página" disabled={page >= maxPage} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button></div></footer>
        </>}
      </section>
    </main>}
    {selected && <SaleDetailPanel companyId={selected.companyId} saleId={selected.id} onClose={() => setSelected(null)} onChanged={(message) => changed(message, selected.companyId)} onResume={resume} />}
    {toast && <div className="action-toast" role="status"><div className="action-toast__body"><strong>Portal de Serviços</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
