import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Clock3, MailPlus, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserRoundX, X } from 'lucide-react';
import { api, type ManagedInvitation, type ManagedUser, type User } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { companyRoleLabel } from '../../utils/format';
import { UserAccessModal, type AccessTarget } from './UserAccessModal';
import './users.css';

const newKey = () => crypto.randomUUID();
const formatDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const statusLabel: Record<string, string> = { OWNER: 'Titular da conta', ACTIVE: 'Ativo', INACTIVE: 'Sem acesso', PENDING: 'Convite pendente', REVOKED: 'Cancelado', EXPIRED: 'Expirado' };
const deliveryLabel: Record<string, string> = { QUEUED: 'E-mail na fila', SENDING: 'Enviando e-mail', SENT: 'E-mail enviado', FAILED: 'Falha no envio', CANCELED: 'Envio cancelado' };

export function UsersPage({ user }: { user: User }) {
  const client = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{ id: string; target: AccessTarget } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const actionKeys = useRef(new Map<string, string>());
  const searchRef = useRef<HTMLInputElement>(null);
  const focusSearch = useRef(false);
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => { if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  const current = companies.data?.find((company) => company.id === companyId);
  const accountId = current?.accountOwner ? current.accountId : '';
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, enabled: !!accountId });
  const account = accounts.data?.find((item) => item.id === accountId);
  const capacity = useQuery({ queryKey: ['user-capacity', accountId], queryFn: () => api.userCapacity(accountId), enabled: !!accountId });
  const list = useQuery({ queryKey: ['managed-users', accountId, search, page], queryFn: () => api.managedUsers(accountId, search, page * 25), enabled: !!accountId });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['managed-users', accountId] }), client.invalidateQueries({ queryKey: ['user-capacity', accountId] })]); };
  const action = useMutation({
    mutationFn: ({ item, operation, key }: { item: ManagedInvitation; operation: 'resend' | 'revoke'; key: string }) => operation === 'resend' ? api.resendInvitation(accountId, item.id, item.version, key) : api.revokeInvitation(accountId, item.id, item.version, key),
    onSuccess: async (_data, variables) => { actionKeys.current.delete(`${accountId}:${variables.item.id}:${variables.item.version}:${variables.operation}`); setError(''); setNotice(variables.operation === 'resend' ? 'Novo convite colocado na fila. O link anterior foi invalidado.' : 'Convite cancelado. As vagas foram liberadas.'); await refresh(); },
    onError: async (cause) => { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir.'); await refresh(); },
  });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); client.clear(); window.location.assign('/Clientes'); } });
  useEffect(() => {
    if (!editor && focusSearch.current) {
      focusSearch.current = false;
      searchRef.current?.focus();
    }
  }, [editor]);
  useEffect(() => { setEditor(null); }, [accountId]);
  const rows = capacity.data ?? [];
  const pending = list.data?.items.filter((item) => item.type === 'INVITATION' && item.status === 'PENDING').length ?? 0;
  function searchUsers(event: FormEvent) { event.preventDefault(); setSearch(searchInput.trim()); setPage(0); }
  function edit(item: ManagedUser) {
    if (item.type === 'MEMBER' && (item.accountOwner || item.status === 'OWNER')) return;
    setError('');
    setNotice('');
    setEditor({ id: `${item.type}:${item.id}:${item.version}`, target: item.type === 'MEMBER' ? { kind: 'member', item } : { kind: 'pending', item } });
  }
  function locateMember(email: string) {
    focusSearch.current = true;
    setSearchInput(email);
    setSearch(email);
    setPage(0);
    setEditor(null);
    void client.invalidateQueries({ queryKey: ['managed-users', accountId, email, 0] });
  }
  function invitationAction(item: ManagedInvitation, operation: 'resend' | 'revoke') {
    const command = `${accountId}:${item.id}:${item.version}:${operation}`;
    if (!actionKeys.current.has(command)) actionKeys.current.set(command, newKey());
    action.mutate({ item, operation, key: actionKeys.current.get(command)! });
  }
  function chooseCompany(id: string) { setCompanyId(id); setPage(0); setEditor(null); setError(''); setNotice(''); }

  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={chooseCompany} onLogout={() => logout.mutate()} loggingOut={logout.isPending}>
    <main id="workspace-main" className="client-workspace__main users-main" tabIndex={-1}>
      <div className="users-heading"><div><p className="eyebrow">CADASTROS / USUÁRIOS</p><h1>Usuários e convites</h1><p>Convide pessoas e escolha as empresas que elas podem acessar.</p></div>
        {accountId && <button className="button button--primary" type="button" disabled={account?.status !== 'ACTIVE' || !rows.length} onClick={() => { setEditor({ id: 'novo', target: { kind: 'invite', defaultCompanyIds: rows.some((row) => row.companyId === companyId && row.status === 'ACTIVE' && row.available > 0) ? [companyId] : [] } }); setError(''); setNotice(''); }}><Plus size={16} /> Novo usuário</button>}
      </div>
      {notice && <div className="notice notice--success" role="status"><Check size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && !editor && <div className="notice notice--error" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fechar erro"><X size={15} /></button></div>}
      {!accountId ? <section className="users-empty"><ShieldCheck size={32} /><h2>Selecione uma empresa sua</h2><p>A gestão de usuários está disponível para o titular da empresa. Troque a empresa no seletor acima para administrar seus convites.</p></section> : <>
        <section className="users-list"><div className="users-list__top"><div><h2>Pessoas e convites <span>{list.data?.total ?? 0}</span></h2><p>{pending} {pending === 1 ? 'convite aguardando aceite' : 'convites aguardando aceite'}</p></div><button type="button" className="button button--secondary" onClick={() => { refresh(); list.refetch(); }} aria-label="Atualizar lista"><RefreshCw size={15} /> Atualizar</button></div>
          <form className="users-search" onSubmit={searchUsers}><Search size={16} /><input ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" /><button type="submit">Buscar</button></form>
          <div className="users-list__head"><span>PESSOA</span><span>EMPRESAS</span><span>SITUAÇÃO</span><span>AÇÕES</span></div>
          {list.isPending && <div className="table-loading" aria-label="Carregando usuários"><div /><div /><div /></div>}
          {list.isError && <div className="users-empty"><AlertCircle size={27} /><h2>Não foi possível carregar os usuários</h2><button className="button button--secondary" type="button" onClick={() => list.refetch()}>Tentar novamente</button></div>}
          {list.isSuccess && !list.data.items.length && <div className="users-empty"><MailPlus size={29} /><h2>Nenhum resultado</h2><p>Convide uma pessoa ou altere sua busca.</p></div>}
          {list.data?.items.map((item) => <div className="users-row" key={`${item.type}-${item.id}`}><div className="users-row__person"><span className="users-avatar">{item.name.slice(0, 1).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.email}</small>{(item.type === 'INVITATION' || !item.accountOwner) && <small>{companyRoleLabel(item.roleLabel)}</small>}</div></div><div className="users-row__companies">{item.companies.filter((company) => !('status' in company) || company.status === 'ACTIVE').map((company) => <span key={'companyId' in company ? company.companyId : company.id}>{'companyName' in company ? company.companyName : company.tradeName}</span>)}{item.companies.length === 0 && <small>Nenhuma empresa</small>}</div><div className="users-row__state"><span className={`users-status users-status--${item.status.toLowerCase()}`}>{item.type === 'INVITATION' && item.status === 'PENDING' ? <Clock3 size={12} /> : null}{statusLabel[item.status]}</span>{item.type === 'INVITATION' && item.status === 'PENDING' && <small>Até {formatDate(item.expiresAt)}<br />{deliveryLabel[item.delivery?.sendStatus ?? ''] ?? 'Aguardando envio'}</small>}</div><div className="users-row__actions">{item.type === 'MEMBER' ? !item.accountOwner && item.status !== 'OWNER' && <button type="button" onClick={() => edit(item)}><Pencil size={14} /> Editar acesso</button> : item.status === 'PENDING' && <><button type="button" disabled={action.isPending} onClick={() => edit(item)}><Pencil size={14} /> Editar acesso</button><button type="button" disabled={action.isPending} onClick={() => invitationAction(item, 'resend')}><RefreshCw size={14} /> Reenviar</button><button type="button" className="users-row__danger" disabled={action.isPending} onClick={() => invitationAction(item, 'revoke')}><UserRoundX size={14} /> Cancelar</button></>}</div></div>)}
          {list.data && list.data.total > 25 && <div className="users-pagination"><span>{page * 25 + 1}–{Math.min((page + 1) * 25, list.data.total)} de {list.data.total}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" disabled={(page + 1) * 25 >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</button></div></div>}
        </section>
      </>}
      {accountId && editor && <UserAccessModal key={editor.id} target={editor.target} accountId={accountId} rows={rows}
        onClose={() => setEditor(null)}
        onLocate={locateMember}
        onSaved={async (kind) => {
          setEditor(null);
          setError('');
          setNotice(kind === 'invite' ? 'Convite criado. O e-mail está na fila de envio.' : 'Acesso atualizado.');
          await refresh();
        }}
        onStale={async () => { setEditor(null); await refresh(); }} />}
    </main>
  </WorkspaceLayout>;
}
