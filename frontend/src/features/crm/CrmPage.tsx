import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { AlertCircle, ArrowRight, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, RotateCcw, Search, UsersRound } from 'lucide-react';
import { api, type CrmCreateResult, type CrmFilters, type CrmOpportunity, type CrmStatus, type User } from '../../api/client';
import { isOverviewForbidden, useCompanyScope, useOverviewFallback } from '../../components/company-scope';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { creationOptions } from './CompanyField';
import { CrmLeadModal } from './CrmLeadModal';
import { CrmOpportunityModal } from './CrmOpportunityModal';
import { permissionView, usePermissions } from '../permissions/usePermissions';
import { CRM_STATUSES, money, shortDateTime, statusLabel } from './crm-utils';
import './crm.css';

const PAGE_SIZE = 20;
const emptyFilters = (): CrmFilters => ({ periodBy: 'ENTRY_RECEIVED' });

function originLabel(opportunity: CrmOpportunity) {
  return opportunity.origin.utmCampaign || opportunity.origin.sourceLabel || opportunity.origin.utmSource || 'Origem não informada';
}

export function CrmPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [draft, setDraft] = useState<CrmFilters>(emptyFilters);
  const [applied, setApplied] = useState<CrmFilters>(emptyFilters);
  const [page, setPage] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createCompanyId, setCreateCompanyId] = useState('');
  const access = usePermissions(companyId);
  const [selected, setSelected] = useState<CrmOpportunity | null>(null);
  const [toast, setToast] = useState('');
  const [filterError, setFilterError] = useState('');
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const scope = useCompanyScope(user, companies.data, 'crm', 'crm.access');
  const multiple = scope.multiple;
  const companyById = useMemo(() => new Map((companies.data ?? []).map(company => [company.id, company])), [companies.data]);
  const leadOptions = multiple ? creationOptions(companies.data, multiple.ids, id => permissionView(companies.data, id).can('crm.create')) : null;
  const leadCompanyId = leadOptions ? leadOptions.find(company => company.id === createCompanyId)?.id ?? (leadOptions.length === 1 ? leadOptions[0].id : '') : companyId;
  const canCreate = leadOptions ? leadOptions.length > 0 : access.can('crm.create');
  const canList = !!multiple || (!!companyId && access.can('crm.access'));

  useEffect(() => {
    if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? '');
  }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => setPage(0), [multiple?.scopeKey]);
  useEffect(() => { if (!toast) return; const timer = window.setTimeout(() => setToast(''), 4500); return () => window.clearTimeout(timer); }, [toast]);

  const list = useQuery({
    queryKey: multiple ? ['crm', 'overview', 'opportunities', multiple.scopeKey, applied, page] : ['crm-opportunities', companyId, applied, page],
    queryFn: () => multiple ? api.crmOverviewOpportunities(multiple.param, applied, page, PAGE_SIZE) : api.crmOpportunities(companyId, applied, page, PAGE_SIZE),
    enabled: canList,
  });
  const countFilters = useMemo(() => {
    const { status: _status, ...rest } = applied;
    return rest;
  }, [applied]);
  const statusCounts = useQueries({
    queries: CRM_STATUSES.map(({ value }) => ({
      queryKey: multiple ? ['crm', 'overview', 'status-count', multiple.scopeKey, countFilters, value] : ['crm-status-count', companyId, countFilters, value],
      queryFn: () => multiple ? api.crmOverviewOpportunities(multiple.param, { ...countFilters, status: value }, 0, 1) : api.crmOpportunities(companyId, { ...countFilters, status: value }, 0, 1),
      enabled: canList,
      staleTime: 15_000,
    })),
  });
  useOverviewFallback(multiple, scope.clear, [list.error, ...statusCounts.map(query => query.error)].find(isOverviewForbidden), setToast);
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/crm'); } });
  const pageCount = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const filtered = Object.entries(applied).some(([key, value]) => key !== 'periodBy' && value !== undefined && value !== '');

  function changeCompany(next: string) {
    scope.clear(); setCompanyId(next); setDraft(emptyFilters()); setApplied(emptyFilters()); setPage(0); setSelected(null); setCreating(false); setToast('');
  }
  function openCreate() {
    setCreateCompanyId(leadOptions ? (leadOptions.length === 1 ? leadOptions[0].id : '') : companyId);
    setCreating(true);
  }
  function changeDraft<K extends keyof CrmFilters>(key: K, value: CrmFilters[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setFilterError('');
  }
  function applyFilters(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFilterError('A data inicial deve ser anterior à data final.'); return; }
    setApplied({
      periodBy: draft.periodBy ?? 'ENTRY_RECEIVED',
      ...(draft.search?.trim() ? { search: draft.search.trim() } : {}),
      ...(draft.status ? { status: draft.status } : {}),
      ...(draft.utmCampaign?.trim() ? { utmCampaign: draft.utmCampaign.trim() } : {}),
      ...(draft.from ? { from: draft.from } : {}),
      ...(draft.to ? { to: draft.to } : {}),
    });
    setPage(0); setFilterError('');
  }
  function clearFilters() { setDraft(emptyFilters()); setApplied(emptyFilters()); setPage(0); setFilterError(''); }
  function chooseStatus(status: CrmStatus) {
    const next = applied.status === status ? undefined : status;
    setDraft((current) => ({ ...current, status: next }));
    setApplied((current) => ({ ...current, status: next }));
    setPage(0);
  }
  function refreshLists(target: string) {
    return Promise.all([queryClient.invalidateQueries({ queryKey: ['crm-opportunities', target] }),
      queryClient.invalidateQueries({ queryKey: ['crm-status-count', target] }), queryClient.invalidateQueries({ queryKey: ['crm', 'overview'] })]);
  }
  async function created(result: CrmCreateResult) {
    setCreating(false);
    await refreshLists(leadCompanyId);
    setToast('Lead adicionado e card criado em Novo lead.');
    try {
      const detail = await api.crmOpportunity(leadCompanyId, result.opportunityId);
      setSelected(detail);
    } catch { /* A lista atualizada continua disponível caso o detalhe falhe. */ }
  }
  function changed(message: string) {
    setToast(message);
    if (selected) void refreshLists(selected.companyId);
  }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={changeCompany} allowMultiple scope={scope} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="crm-workspace">
    <main id="workspace-main" className="crm-main" tabIndex={-1}>
      <header className="crm-page-header">
        <div><span className="crm-eyebrow">RELACIONAMENTO / BANCO DE LEADS</span><h1>CRM</h1><p>Organize cada contato, acompanhe negociações e preserve a origem de cada oportunidade.</p></div>
        <div className="crm-page-header__actions"><Link to="/agenda" className="crm-refresh"><CalendarDays size={16} /> Agenda</Link><button type="button" className="crm-refresh" onClick={() => { list.refetch(); statusCounts.forEach((query) => query.refetch()); }} disabled={list.isFetching || !canList}><RefreshCw size={16} className={list.isFetching ? 'is-spinning' : ''} /> Atualizar</button>{canCreate && <button type="button" className="button button--primary" onClick={openCreate}><Plus size={16} /> Novo lead</button>}</div>
      </header>

      <section className="crm-cadence" aria-labelledby="crm-cadence-title">
        <div className="crm-cadence__intro"><span>VISÃO DO FUNIL</span><h2 id="crm-cadence-title">Ritmo comercial</h2><p>Selecione uma etapa para examinar os cards.</p><div><strong>{list.data?.summary.total ?? '—'}</strong><span>negociações no filtro atual</span></div></div>
        <div className="crm-cadence__stages">{CRM_STATUSES.map((status, index) => <button key={status.value} type="button" className={`crm-stage crm-stage--${status.value.toLowerCase()}${applied.status === status.value ? ' is-active' : ''}`} onClick={() => chooseStatus(status.value)} aria-pressed={applied.status === status.value}><span>{String(index + 1).padStart(2, '0')}</span><strong>{statusCounts[index].data?.total ?? '—'}</strong><small>{status.short}</small></button>)}</div>
      </section>

      <section className="crm-filters" aria-labelledby="crm-filter-title">
        <div className="crm-filters__heading"><div><Filter size={17} /><h2 id="crm-filter-title">Filtrar banco de leads</h2></div><span>Os filtros afetam a lista e o ritmo comercial</span></div>
        <form onSubmit={applyFilters}>
          <label className="crm-filter-field crm-filter-field--search"><span>Lead, empresa, telefone ou e-mail</span><span className="crm-input-icon"><Search size={15} /><input value={draft.search ?? ''} onChange={(event) => changeDraft('search', event.target.value)} placeholder="Buscar no banco de leads" maxLength={100} /></span></label>
          <label className="crm-filter-field"><span>Situação comercial</span><span className="crm-native-select"><select value={draft.status ?? ''} onChange={(event) => changeDraft('status', (event.target.value || undefined) as CrmStatus | undefined)}><option value="">Todas</option>{CRM_STATUSES.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select><ChevronDown size={15} /></span></label>
          <label className="crm-filter-field"><span>Campanha</span><input value={draft.utmCampaign ?? ''} onChange={(event) => changeDraft('utmCampaign', event.target.value)} placeholder="Ex.: campanha_outubro" maxLength={200} /></label>
          <label className="crm-filter-field"><span>Período por</span><span className="crm-native-select"><select value={draft.periodBy ?? 'ENTRY_RECEIVED'} onChange={(event) => changeDraft('periodBy', event.target.value as CrmFilters['periodBy'])}><option value="ENTRY_RECEIVED">Entrada do lead</option><option value="CONTACT_CREATED">Criação do contato</option></select><ChevronDown size={15} /></span></label>
          <label className="crm-filter-field"><span>Data inicial</span><input type="date" value={draft.from ?? ''} onChange={(event) => changeDraft('from', event.target.value)} /></label>
          <label className="crm-filter-field"><span>Data final</span><input type="date" value={draft.to ?? ''} onChange={(event) => changeDraft('to', event.target.value)} /></label>
          {filterError && <p className="crm-filters__error" role="alert">{filterError}</p>}
          <div className="crm-filters__actions"><button type="button" onClick={clearFilters}><RotateCcw size={14} /> Limpar</button><button type="submit" className="button button--primary"><Search size={15} /> Aplicar filtros</button></div>
        </form>
      </section>

      <section className="crm-ledger" aria-labelledby="crm-list-title">
        <header className="crm-ledger__heading"><div><span className="crm-ledger__accent" /><div><h2 id="crm-list-title">Negociações</h2><p>{list.isPending ? 'Carregando banco de leads...' : `${list.data?.total ?? 0} ${(list.data?.total ?? 0) === 1 ? 'card encontrado' : 'cards encontrados'}`}</p></div></div><div><span>Valor estimado</span><strong>{list.data ? money(list.data.summary.estimatedAmount) : '—'}</strong></div></header>
        {list.isPending ? <div className="crm-loading" aria-label="Carregando negociações"><div /><div /><div /><div /></div> : list.isError ? <div className="crm-empty" role="alert"><AlertCircle size={28} /><h3>Não foi possível carregar o CRM</h3><p>Confira sua conexão e tente novamente.</p><button type="button" className="button button--secondary" onClick={() => list.refetch()}>Tentar novamente</button></div> : list.data.items.length === 0 ? <div className="crm-empty"><span><UsersRound size={27} /></span><h3>{filtered ? 'Nenhum card encontrado' : 'Seu banco de leads começa aqui'}</h3><p>{filtered ? 'Altere os filtros para ampliar a busca.' : 'Adicione o primeiro contato para criar automaticamente uma negociação.'}</p>{(filtered || canCreate) && <button type="button" className="button button--primary" onClick={filtered ? clearFilters : openCreate}>{filtered ? 'Limpar filtros' : <><Plus size={15} /> Adicionar lead</>}</button>}</div> : <>
          <div className="crm-table-scroll"><table className="crm-table"><thead><tr><th>Lead</th><th>Negociação</th><th>Situação</th><th>Valor</th><th>Origem</th><th>Última atividade</th><th aria-label="Abrir" /></tr></thead><tbody>{list.data.items.map((opportunity) => <tr key={opportunity.id} onClick={() => setSelected(opportunity)}><td><button type="button" className="crm-lead-link" onClick={() => setSelected(opportunity)}>{opportunity.lead.name}</button><small>{opportunity.lead.organizationName || 'Contato individual'}</small></td><td>{multiple && <small className="crm-card__company">{companyById.get(opportunity.companyId)?.tradeName}</small>}<strong>{opportunity.title}</strong><small>Entrada {shortDateTime(opportunity.origin.receivedAt)}</small></td><td><span className={`crm-status crm-status--${opportunity.commercialStatus.toLowerCase()}`}>{statusLabel(opportunity.commercialStatus)}</span></td><td className="crm-table__money">{money(opportunity.estimatedAmount)}</td><td><span className="crm-origin-label">{originLabel(opportunity)}</span></td><td><span className="crm-last-activity"><CalendarDays size={14} /> {shortDateTime(opportunity.lastActivityAt)}</span></td><td><button type="button" className="crm-row-open" aria-label={`Abrir negociação de ${opportunity.lead.name}`} onClick={(event) => { event.stopPropagation(); setSelected(opportunity); }}><ArrowRight size={17} /></button></td></tr>)}</tbody></table></div>
          <div className="crm-mobile-list">{list.data.items.map((opportunity) => <button type="button" key={opportunity.id} className="crm-mobile-card" onClick={() => setSelected(opportunity)}><span className="crm-mobile-card__head"><span>{multiple && <small className="crm-card__company">{companyById.get(opportunity.companyId)?.tradeName}</small>}<strong>{opportunity.lead.name}</strong><small>{opportunity.lead.organizationName || opportunity.title}</small></span><span className={`crm-status crm-status--${opportunity.commercialStatus.toLowerCase()}`}>{statusLabel(opportunity.commercialStatus)}</span></span><span className="crm-mobile-card__meta"><span><BriefcaseBusiness size={14} /> {opportunity.title}</span><strong>{money(opportunity.estimatedAmount)}</strong></span><span className="crm-mobile-card__foot"><span>{originLabel(opportunity)}</span><span>{shortDateTime(opportunity.lastActivityAt)} <ArrowRight size={14} /></span></span></button>)}</div>
          <footer className="crm-ledger__footer"><span>Exibindo {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, list.data.total)} de {list.data.total}</span><div><button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((value) => value - 1)}><ChevronLeft size={16} /></button><span>{page + 1} de {pageCount}</span><button type="button" aria-label="Próxima página" disabled={page + 1 >= pageCount} onClick={() => setPage((value) => value + 1)}><ChevronRight size={16} /></button></div></footer>
        </>}
      </section>
    </main>
    {creating && canCreate && <CrmLeadModal key={leadCompanyId} companyId={leadCompanyId} companyChoice={leadOptions ? { options: leadOptions, onChange: setCreateCompanyId } : undefined} onClose={() => setCreating(false)} onCreated={created} />}
    {selected && permissionView(companies.data, selected.companyId).can('crm.access') && <CrmOpportunityModal companyId={selected.companyId} opportunity={selected} onClose={() => setSelected(null)} onChanged={changed} />}
    {toast && <div className="action-toast" role="status"><div className="action-toast__body"><strong>CRM</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
