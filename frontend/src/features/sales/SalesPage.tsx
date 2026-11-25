import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router';
import { AlertCircle, ChevronLeft, ChevronRight, FilePlus2, Plus, RefreshCw, Search } from 'lucide-react';
import { canOpenScreen } from '@gestaonf/permissions';
import { api, type Company, type Sale, type SaleDetail, type SaleStatus, type User } from '../../api/client';
import { CompanyLogo } from '../../components/CompanyLogo';
import { useCompanyScope, useOverviewFallback } from '../../components/company-scope';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { permissionView, salesReviewTarget, storedCompanyId } from '../permissions/usePermissions';
import { NfseRowAction } from '../fiscal/NfseRowAction';
import { SaleActionsMenu } from './SaleActionsMenu';
import { SaleDeleteDialog } from './SaleDeleteDialog';
import { saleActions } from './sale-permissions';
import { SaleDetailPanel } from './SaleDetailPanel';
import { SaleEditor } from './SaleEditor';
import './sales.css';

const PAGE_SIZE = 20;
const currency = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'A definir';
const statusLabel = (value: SaleStatus) => value === 'CONFIRMED' ? 'Confirmado' : value === 'DRAFT' ? 'Rascunho' : 'Excluída';
const sumLabel: Record<SaleStatus | 'ALL', string> = { ALL: 'Total sem excluídas', CONFIRMED: 'Total confirmado', DRAFT: 'Total em rascunho', CANCELED: 'Total excluído' };

/** Identifica a empresa do pedido na visão consolidada: foto ou iniciais (decorativas) + nome para leitor de tela. */
function SaleCompany({ company }: { company: Company | undefined }) {
  const name = company?.tradeName ?? 'Empresa';
  return <span className="sales-company" title={name}><CompanyLogo company={company} className="sales-company__logo" /><span className="sales-company__name">{name}</span></span>;
}

export function SalesPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const [activeCompanyId, setCompanyId] = useState(() => storedCompanyId(companies.data ?? []));
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
  const [deleting, setDeleting] = useState<{ sale: Sale; trigger: HTMLButtonElement | null } | null>(null);
  const scope = useCompanyScope(user, companies.data, 'sales', 'sales.access');
  const review = salesReviewTarget(params, companies.data, activeCompanyId);
  const activeAccess = permissionView(companies.data, activeCompanyId);
  const reviewInView = !!(review && scope.multiple?.ids.includes(review.companyId)
    && (scope.multiple.mode === 'all' || activeAccess.canInAll('sales.access', scope.multiple.ids)));
  const companyId = review && (!reviewInView || !canOpenScreen(activeAccess.viewer, 'sales')) ? review.companyId : activeCompanyId;
  const multiple = review && !reviewInView ? null : scope.multiple;
  const reviewId = review?.id, reviewCompanyId = review?.companyId;
  const accessFor = (id: string) => permissionView(companies.data, id);
  const canCreate = multiple ? multiple.ids.some((id) => accessFor(id).can('sales.create')) : accessFor(companyId).can('sales.create');
  const canViewSales = canOpenScreen(permissionView(companies.data, companyId).viewer, 'sales');
  useEffect(() => {
    if (!reviewCompanyId) return;
    if (!reviewInView && scope.multiple) scope.clear();
    if (companyId !== activeCompanyId) setCompanyId(companyId);
  }, [reviewCompanyId, reviewInView, scope.multiple, scope.clear, companyId, activeCompanyId]);
  useEffect(() => {
    if (!params.get('editar') || !companies.data) return;
    const clear = () => { const next = new URLSearchParams(params); next.delete('editar'); next.delete('empresa'); setParams(next, { replace: true }); };
    if (!reviewId || !reviewCompanyId) { setToast('Pedido ou empresa inválidos.'); clear(); return; }
    let active = true;
    void api.sale(reviewCompanyId, reviewId).then(detail => {
      if (!active) return;
      if (detail.status === 'CANCELED' || !saleActions(detail.status, accessFor(reviewCompanyId)).edit) openDetail(detail.id, reviewCompanyId); else openEditor(detail);
      clear();
    }).catch(() => { if (active) { setToast('Não foi possível abrir o pedido. Tente novamente.'); clear(); } });
    return () => { active = false; };
  }, [params, setParams, companies.data, reviewId, reviewCompanyId]);
  useEffect(() => { if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => {
    if (params.get('novo') !== '1' || !companyId || !companies.data?.some((company) => company.id === companyId)) return;
    if (!editing && canCreate) openEditor(null);
    setParams((previous) => { const next = new URLSearchParams(previous); next.delete('novo'); return next; }, { replace: true });
  }, [params, setParams, companyId, companies.data, editing, canCreate]);
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
    enabled: canViewSales,
  });
  const companyById = useMemo(() => new Map((companies.data ?? []).map((company) => [company.id, company])), [companies.data]);
  const summary = list.data?.summary ?? null;
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/portal-de-servicos'); } });
  useOverviewFallback(multiple, scope.clear, list.error, setToast);
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
    if (sale.status === 'CANCELED' || !saleActions(sale.status, accessFor(sale.companyId)).edit) { openDetail(sale.id, sale.companyId); return; }
    setOpeningId(sale.id);
    try { const detail = await api.sale(sale.companyId, sale.id); openEditor(detail); }
    catch { setToast('Não foi possível abrir o pedido. Tente novamente.'); }
    finally { setOpeningId(null); }
  }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={chooseSingle} allowMultiple scope={{ ...scope, multiple }} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="sales-workspace">
    {editing && companies.data ? <SaleEditor companyId={editorCompanyId} companies={companies.data.filter((c) => accessFor(c.id).can('sales.create') || c.id === editingDraft?.companyId)} draft={editingDraft} onCompanyChange={changeEditorCompany} onClose={() => { setEditing(false); setEditingDraft(null); }} onCreated={created} /> : <main id="workspace-main" className="sales-main" tabIndex={-1}>
      <div className="sales-page-head"><div><span className="sale-eyebrow">VENDAS / SERVIÇOS</span><h1>Portal de Serviços</h1><p>Acompanhe cada lançamento, do serviço vendido aos valores recebidos.</p></div>{canCreate && <button type="button" className="button button--primary sales-create-button" onClick={() => openEditor(null)} disabled={!multiple && !companyId}><Plus size={17} /> Nova venda de serviço</button>}</div>
      {companies.isError && <div className="sales-error" role="alert">Não foi possível carregar suas empresas. <button onClick={() => companies.refetch()}>Tentar novamente</button></div>}
      <section className="sales-ledger" aria-labelledby="sales-ledger-title"><div className="sales-ledger__header"><div><span className="sales-ledger__line" /><h2 id="sales-ledger-title" tabIndex={-1}>Lançamentos</h2><span className="sales-ledger__count">{list.data?.total ?? '-'} pedidos</span>{multiple && <span className="sales-ledger__sum">{sumLabel[status]}: {summary ? currency(summary.amount) : '-'}</span>}</div><button type="button" onClick={() => list.refetch()} aria-label="Atualizar vendas" title="Atualizar vendas" disabled={list.isFetching}><RefreshCw size={16} /></button></div>
        <div className="sales-toolbar"><div className="sales-tabs" role="group" aria-label="Filtrar pedidos por situação">{([['ALL', 'Todos'], ['CONFIRMED', 'Confirmados'], ['DRAFT', 'Rascunhos'], ['CANCELED', 'Excluídas']] as const).map(([value, label]) => <button key={value} type="button" aria-pressed={status === value} className={status === value ? 'is-selected' : ''} onClick={() => { setStatus(value); setPage(0); }}>{label}</button>)}</div><form onSubmit={searchSales} role="search" className="sales-search"><input aria-label="Pesquisar pedidos" placeholder="Pedido, OS ou cliente" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} /><button type="submit" aria-label="Pesquisar"><Search size={17} /></button></form></div>
        {list.isPending ? <div className="sales-loading"><div /><div /><div /><div /></div> : list.isError ? <div className="sales-list-error"><AlertCircle size={24} /><strong>Não foi possível carregar as vendas.</strong><button type="button" onClick={() => list.refetch()}>Tentar novamente</button></div> : list.data.items.length === 0 ? <div className="sales-empty"><FilePlus2 size={34} /><strong>{search || status !== 'ALL' ? 'Nenhum pedido encontrado' : 'Seu portal começa aqui'}</strong><p>{search || status !== 'ALL' ? 'Altere a pesquisa ou os filtros para ver outros pedidos.' : 'Registre sua primeira venda de serviço. Os lançamentos aparecerão aqui automaticamente.'}</p>{!search && status === 'ALL' && canCreate && <button type="button" className="button button--primary" onClick={() => openEditor(null)}>Nova venda de serviço</button>}</div> : <>
          <div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Usuário</th><th>OS</th><th>Data</th><th>Valor</th><th>Situação</th><th className="sales-actions-head">Ações</th></tr></thead><tbody>{list.data.items.map((sale) => <tr key={sale.id} onClick={() => void openSale(sale)} aria-busy={openingId === sale.id}><td><button type="button" className="sales-order-link" aria-label={multiple ? `Abrir pedido ${sale.orderCode} de ${companyById.get(sale.companyId)?.tradeName ?? 'Empresa'}` : `Abrir pedido ${sale.orderCode}`} onClick={(event) => { event.stopPropagation(); void openSale(sale); }}>#{sale.orderCode}</button>{multiple && <SaleCompany company={companyById.get(sale.companyId)} />}</td><td><strong>{sale.customerNameSnapshot}</strong><small>{sale.customerKindSnapshot === 'PJ' ? 'Pessoa jurídica' : sale.customerKindSnapshot === 'PF' ? 'Pessoa física' : 'Tipo não identificado'}</small></td><td className="sales-creator" title={sale.createdByUserName}>{sale.createdByUserName}</td><td className="sales-os">{sale.workOrderNumber || <span>-</span>}</td><td>{date(sale.soldOn)}</td><td className="sales-value">{currency(sale.totalAmount)}</td><td><span className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{statusLabel(sale.status)}</span></td><td className="sales-actions-cell"><div className="sales-actions-cell__inner"><NfseRowAction sale={sale} access={accessFor(sale.companyId)} onNotice={setToast} /><SaleActionsMenu orderCode={sale.orderCode} actions={saleActions(sale.status, accessFor(sale.companyId))} onEdit={() => void openSale(sale)} onDelete={(trigger) => setDeleting({ sale, trigger })} /></div></td></tr>)}</tbody></table></div>
          <div className="sales-mobile-list">{list.data.items.map((sale) => <div key={sale.id} className="sales-mobile-card-wrap"><button type="button" className="sales-mobile-card" onClick={() => void openSale(sale)} disabled={openingId === sale.id}><div><strong>#{sale.orderCode}</strong>{multiple && <SaleCompany company={companyById.get(sale.companyId)} />}<span className={`sale-status sale-status--${sale.status.toLowerCase()}`}>{statusLabel(sale.status)}</span></div><h3>{sale.customerNameSnapshot}</h3>{multiple && <small className="sales-mobile-card__company">{companyById.get(sale.companyId)?.tradeName ?? 'Empresa'}</small>}<p>{date(sale.soldOn)}{sale.workOrderNumber ? ` · OS ${sale.workOrderNumber}` : ''}</p><p className="sales-mobile-card__creator">Lançado por {sale.createdByUserName}</p><strong className="sales-mobile-card__value">{currency(sale.totalAmount)}</strong></button><SaleActionsMenu className="sales-mobile-card__actions" orderCode={sale.orderCode} actions={saleActions(sale.status, accessFor(sale.companyId))} onEdit={() => void openSale(sale)} onDelete={(trigger) => setDeleting({ sale, trigger })} /></div>)}</div>
          <footer className="sales-ledger__footer"><span>Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, list.data.total)} de {list.data.total}</span><div><button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={17} /></button><span>Página {page + 1} de {maxPage + 1}</span><button type="button" aria-label="Próxima página" disabled={page >= maxPage} onClick={() => setPage((value) => value + 1)}><ChevronRight size={17} /></button></div></footer>
        </>}
      </section>
    </main>}
    {selected && <SaleDetailPanel companyId={selected.companyId} saleId={selected.id} onClose={() => setSelected(null)} onChanged={(message) => changed(message, selected.companyId)} onEdit={resume} />}
    {deleting && <SaleDeleteDialog companyId={deleting.sale.companyId} sale={deleting.sale} onClose={() => { deleting.trigger?.focus(); setDeleting(null); }} onDeleted={(detail) => { setDeleting(null); document.getElementById('sales-ledger-title')?.focus(); changed(`Pedido #${detail.orderCode} excluído.`, detail.companyId); }} />}
    {/* Região viva sempre montada: só o conteúdo muda, para o leitor de tela anunciar. */}
    <div role="status">{toast && <div className="action-toast"><div className="action-toast__body"><strong>Portal de Serviços</strong><span>{toast}</span></div></div>}</div>
  </WorkspaceLayout>;
}
