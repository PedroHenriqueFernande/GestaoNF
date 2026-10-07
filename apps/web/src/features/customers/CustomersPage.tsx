import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Building2, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, LogOut, Pencil, Plus, Search, UserRoundX } from 'lucide-react';
import { api, ApiError, type Customer, type CustomerInput, type CustomerList, type User } from '../../api/client';
import { Brand } from '../../components/Brand';
import { formatPhone, formatTaxId, initials } from '../../utils/format';
import { CustomerForm } from './CustomerForm';

type DrawerState = { mode: 'create' } | { mode: 'edit'; customer: Customer } | null;
type CustomerStatus = 'ACTIVE' | 'INACTIVE';
type SearchRequest = { companyId: string; term: string; status: CustomerStatus; page: number; serial: number };
type Toast = { id: number; title: string; description: string; tone: 'success' | 'error' };
const PAGE_SIZE = 10;

function MobileCustomerList({ items, onEdit, onInactivate, onReactivate, reactivating }: {
  items: Customer[];
  onEdit: (customer: Customer) => void;
  onInactivate: (customer: Customer) => void;
  onReactivate: (customer: Customer) => void;
  reactivating: boolean;
}) {
  return <div className="mobile-customer-list">{items.map((customer) => <article className="mobile-customer" key={customer.id}>
    <div className="mobile-customer__head"><div className="mobile-customer__identity"><strong>{customer.name}</strong><small>{customer.kind === 'PJ' ? customer.tradeName || 'Pessoa jurídica' : 'Pessoa física'}</small></div><span className={`status-pill ${customer.status === 'ACTIVE' ? 'status-pill--active' : 'status-pill--inactive'}`}>{customer.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</span></div>
    <div className="mobile-customer__details"><div><span>DOCUMENTO</span><strong>{customer.taxId ? formatTaxId(customer.taxId, customer.kind) : 'Não informado'}</strong></div><div><span>CONTATO</span><strong>{customer.email || customer.phone ? customer.email || formatPhone(customer.phone) : 'Não informado'}</strong></div></div>
    <div className="mobile-customer__actions"><button type="button" onClick={() => onEdit(customer)}><Pencil size={15} /> Editar</button>{customer.status === 'ACTIVE' ? <button type="button" onClick={() => onInactivate(customer)}><UserRoundX size={15} /> Inativar</button> : <button type="button" onClick={() => onReactivate(customer)} disabled={reactivating}><CircleCheck size={15} /> Reativar</button>}</div>
  </article>)}</div>;
}

export function CustomersPage({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const searchSequence = useRef(0);
  const toastSequence = useRef(0);
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [inputSearch, setInputSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<CustomerStatus>('ACTIVE');
  const [searchRequest, setSearchRequest] = useState<SearchRequest | null>(null);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [confirmCustomer, setConfirmCustomer] = useState<Customer | null>(null);
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
  const listKey = ['customers', companyId, searchRequest?.status, searchRequest?.term, searchRequest?.page, searchRequest?.serial] as const;
  const list = useQuery({
    queryKey: listKey,
    queryFn: () => api.customers(companyId, { search: searchRequest!.term, status: searchRequest!.status, page: searchRequest!.page, limit: PAGE_SIZE }),
    enabled: !!companyId && !!searchRequest && searchRequest.companyId === companyId && searchRequest.status === selectedStatus,
  });

  function updateVisibleCustomer(customer: Customer) {
    if (!searchRequest || searchRequest.companyId !== companyId) return;
    queryClient.setQueryData<CustomerList>(listKey, (previous) => previous && ({
      ...previous,
      total: previous.total - (previous.items.some((item) => item.id === customer.id) && customer.status !== searchRequest.status ? 1 : 0),
      items: previous.items.filter((item) => item.id !== customer.id || customer.status === searchRequest.status)
        .map((item) => item.id === customer.id ? customer : item),
    }));
  }

  const saveMutation = useMutation({
    mutationFn: ({ input, id }: { input: CustomerInput; id?: string }) => id ? api.updateCustomer(companyId, id, input) : api.createCustomer(companyId, input),
    onSuccess: (customer, variables) => {
      showToast(variables.id ? 'Alterações salvas' : 'Cliente cadastrado', variables.id
        ? `As alterações de ${customer.name} foram salvas.`
        : `Cadastro de ${customer.name} concluído.`);
      setDrawer(null);
      if (variables.id) { updateVisibleCustomer(customer); return; }
      if (!searchRequest || searchRequest.companyId !== companyId || searchRequest.status !== 'ACTIVE' || searchRequest.page !== 0 || searchRequest.term) return;
      queryClient.setQueryData<CustomerList>(listKey, (previous) => previous && ({
        ...previous,
        total: previous.total + 1,
        items: [...previous.items, customer].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).slice(0, PAGE_SIZE),
      }));
    },
  });
  const inactivateMutation = useMutation({
    mutationFn: (customer: Customer) => api.inactivateCustomer(companyId, customer.id),
    onSuccess: (_result, customer) => {
      setConfirmCustomer(null);
      showToast('Cliente inativado', `${customer.name} foi movido para Inativos.`);
      updateVisibleCustomer({ ...customer, status: 'INACTIVE' });
    },
  });
  const reactivateMutation = useMutation({
    mutationFn: (customer: Customer) => api.updateCustomer(companyId, customer.id, { status: 'ACTIVE' }),
    onSuccess: (customer) => { showToast('Cliente reativado', `${customer.name} foi movido para Ativos.`); updateVisibleCustomer(customer); },
    onError: (error) => showToast('Não foi possível reativar', error instanceof Error ? error.message : 'Tente novamente.', 'error'),
  });
  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); queryClient.clear(); window.location.assign('/Clientes'); },
  });

  const closeDrawer = useCallback(() => { if (!saveMutation.isPending) setDrawer(null); }, [saveMutation.isPending]);
  const openCreate = () => { saveMutation.reset(); setDrawer({ mode: 'create' }); };
  const openEdit = (customer: Customer) => { saveMutation.reset(); setDrawer({ mode: 'edit', customer }); };
  const openInactivate = (customer: Customer) => { inactivateMutation.reset(); setConfirmCustomer(customer); };
  const lastPage = Math.max(0, Math.ceil((list.data?.total ?? 0) / PAGE_SIZE) - 1);
  const currentPage = searchRequest?.page ?? 0;

  function searchCustomers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!companyId) return;
    setSearchRequest({ companyId, term: inputSearch.trim(), status: selectedStatus, page: 0, serial: ++searchSequence.current });
  }

  function changeStatus(status: CustomerStatus) {
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
    setConfirmCustomer(null);
    setToast(null);
  }

  return <div className="app-shell client-workspace">
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

      {!!companyId && <section className="client-panel" aria-labelledby="client-panel-title">
        <div className="client-panel__title"><h1 id="client-panel-title">Clientes</h1></div>
        <div className="client-panel__rule" />
        <form className="client-search" onSubmit={searchCustomers} role="search">
          <input aria-label="Buscar clientes" value={inputSearch} onChange={(event) => setInputSearch(event.target.value)} placeholder="Pesquise por nome, CPF/CNPJ ou telefone" />
          <button type="submit" aria-label="Pesquisar clientes" title="Pesquisar clientes"><Search size={18} strokeWidth={2.4} /></button>
        </form>
        <div className="client-panel__actions">
          <div className="client-status-tabs" role="group" aria-label="Situação dos clientes">
            <button type="button" className={selectedStatus === 'ACTIVE' ? 'is-selected' : ''} aria-pressed={selectedStatus === 'ACTIVE'} onClick={() => changeStatus('ACTIVE')}>Ativos</button>
            <button type="button" className={selectedStatus === 'INACTIVE' ? 'is-selected' : ''} aria-pressed={selectedStatus === 'INACTIVE'} onClick={() => changeStatus('INACTIVE')}>Inativos</button>
          </div>
          <button type="button" className="client-new-button" aria-label="Novo cliente" onClick={openCreate}><Plus size={16} /> Novo</button>
        </div>

        {searchRequest && searchRequest.companyId === companyId && searchRequest.status === selectedStatus && <div className="client-results" aria-live="polite">
          {list.isPending ? <div className="table-loading" aria-label="Carregando clientes"><div /><div /><div /></div> : list.isError ? <div className="empty-panel"><AlertCircle size={28} /><h2>Não foi possível carregar os clientes</h2><p>{list.error instanceof ApiError ? list.error.message : 'Tente novamente pela lupa.'}</p></div> : <>
            <div className="client-results__heading"><h2>Resultados da pesquisa</h2><span>{list.data.total} {list.data.total === 1 ? 'cliente' : 'clientes'}</span></div>
            {!list.data.items.length ? <div className="client-results__empty"><Search size={23} /><p>{list.data.total ? 'Nenhum cliente nesta página.' : `Nenhum cliente ${selectedStatus === 'INACTIVE' ? 'inativo' : 'ativo'} encontrado.`}</p><span>{list.data.total ? 'Volte à página anterior ou faça uma nova pesquisa.' : searchRequest.term ? 'Experimente outro nome, documento ou telefone.' : selectedStatus === 'INACTIVE' ? 'Os clientes inativados aparecerão aqui.' : 'Cadastre um cliente pelo botão Novo cliente.'}</span></div> : <>
              <div className="table-scroll"><table className="customers-table"><thead><tr><th>CLIENTE</th><th>DOCUMENTO</th><th>CONTATO</th><th>SITUAÇÃO</th><th className="align-right">AÇÕES</th></tr></thead><tbody>{list.data.items.map((customer) => <tr key={customer.id}><td><div className="customer-cell"><div><strong title={customer.name}>{customer.name}</strong><span>{customer.kind === 'PJ' ? customer.tradeName || 'Pessoa jurídica' : 'Pessoa física'}</span></div></div></td><td className="mono-cell">{customer.taxId ? formatTaxId(customer.taxId, customer.kind) : <span className="muted-text">Não informado</span>}</td><td><div className="contact-cell"><span>{customer.email || <span className="muted-text">Sem e-mail</span>}</span>{customer.phone && <small>{formatPhone(customer.phone)}</small>}</div></td><td><span className={`status-pill ${customer.status === 'ACTIVE' ? 'status-pill--active' : 'status-pill--inactive'}`}>{customer.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}</span></td><td><div className="row-actions"><button type="button" className="table-action" onClick={() => openEdit(customer)} title={`Editar ${customer.name}`} aria-label={`Editar ${customer.name}`}><Pencil size={16} /></button>{customer.status === 'ACTIVE' ? <button type="button" className="table-action table-action--danger" onClick={() => openInactivate(customer)} title={`Inativar ${customer.name}`} aria-label={`Inativar ${customer.name}`}><UserRoundX size={17} /></button> : <button type="button" className="table-action" onClick={() => reactivateMutation.mutate(customer)} disabled={reactivateMutation.isPending} title={`Reativar ${customer.name}`} aria-label={`Reativar ${customer.name}`}><CircleCheck size={17} /></button>}</div></td></tr>)}</tbody></table></div>
              <MobileCustomerList items={list.data.items} onEdit={openEdit} onInactivate={openInactivate} onReactivate={(customer) => reactivateMutation.mutate(customer)} reactivating={reactivateMutation.isPending} />
            </>}
            {list.data.total > 0 && <div className="pagination"><span>{list.data.items.length ? <>Exibindo <strong>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, list.data.total)}</strong> de <strong>{list.data.total}</strong></> : <>{list.data.total} {list.data.total === 1 ? 'cliente' : 'clientes'}</>}</span><div><button type="button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setSearchRequest((current) => current && ({ ...current, page: current.page - 1 }))}><ChevronLeft size={17} /></button><span>Página {currentPage + 1} de {lastPage + 1}</span><button type="button" aria-label="Próxima página" disabled={currentPage >= lastPage} onClick={() => setSearchRequest((current) => current && ({ ...current, page: current.page + 1 }))}><ChevronRight size={17} /></button></div></div>}
          </>}
        </div>}
      </section>}
    </main>

    {drawer && <CustomerForm customer={drawer.mode === 'edit' ? drawer.customer : undefined} onClose={closeDrawer} saving={saveMutation.isPending} saveError={saveMutation.error} onSave={(input) => saveMutation.mutateAsync({ input, id: drawer.mode === 'edit' ? drawer.customer.id : undefined }).then(() => undefined)} />}

    {confirmCustomer && <div className="modal-backdrop"><div className="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description"><div className="confirm-card__icon"><UserRoundX size={24} /></div><h2 id="confirm-title">Inativar cliente?</h2><p id="confirm-description"><strong>{confirmCustomer.name}</strong> ficará marcado como inativo. O cadastro e o histórico serão preservados.</p>{inactivateMutation.isError && <div className="inline-error" role="alert">{inactivateMutation.error instanceof Error ? inactivateMutation.error.message : 'Não foi possível inativar.'}</div>}<div className="confirm-card__actions"><button className="button button--secondary" onClick={() => setConfirmCustomer(null)} disabled={inactivateMutation.isPending}>Cancelar</button><button className="button button--danger" onClick={() => inactivateMutation.mutate(confirmCustomer)} disabled={inactivateMutation.isPending}>{inactivateMutation.isPending ? 'Inativando...' : 'Inativar cliente'}</button></div></div></div>}
    {toast && <div key={toast.id} className={`action-toast action-toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      <div className="action-toast__body"><strong>{toast.title}</strong><span>{toast.description}</span></div>
    </div>}
  </div>;
}
