import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { AlertCircle, ArrowRight, ChevronLeft, ChevronRight, FileText, Filter, Plus, RefreshCw, Search, Settings2, Trash2, X } from 'lucide-react';
import { api, type Proposal, type ProposalFilters, type ProposalStatus, type User } from '../../api/client';
import { useCompanyScope, useOverviewFallback } from '../../components/company-scope';
import { RegistrationDialog } from '../../components/RegistrationDialog';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { permissionView, usePermissions } from '../permissions/usePermissions';
import { CompanyField, creationOptions } from './CompanyField';
import { canProposeFromCustomer } from './proposal-permissions';
import { money, shortDateTime } from './crm-utils';
import { ProposalEditor, type ProposalSource } from './ProposalEditor';
import { ProposalOriginPicker } from './ProposalOriginPicker';
import { ProposalRowMenu } from './ProposalRowMenu';
import './proposals.css';

const labels: Record<ProposalStatus, string> = { DRAFT: 'Rascunho', SENT: 'Enviada', ACCEPTED: 'Aceita', DECLINED: 'Recusada', CONVERTED: 'Convertida' };
const PAGE_SIZE = 20;
type OpenProposal = { source: ProposalSource; companyId: string };

export function ProposalsPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [draft, setDraft] = useState<ProposalFilters>({ status: 'ALL' });
  const [filters, setFilters] = useState<ProposalFilters>({ status: 'ALL' });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<OpenProposal | null>(null);
  const [chooser, setChooser] = useState(false);
  const [choice, setChoice] = useState('');
  const [search, setSearch] = useState('');
  const [originTab, setOriginTab] = useState<'OPPORTUNITY' | 'CUSTOMER'>('OPPORTUNITY');
  const [toast, setToast] = useState('');
  const [filterError, setFilterError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Proposal | null>(null);
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  const access = usePermissions(companyId);
  const scope = useCompanyScope(user, companies.data, 'crm', 'proposals.access');
  const multiple = scope.multiple;
  const companyById = useMemo(() => new Map((companies.data ?? []).map(company => [company.id, company])), [companies.data]);
  const proposalOptions = multiple ? creationOptions(companies.data, multiple.ids, id => permissionView(companies.data, id).can('proposals.manage')) : null;
  const canManage = proposalOptions ? proposalOptions.length > 0 : access.can('proposals.manage');
  const chooserCompanyId = proposalOptions ? proposalOptions.find(company => company.id === choice)?.id ?? (proposalOptions.length === 1 ? proposalOptions[0].id : '') : companyId;
  const canFromCustomer = canProposeFromCustomer(permissionView(companies.data, chooserCompanyId));
  const showCustomers = chooserCompanyId ? canFromCustomer : proposalOptions?.some(company => canProposeFromCustomer(permissionView(companies.data, company.id)));
  const chooserTab = originTab === 'CUSTOMER' && canFromCustomer ? 'CUSTOMER' : 'OPPORTUNITY';
  const originLabel = chooserTab === 'OPPORTUNITY' ? 'lead' : 'cliente';
  const openAccess = permissionView(companies.data, open?.companyId);
  const showEditor = open && ('id' in open.source ? openAccess.can('proposals.access') : 'opportunityId' in open.source ? openAccess.can('proposals.manage') : canProposeFromCustomer(openAccess));
  const openChooser = useCallback(() => {
    setChoice(''); setOriginTab('OPPORTUNITY'); setSearch(''); setChooser(true);
  }, []);
  useEffect(() => { if (companies.data && !companies.data.some(company => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  useEffect(() => setPage(0), [multiple?.scopeKey]);
  useEffect(() => { const id = window.setTimeout(() => setToast(''), 4600); return () => window.clearTimeout(id); }, [toast]);
  useEffect(() => {
    if (!companyId || !companies.data?.some(company => company.id === companyId)) return;
    const proposalId = params.get('abrir'), opportunityId = params.get('negociacao'), customerId = params.get('cliente');
    if (!proposalId && !opportunityId && !customerId) return;
    // Abrir uma proposta é leitura; criar a partir de negociação ou cliente exige a chave.
    const target = params.get('empresa') ?? companyId;
    const targetAccess = permissionView(companies.data, target);
    const allowed = proposalId ? targetAccess.can('proposals.access') : opportunityId ? targetAccess.can('proposals.manage') : canProposeFromCustomer(targetAccess);
    if (allowed) setOpen({ companyId: target, source: proposalId ? { id: proposalId } : opportunityId ? { opportunityId } : { customerId: customerId! } });
    const next = new URLSearchParams(params);
    for (const key of ['abrir', 'negociacao', 'cliente', 'empresa', 'novo']) next.delete(key);
    setParams(next, { replace: true });
  }, [companyId, companies.data, params, setParams]);
  useEffect(() => {
    if (params.get('novo') !== '1' || !companyId || !companies.data?.some(company => company.id === companyId)) return;
    if (['abrir', 'negociacao', 'cliente'].some(key => params.get(key))) return;
    if (!open && canManage) openChooser();
    const next = new URLSearchParams(params);
    next.delete('novo');
    setParams(next, { replace: true });
  }, [companyId, companies.data, params, setParams, open, openChooser, canManage]);
  const list = useQuery({ queryKey: multiple ? ['crm', 'overview', 'proposals', multiple.scopeKey, filters, page] : ['proposals', companyId, filters, page],
    queryFn: () => multiple ? api.crmOverviewProposals(multiple.param, filters, page, PAGE_SIZE) : api.proposals(companyId, filters, page, PAGE_SIZE),
    enabled: !!multiple || (!!companyId && access.can('proposals.access')) });
  useOverviewFallback(multiple, scope.clear, list.error, setToast);
  const originSearch = search.trim();
  const opportunities = useQuery({ queryKey: ['proposal-opportunities', chooserCompanyId, originSearch], queryFn: () => api.crmOpportunities(chooserCompanyId, { search: originSearch || undefined }, 0, 100), enabled: chooser && canManage && chooserTab === 'OPPORTUNITY' && !!chooserCompanyId });
  const customers = useQuery({ queryKey: ['proposal-customers', chooserCompanyId, originSearch], queryFn: () => api.customers(chooserCompanyId, { search: originSearch, status: 'ACTIVE', page: 0, limit: 100 }), enabled: chooser && canManage && chooserTab === 'CUSTOMER' && !!chooserCompanyId });
  const originQuery = chooserTab === 'OPPORTUNITY' ? opportunities : customers;
  const originEntries = chooserTab === 'OPPORTUNITY'
    ? opportunities.data?.items.map(item => ({ id: item.id, source: { opportunityId: item.id }, name: item.lead.name, description: item.title }))
    : customers.data?.items.map(item => ({ id: item.id, source: { customerId: item.id }, name: item.name, description: item.taxId || (item.kind === 'PJ' ? 'Pessoa jurídica' : item.kind === 'PF' ? 'Pessoa física' : 'Tipo não identificado') }));
  const originStatus = originQuery.isPending ? `Carregando ${originLabel}s...`
    : originQuery.isError ? `Não foi possível carregar os ${originLabel}s.`
    : originEntries?.length ? undefined : `Nenhum ${originLabel} encontrado.`;
  const settings = useQuery({ queryKey: ['proposal-settings', companyId], queryFn: () => api.proposalSettings(companyId), enabled: !multiple && settingsOpen && !!companyId });
  const pipelines = useQuery({ queryKey: ['crm-pipelines', companyId], queryFn: () => api.crmPipelines(companyId), enabled: !multiple && settingsOpen && !!companyId });
  const [winOnConvert, setWinOnConvert] = useState(true);
  const [sentStageId, setSentStageId] = useState('');
  useEffect(() => { if (settings.data) { setWinOnConvert(settings.data.winOpportunityOnProposalConversion); setSentStageId(settings.data.proposalSentStageId ?? ''); } }, [settings.data]);
  const updateSettings = useMutation({ mutationFn: () => api.updateProposalSettings(companyId, { expectedVersion: settings.data!.version, winOpportunityOnProposalConversion: winOnConvert, proposalSentStageId: sentStageId || null }), onSuccess: async () => { await settings.refetch(); setToast('Configurações comerciais salvas.'); setSettingsOpen(false); } });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/propostas'); } });
  const refreshLists = (targetCompanyId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['proposals', targetCompanyId] });
    void queryClient.invalidateQueries({ queryKey: ['crm-opportunities', targetCompanyId] });
    void queryClient.invalidateQueries({ queryKey: ['crm', 'overview'] });
  };
  const duplicate = useMutation({
    mutationFn: (item: Proposal) => api.proposalAction(item.companyId, item.id, 'duplicate', { expectedVersion: item.version }, crypto.randomUUID()),
    onSuccess: (result, item) => { refreshLists(item.companyId); setToast(`Cópia ${result.proposalCode} criada como rascunho.`); setOpen({ source: { id: result.proposalId }, companyId: item.companyId }); },
    onError: (reason) => setToast(reason instanceof Error ? reason.message : 'Não foi possível duplicar a proposta.'),
  });
  const remove = useMutation({
    mutationFn: (item: Proposal) => api.deleteProposal(item.companyId, item.id),
    onSuccess: (_result, item) => { refreshLists(item.companyId); setConfirmDelete(null); setToast(`Proposta ${item.proposalCode} excluída.`); },
  });
  const totalPages = Math.max(1, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE));
  function apply(event: FormEvent) { event.preventDefault(); if (draft.from && draft.to && draft.from > draft.to) return setFilterError('Confira o período de criação.'); setFilterError(''); setFilters({ ...draft, search: draft.search?.trim() || undefined }); setPage(0); }
  function clear() { setDraft({ status: 'ALL' }); setFilters({ status: 'ALL' }); setPage(0); setFilterError(''); }
  function changeCompany(next: string) { scope.clear(); setCompanyId(next); setOpen(null); setChooser(false); setSettingsOpen(false); clear(); }
  function chooseOrigin(source: ProposalSource) {
    if (!chooserCompanyId) return;
    setChooser(false); setOpen({ source, companyId: chooserCompanyId });
  }
  function saved(_id: string, message: string) {
    if (open) {
      void queryClient.invalidateQueries({ queryKey: ['proposals', open.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['crm-opportunities', open.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['crm-status-count', open.companyId] });
      void queryClient.invalidateQueries({ queryKey: ['crm', 'overview'] });
    }
    setOpen(null); setToast(message);
  }
  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={changeCompany} allowMultiple scope={scope} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="proposal-workspace"><main id="workspace-main" className="proposal-main" tabIndex={-1}>
    <header className="proposal-page-head"><div><span>CRM / DOCUMENTOS COMERCIAIS</span><h1>Propostas comerciais</h1><p>Do primeiro interesse ao pedido. Cada oferta mantém seu histórico e seu documento.</p></div><div><button type="button" className="button button--secondary" onClick={() => list.refetch()} disabled={list.isFetching}><RefreshCw size={16} /> Atualizar</button>{!multiple && access.can('proposals.settings') && <button type="button" className="proposal-gear" onClick={() => setSettingsOpen(true)} aria-label="Configurações das propostas"><Settings2 size={17} /></button>}{canManage && <button type="button" className="button button--primary" onClick={openChooser}><Plus size={16} /> Nova proposta</button>}</div></header>
    <section className="proposal-overview"><div className="proposal-overview__intro"><span>CARTEIRA DE PROPOSTAS</span><strong>{list.data?.summary.total ?? '-'}</strong><small>ofertas no filtro atual</small></div><div><span>Valor das propostas</span><strong>{money(list.data?.summary.totalAmount ?? '0.00')}</strong></div><div><span>Enviadas</span><strong>{list.data?.summary.sent ?? '-'}</strong></div><div><span>Aceitas</span><strong>{list.data?.summary.accepted ?? '-'}</strong></div><div><span>Convertidas</span><strong>{list.data?.summary.converted ?? '-'}</strong></div></section>
    <section className="proposal-filter" aria-labelledby="proposal-filter-title"><div className="proposal-filter__title"><Filter size={17} /><h2 id="proposal-filter-title">Filtrar propostas</h2></div><form onSubmit={apply}><label>Buscar<input value={draft.search ?? ''} onChange={event => setDraft(current => ({ ...current, search: event.target.value }))} placeholder="Código, cliente ou contato" maxLength={200} /></label><label>Situação<select value={draft.status ?? 'ALL'} onChange={event => setDraft(current => ({ ...current, status: event.target.value as ProposalStatus | 'ALL' }))}><option value="ALL">Todas</option>{Object.entries(labels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label><label>Criação de<input type="date" value={draft.from ?? ''} onChange={event => setDraft(current => ({ ...current, from: event.target.value }))} /></label><label>Criação até<input type="date" value={draft.to ?? ''} onChange={event => setDraft(current => ({ ...current, to: event.target.value }))} /></label><div className="proposal-filter__actions"><button type="button" onClick={clear}>Limpar</button><button type="submit" className="button button--primary"><Search size={15} /> Aplicar</button></div></form>{filterError && <p className="proposal-error" role="alert">{filterError}</p>}</section>
    <section className="proposal-ledger" aria-labelledby="proposal-ledger-title"><header><div><FileText size={20} /><div><h2 id="proposal-ledger-title">Ofertas</h2><p>{list.data ? `${list.data.total} propostas encontradas` : 'Carregando propostas...'}</p></div></div></header>{list.isPending ? <p className="proposal-state">Carregando ofertas...</p> : list.isError ? <div className="proposal-state" role="alert"><AlertCircle size={22} /><p>Não foi possível carregar as propostas.</p><button type="button" onClick={() => list.refetch()}>Tentar novamente</button></div> : list.data.items.length === 0 ? <div className="proposal-state"><FileText size={26} /><h3>Nenhuma proposta encontrada</h3><p>Crie a primeira oferta a partir de uma negociação ou cliente.</p>{canManage && <button type="button" className="button button--primary" onClick={openChooser}><Plus size={15} /> Nova proposta</button>}</div> : <><div className="proposal-table-wrap"><table className="proposal-table"><thead><tr><th>Código</th><th>Cliente</th><th>Criação</th><th>Valor</th><th>Situação</th><th aria-label="Ações" /></tr></thead><tbody>{list.data.items.map(item => <tr key={item.id} onClick={() => setOpen({ source: { id: item.id }, companyId: item.companyId })}><td>{multiple && <small className="crm-card__company">{companyById.get(item.companyId)?.tradeName}</small>}<strong>{item.proposalCode}</strong></td><td><strong>{item.recipientName}</strong><span>{item.recipientOrganization || item.contactName || 'Contato individual'}</span></td><td>{shortDateTime(item.createdAt)}</td><td className="proposal-table__money">{money(item.totalAmount)}</td><td><span className={`proposal-status proposal-status--${item.status.toLowerCase()}`}>{labels[item.status]}</span></td><td>{permissionView(companies.data, item.companyId).can('proposals.manage') ? <ProposalRowMenu proposal={item} busy={duplicate.isPending || remove.isPending} onDuplicate={() => duplicate.mutate(item)} onDelete={() => { remove.reset(); setConfirmDelete(item); }} /> : <button type="button" aria-label={`Abrir ${item.proposalCode}`} onClick={event => { event.stopPropagation(); setOpen({ source: { id: item.id }, companyId: item.companyId }); }}><ArrowRight size={17} /></button>}</td></tr>)}</tbody></table></div><footer><span>{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, list.data.total)} de {list.data.total}</span><div><button type="button" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage(value => value - 1)}><ChevronLeft size={16} /></button><strong>{page + 1} / {totalPages}</strong><button type="button" aria-label="Próxima página" disabled={page + 1 >= totalPages} onClick={() => setPage(value => value + 1)}><ChevronRight size={16} /></button></div></footer></>}</section>
  </main>
  {chooser && canManage && (
    <RegistrationDialog
      eyebrow="ORIGEM DA OFERTA"
      title="Nova proposta"
      description={showCustomers ? 'Selecione um lead ou um cliente para preencher a proposta.' : 'Selecione um lead para preencher a proposta.'}
      panelClassName="proposal-chooser"
      initialFocus={proposalOptions ? '.proposal-company-choice select' : '.proposal-chooser-search input'}
      onClose={() => setChooser(false)}
    >
      {(requestClose) => <>
        {proposalOptions && <div className="proposal-company-choice">
          <CompanyField choice={{ options: proposalOptions, onChange: id => { setChoice(id); setOriginTab('OPPORTUNITY'); setSearch(''); } }} value={chooserCompanyId} />
        </div>}
        <nav className="crm-detail-tabs" aria-label="Origem da proposta">
          <button type="button" disabled={!chooserCompanyId} className={chooserTab === 'OPPORTUNITY' ? 'is-active' : ''} aria-pressed={chooserTab === 'OPPORTUNITY'} onClick={() => { setOriginTab('OPPORTUNITY'); setSearch(''); }}>Lead</button>
          {showCustomers && <button type="button" disabled={!chooserCompanyId} className={chooserTab === 'CUSTOMER' ? 'is-active' : ''} aria-pressed={chooserTab === 'CUSTOMER'} onClick={() => { setOriginTab('CUSTOMER'); setSearch(''); }}>Clientes</button>}
        </nav>
        <div className="drawer__body proposal-form-body">
          <ProposalOriginPicker
            key={`${chooserCompanyId}-${chooserTab}`}
            label={`Buscar ou selecionar ${originLabel}`}
            value={search}
            options={originQuery.isError ? [] : originEntries ?? []}
            status={originStatus}
            failed={originQuery.isError}
            disabled={!chooserCompanyId}
            onSearch={setSearch}
            onSelect={chooseOrigin}
          />
        </div>
        <footer className="drawer__footer">
          <button type="button" className="button button--secondary" onClick={requestClose}>Cancelar</button>
        </footer>
      </>}
    </RegistrationDialog>
  )}
  {open && showEditor && <ProposalEditor key={JSON.stringify(open)} companyId={open.companyId} source={open.source} onClose={() => setOpen(null)} onSaved={saved} />}
  {settingsOpen && !multiple && <div className="proposal-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="proposal-dialog proposal-dialog--small" role="dialog" aria-modal="true" aria-labelledby="proposal-settings-title"><header className="proposal-dialog__head"><div><span>REGRAS COMERCIAIS</span><h2 id="proposal-settings-title">Configurações</h2><p>Defina como a proposta movimenta a negociação.</p></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label="Fechar"><X size={19} /></button></header><div className="proposal-dialog__body proposal-fields">{settings.isPending ? <p>Carregando...</p> : settings.isError ? <p role="alert">Não foi possível carregar as configurações.</p> : <><label className="proposal-toggle"><input type="checkbox" checked={winOnConvert} onChange={event => setWinOnConvert(event.target.checked)} /><span>Marcar negociação como ganha quando a proposta aceita virar pedido</span></label><label>Etapa ao registrar envio<select value={sentStageId} onChange={event => setSentStageId(event.target.value)}><option value="">Não alterar etapa</option>{pipelines.data?.items.flatMap(pipeline => pipeline.stages.map(stage => <option key={stage.id} value={stage.id}>{pipeline.name} · {stage.name}</option>))}</select></label><p className="proposal-muted">A etapa só será aplicada quando pertencer ao funil da negociação.</p></>}{updateSettings.isError && <p className="proposal-error" role="alert">{updateSettings.error instanceof Error ? updateSettings.error.message : 'Não foi possível salvar.'}</p>}</div><footer className="proposal-dialog__footer"><button type="button" className="button button--secondary" onClick={() => setSettingsOpen(false)}>Cancelar</button><button type="button" className="button button--primary" disabled={!settings.data || updateSettings.isPending} onClick={() => updateSettings.mutate()}>{updateSettings.isPending ? 'Salvando...' : 'Salvar'}</button></footer></section></div>}
  {confirmDelete && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !remove.isPending) setConfirmDelete(null); }} onKeyDown={event => { if (event.key === 'Escape' && !remove.isPending) setConfirmDelete(null); }}>
    <div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="proposal-delete-title" aria-describedby="proposal-delete-description">
      <div className="confirm-card__icon"><Trash2 size={24} /></div>
      <h2 id="proposal-delete-title">Excluir proposta?</h2>
      <p id="proposal-delete-description">A proposta <strong>{confirmDelete.proposalCode}</strong> de {confirmDelete.recipientName} sairá da lista de ofertas. O histórico da negociação continua registrado.</p>
      {remove.isError && <div className="inline-error" role="alert">{remove.error instanceof Error ? remove.error.message : 'Não foi possível excluir a proposta.'}</div>}
      <div className="confirm-card__actions">
        <button type="button" className="button button--secondary" autoFocus onClick={() => setConfirmDelete(null)} disabled={remove.isPending}>Cancelar</button>
        <button type="button" className="button button--danger" onClick={() => remove.mutate(confirmDelete)} disabled={remove.isPending}>{remove.isPending ? 'Excluindo...' : 'Excluir proposta'}</button>
      </div>
    </div>
  </div>}
  {toast && <div className="action-toast" role="status"><div className="action-toast__body"><strong>Propostas</strong><span>{toast}</span></div></div>}
  </WorkspaceLayout>;
}
