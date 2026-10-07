import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, LogOut, Pencil, Plus, Search, XCircle } from 'lucide-react';
import { api, ApiError, type Service, type ServiceInput, type ServiceList, type User } from '../../api/client';
import { Brand } from '../../components/Brand';
import { initials } from '../../utils/format';
import { ServiceForm } from './ServiceForm';

type DrawerState = { mode: 'create' } | { mode: 'edit'; service: Service } | null;
type ServiceStatus = 'ACTIVE' | 'INACTIVE';
type SearchRequest = { companyId: string; term: string; status: ServiceStatus; page: number; serial: number };
type Toast = { id: number; title: string; description: string; tone: 'success' | 'error' };
const PAGE_SIZE = 10;

function formatPrice(value: string | null): string {
  if (value === null) return 'Não informado';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function MobileServiceList({ items, onEdit, onInactivate, onReactivate, reactivating }: {
  items: Service[];
  onEdit: (service: Service) => void;
  onInactivate: (service: Service) => void;
  onReactivate: (service: Service) => void;
  reactivating: boolean;
}) {
  return <div className="mobile-customer-list">{items.map((service) => <article className="mobile-customer" key={service.id}>
    <div className="mobile-customer__head"><div className="mobile-customer__identity"><strong>{service.name}</strong><small>{service.internalCode || 'Sem código interno'} · {service.unitLabel}</small></div><span className={`status-pill ${service.status === 'ACTIVE' ? 'status-pill--active' : 'status-pill--inactive'}`}>{service.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</span></div>
    <div className="mobile-customer__details"><div><span>VALOR SUGERIDO</span><strong>{formatPrice(service.suggestedUnitPrice)}</strong></div><div><span>CLASSIFICAÇÃO</span><strong>{service.nationalTaxCode ? `cTribNac ${service.nationalTaxCode}` : 'Pendente'}</strong></div></div>
    <div className="mobile-customer__actions"><button type="button" onClick={() => onEdit(service)}><Pencil size={15} /> Editar</button>{service.status === 'ACTIVE' ? <button type="button" onClick={() => onInactivate(service)}><XCircle size={15} /> Inativar</button> : <button type="button" onClick={() => onReactivate(service)} disabled={reactivating}><CircleCheck size={15} /> Reativar</button>}</div>
  </article>)}</div>;
}

export function ServicesPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const searchSequence = useRef(0);
  const toastSequence = useRef(0);
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [inputSearch, setInputSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<ServiceStatus>('ACTIVE');
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [confirmService, setConfirmService] = useState<Service | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 5_000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function showToast(title: string, description: string, tone: Toast['tone'] = 'success') {
    setToast({ id: ++toastSequence.current, title, description, tone });
  }

  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => {
    if (!companies.data) return;
    if (!companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? '');
  }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);

  const company = companies.data?.find((item) => item.id === companyId);
  const listKey = ['services', companyId, searchRequest?.status, searchRequest?.term, searchRequest?.page, searchRequest?.serial] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => api.services(companyId, { search: searchRequest!.term, status: searchRequest!.status, page: searchRequest!.page, limit: PAGE_SIZE }),
    enabled: !!companyId && !!searchRequest && searchRequest.companyId === companyId && searchRequest.status === selectedStatus,
  });

  function updateVisibleService(service: Service) {
    if (!searchRequest || searchRequest.companyId !== companyId) return;
    const term = searchRequest.term.toLocaleLowerCase('pt-BR');
    const matches = service.status === searchRequest.status && (!term || [service.name, service.internalCode, service.nationalTaxCode]
      .some((value) => value?.toLocaleLowerCase('pt-BR').includes(term)));
    queryClient.setQueryData<ServiceList>(listKey, (previous) => previous && ({
      ...previous,
      total: previous.total - (previous.items.some((item) => item.id === service.id) && !matches ? 1 : 0),
      items: previous.items.filter((item) => item.id !== service.id || matches)
        .map((item) => item.id === service.id ? service : item)
        .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
    }));
  }

  const saveMutation = useMutation({
    mutationFn: ({ input, id }: { input: ServiceInput; id?: string }) => id ? api.updateService(companyId, id, input) : api.createService(companyId, input),
    onSuccess: (service, variables) => {
      showToast(variables.id ? 'Alterações salvas' : 'Serviço cadastrado', variables.id
        ? `As alterações de ${service.name} foram salvas.`
        : `Cadastro de ${service.name} concluído.`);
      setDrawer(null);
      if (variables.id) { updateVisibleService(service); return; }
      if (!searchRequest || searchRequest.companyId !== companyId || searchRequest.status !== 'ACTIVE' || searchRequest.page !== 0 || searchRequest.term) return;
      queryClient.setQueryData<ServiceList>(listKey, (previous) => previous && ({
        ...previous,
        total: previous.total + 1,
        items: [...previous.items, service].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).slice(0, PAGE_SIZE),
      }));
    },
  });
  const inactivateMutation = useMutation({
    mutationFn: (service: Service) => api.inactivateService(companyId, service.id),
    onSuccess: (_result, service) => {
      setConfirmService(null);
      showToast('Serviço inativado', `${service.name} foi movido para Inativos.`);
      updateVisibleService({ ...service, status: 'INACTIVE' });
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: (service: Service) => api.updateService(companyId, service.id, { status: 'ACTIVE' }),
    onSuccess: (service) => { showToast('Serviço reativado', `${service.name} foi movido para Ativos.`); updateVisibleService(service); },
    onError: (error) => showToast('Não foi possível reativar', error instanceof Error ? error.message : 'Tente novamente.', 'error'),
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/serviço'); },
  });

  const closeDrawer = useCallback(() => { if (!saveMutation.isPending) setDrawer(null); }, [saveMutation.isPending]);
  const openCreate = () => { saveMutation.reset(); setDrawer({ mode: 'create' }); };
  const openEdit = (service: Service) => { saveMutation.reset(); setDrawer({ mode: 'edit', service }); };
  const openInactivate = (service: Service) => { inactivateMutation.reset(); setConfirmService(service); };
  const lastPage = Math.max(0, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE) - 1);
  const currentPage = searchRequest?.page ?? 0;

  function searchServices(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId) return;
    setSearchRequest({ companyId, term: inputSearch.trim(), status: selectedStatus, page: 0, serial: ++searchSequence.current });
  }

  function changeStatus(status: ServiceStatus) {
    if (status === selectedStatus) return;
    setSelectedStatus(status);
    setSearchRequest(null);
  }

  function changeCompany(next: string) {
    setCompanyId(next);
    setSelectedStatus('ACTIVE');
    setSearchRequest(null);
    setInputSearch('');
    setDrawer(null);
    setConfirmService(null);
    setToast(null);
  }

  return <div className="app-shell client-workspace service-workspace">
    <header className="topbar"><div className="topbar__inner"><Brand compact /><div className="topbar__right">
      <div className="company-picker"><Building2 size={16} /><select aria-label="Empresa ativa" value={companyId} onChange={(event) => changeCompany(event.target.value)} disabled={!companies.data?.length}>{companies.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={15} /></div>
      <div className="topbar__divider" />
      <span className="user-badge" title={user.email}>{initials(user.name)}</span>
      <div className="user-info"><strong>{user.name}</strong><span>{company?.role === 'OWNER' ? 'Proprietário' : company?.role ?? 'Usuário'}</span></div>
      <button type="button" className="icon-button topbar__logout" title="Sair" aria-label="Sair" onClick={() => logout.mutate()} disabled={logout.isPending}><LogOut size={18} /></button>
    </div></div></header>

    <main className="client-workspace__main">
      {companies.isError && <div className="notice notice--error" role="alert"><AlertCircle size={18} /> Não foi possível carregar as empresas. <button onClick={() => companies.refetch()}>Tentar novamente</button></div>}
      {companies.data?.length === 0 && <div className="empty-panel"><Building2 size={28} /><h2>Nenhuma empresa disponível</h2><p>Seu usuário ainda não possui vínculo ativo com uma empresa.</p></div>}
      {!!companyId && <section className="client-panel" aria-labelledby="service-panel-title">
        <div className="client-panel__title"><h1 id="service-panel-title">Serviços</h1></div>
        <div className="client-panel__rule" />
        <form className="client-search" onSubmit={searchServices} role="search">
          <input aria-label="Buscar serviços" value={inputSearch} onChange={(event) => setInputSearch(event.target.value)} placeholder="Pesquise por nome, código interno ou cTribNac" />
          <button type="submit" aria-label="Pesquisar serviços" title="Pesquisar serviços"><Search size={18} strokeWidth={2.4} /></button>
        </form>
        <div className="client-panel__actions">
          <div className="client-status-tabs" role="group" aria-label="Situação dos serviços">
            <button type="button" className={selectedStatus === 'ACTIVE' ? 'is-selected' : ''} aria-pressed={selectedStatus === 'ACTIVE'} onClick={() => changeStatus('ACTIVE')}>Ativos</button>
            <button type="button" className={selectedStatus === 'INACTIVE' ? 'is-selected' : ''} aria-pressed={selectedStatus === 'INACTIVE'} onClick={() => changeStatus('INACTIVE')}>Inativos</button>
          </div>
          <button type="button" className="client-new-button" aria-label="Novo serviço" onClick={openCreate}><Plus size={16} /> Novo</button>
        </div>

        {searchRequest && searchRequest.companyId === companyId && searchRequest.status === selectedStatus && <div className="client-results" aria-live="polite">
          {list.isPending ? <div className="table-loading" aria-label="Carregando serviços"><div /><div /><div /></div> : list.isError ? <div className="empty-panel"><AlertCircle size={28} /><h2>Não foi possível carregar os serviços</h2><p>{list.error instanceof ApiError ? list.error.message : 'Tente novamente pela lupa.'}</p></div> : <>
            <div className="client-results__heading"><h2>Resultados da pesquisa</h2><span>{list.data.total} {list.data.total === 1 ? 'serviço' : 'serviços'}</span></div>
            {!list.data.items.length ? <div className="client-results__empty"><Search size={23} /><p>{list.data.total ? 'Nenhum serviço nesta página.' : `Nenhum serviço ${selectedStatus === 'INACTIVE' ? 'inativo' : 'ativo'} encontrado.`}</p><span>{list.data.total ? 'Volte à página anterior ou faça uma nova pesquisa.' : searchRequest.term ? 'Experimente outro nome ou código.' : selectedStatus === 'INACTIVE' ? 'Os serviços inativados aparecerão aqui.' : 'Cadastre um serviço pelo botão Novo serviço.'}</span></div> : <>
              <div className="table-scroll"><table className="customers-table services-table"><thead><tr><th>SERVIÇO</th><th>CÓDIGO</th><th>VALOR SUGERIDO</th><th>CLASSIFICAÇÃO</th><th>SITUAÇÃO</th><th className="align-right">AÇÕES</th></tr></thead><tbody>{list.data.items.map((service) => <tr key={service.id}><td><div className="customer-cell"><div><strong title={service.name}>{service.name}</strong><span>{service.unitLabel}{service.description ? ` · ${service.description}` : ''}</span></div></div></td><td className="mono-cell">{service.internalCode || <span className="muted-text">Não informado</span>}</td><td>{service.suggestedUnitPrice ? formatPrice(service.suggestedUnitPrice) : <span className="muted-text">Não informado</span>}</td><td>{service.nationalTaxCode ? <span className="service-tax-code">cTribNac {service.nationalTaxCode}</span> : <span className="service-classification-pending">Pendente</span>}</td><td><span className={`status-pill ${service.status === 'ACTIVE' ? 'status-pill--active' : 'status-pill--inactive'}`}>{service.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</span></td><td><div className="row-actions"><button type="button" className="table-action" onClick={() => openEdit(service)} title={`Editar ${service.name}`} aria-label={`Editar ${service.name}`}><Pencil size={16} /></button>{service.status === 'ACTIVE' ? <button type="button" className="table-action table-action--danger" onClick={() => openInactivate(service)} title={`Inativar ${service.name}`} aria-label={`Inativar ${service.name}`}><XCircle size={17} /></button> : <button type="button" className="table-action" onClick={() => reactivateMutation.mutate(service)} disabled={reactivateMutation.isPending} title={`Reativar ${service.name}`} aria-label={`Reativar ${service.name}`}><CircleCheck size={17} /></button>}</div></td></tr>)}</tbody></table></div>
              <MobileServiceList items={list.data.items} onEdit={openEdit} onInactivate={openInactivate} onReactivate={(service) => reactivateMutation.mutate(service)} reactivating={reactivateMutation.isPending} />
            </>}
            {list.data.total > 0 && <div className="pagination"><span>{list.data.items.length ? <>Exibindo <strong>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, list.data.total)}</strong> de <strong>{list.data.total}</strong></> : <>{list.data.total} {list.data.total === 1 ? 'serviço' : 'serviços'}</>}</span><div><button type="button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setSearchRequest((current) => current && ({ ...current, page: current.page - 1 }))}><ChevronLeft size={17} /></button><span>Página {currentPage + 1} de {lastPage + 1}</span><button type="button" aria-label="Próxima página" disabled={currentPage >= lastPage} onClick={() => setSearchRequest((current) => current && ({ ...current, page: current.page + 1 }))}><ChevronRight size={17} /></button></div></div>}
          </>}
        </div>}
      </section>}
    </main>

    {drawer && <ServiceForm companyId={companyId} service={drawer.mode === 'edit' ? drawer.service : undefined} onClose={closeDrawer} saving={saveMutation.isPending} saveError={saveMutation.error} onSave={(input) => saveMutation.mutateAsync({ input, id: drawer.mode === 'edit' ? drawer.service.id : undefined }).then(() => undefined)} />}

    {confirmService && <div className="modal-backdrop"><div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="service-confirm-title" aria-describedby="service-confirm-description"><div className="confirm-card__icon"><XCircle size={24} /></div><h2 id="service-confirm-title">Inativar serviço?</h2><p id="service-confirm-description"><strong>{confirmService.name}</strong> ficará marcado como inativo. O cadastro e o histórico serão preservados.</p>{inactivateMutation.isError && <div className="inline-error" role="alert">{inactivateMutation.error instanceof Error ? inactivateMutation.error.message : 'Não foi possível inativar.'}</div>}<div className="confirm-card__actions"><button className="button button--secondary" onClick={() => setConfirmService(null)} disabled={inactivateMutation.isPending}>Cancelar</button><button className="button button--danger" onClick={() => inactivateMutation.mutate(confirmService)} disabled={inactivateMutation.isPending}>{inactivateMutation.isPending ? 'Inativando...' : 'Inativar serviço'}</button></div></div></div>}
    {toast && <div key={toast.id} className={`action-toast action-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}><div className="action-toast__body"><strong>{toast.title}</strong><span>{toast.description}</span></div></div>}
  </div>;
}
