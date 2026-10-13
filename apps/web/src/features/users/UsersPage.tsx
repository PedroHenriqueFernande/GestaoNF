import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Check, Clock3, MailPlus, Pencil, Plus, RefreshCw, Search, ShieldCheck, UserRoundX, UsersRound, X } from 'lucide-react';
import { api, type ManagedInvitation, type ManagedMember, type ManagedUser, type User, type UserCapacity } from '../../api/client';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import './users.css';

type Editor = ({ kind: 'invite'; name: string; email: string; selected: string[] } | { kind: 'member'; item: ManagedMember; selected: string[] } | { kind: 'pending'; item: ManagedInvitation; selected: string[] }) & { key: string };
const newKey = () => crypto.randomUUID();
const formatDate = (value: string) => new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
const statusLabel: Record<string, string> = { OWNER: 'Titular', ACTIVE: 'Ativo', INACTIVE: 'Sem acesso', PENDING: 'Convite pendente', REVOKED: 'Cancelado', EXPIRED: 'Expirado' };
const deliveryLabel: Record<string, string> = { QUEUED: 'E-mail na fila', SENDING: 'Enviando e-mail', SENT: 'E-mail enviado', FAILED: 'Falha no envio', CANCELED: 'Envio cancelado' };

function CompanyChoices({ rows, selected, onChange, existing = [] }: { rows: UserCapacity[]; selected: string[]; onChange: (next: string[]) => void; existing?: string[] }) {
  return <fieldset className="users-company-choices"><legend>Empresas com acesso <span>*</span></legend>
    {rows.map((row) => {
      const checked = selected.includes(row.companyId);
      const disabled = !checked && (row.status !== 'ACTIVE' || (!existing.includes(row.companyId) && row.available === 0));
      return <label className={`users-company-choice${checked ? ' is-selected' : ''}${disabled ? ' is-disabled' : ''}`} key={row.companyId}>
        <input type="checkbox" checked={checked} disabled={disabled} onChange={() => onChange(checked ? selected.filter((id) => id !== row.companyId) : [...selected, row.companyId])} />
        <span className="users-company-choice__check"><Check size={13} /></span>
        <span className="users-company-choice__name">{row.name}<small>{row.status !== 'ACTIVE' ? 'Empresa indisponível' : `${row.occupied} ocupadas · ${row.reserved} reservadas`}</small></span>
        <strong>{row.available} de {row.limit} livres</strong>
      </label>;
    })}
  </fieldset>;
}

export function UsersPage({ user }: { user: User }) {
  const client = useQueryClient();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const actionKeys = useRef(new Map<string, string>());
  const modalRef = useRef<HTMLElement>(null);
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => { if (companies.data && !companies.data.some((company) => company.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  const current = companies.data?.find((company) => company.id === companyId);
  const accountId = current?.role === 'OWNER' ? current.accountId : '';
  const accounts = useQuery({ queryKey: ['accounts'], queryFn: api.accounts, enabled: !!accountId });
  const account = accounts.data?.find((item) => item.id === accountId);
  const capacity = useQuery({ queryKey: ['user-capacity', accountId], queryFn: () => api.userCapacity(accountId), enabled: !!accountId });
  const list = useQuery({ queryKey: ['managed-users', accountId, search, page], queryFn: () => api.managedUsers(accountId, search, page * 25), enabled: !!accountId });
  const refresh = async () => { await Promise.all([client.invalidateQueries({ queryKey: ['managed-users', accountId] }), client.invalidateQueries({ queryKey: ['user-capacity', accountId] })]); };
  const save = useMutation({
    mutationFn: async (draft: Editor) => {
      if (draft.kind === 'invite') return api.inviteUser(accountId, { name: draft.name.trim(), email: draft.email.trim().toLowerCase(), companyIds: draft.selected }, draft.key);
      if (draft.kind === 'pending') return api.changeInvitationCompanies(accountId, draft.item.id, draft.item.version, draft.selected, draft.key);
      return api.changeMemberCompanies(accountId, draft.item.id, draft.item.version, draft.selected, draft.key);
    },
    onSuccess: async (_data, draft) => { setEditor(null); setError(''); setNotice(draft.kind === 'invite' ? 'Convite criado. O e-mail está na fila de envio.' : 'Acesso atualizado.'); await refresh(); },
    onError: async (cause) => { setError(cause instanceof Error ? cause.message : 'Não foi possível salvar.'); await refresh(); },
  });
  const action = useMutation({
    mutationFn: ({ item, operation, key }: { item: ManagedInvitation; operation: 'resend' | 'revoke'; key: string }) => operation === 'resend' ? api.resendInvitation(accountId, item.id, item.version, key) : api.revokeInvitation(accountId, item.id, item.version, key),
    onSuccess: async (_data, variables) => { actionKeys.current.delete(`${accountId}:${variables.item.id}:${variables.item.version}:${variables.operation}`); setError(''); setNotice(variables.operation === 'resend' ? 'Novo convite colocado na fila. O link anterior foi invalidado.' : 'Convite cancelado. As vagas foram liberadas.'); await refresh(); },
    onError: async (cause) => { setError(cause instanceof Error ? cause.message : 'Não foi possível concluir.'); await refresh(); },
  });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); client.clear(); window.location.assign('/Clientes'); } });
  useEffect(() => {
    if (!editor) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = requestAnimationFrame(() => modalRef.current?.querySelector<HTMLElement>('[autofocus], button')?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !save.isPending) { setEditor(null); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ?? []).filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls[controls.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === controls[controls.length - 1]) { event.preventDefault(); controls[0].focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => { cancelAnimationFrame(focus); document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [!!editor, save.isPending]);
  const rows = capacity.data ?? [];
  const totalFree = rows.reduce((sum, row) => sum + row.available, 0);
  const pending = list.data?.items.filter((item) => item.type === 'INVITATION' && item.status === 'PENDING').length ?? 0;
  const isBusy = save.isPending || action.isPending;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!editor) return;
    setError('');
    if (editor.kind === 'invite' && (!editor.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editor.email.trim()))) { setError('Informe nome e e-mail válidos.'); return; }
    if (editor.kind !== 'member' && editor.selected.length === 0) { setError('Selecione ao menos uma empresa.'); return; }
    save.mutate(editor);
  }
  function searchUsers(event: FormEvent) { event.preventDefault(); setSearch(searchInput.trim()); setPage(0); }
  function edit(item: ManagedUser) {
    setError(''); setNotice('');
    setEditor(item.type === 'MEMBER' ? { kind: 'member', item, selected: item.companies.filter((company) => company.status === 'ACTIVE').map((company) => company.companyId), key: newKey() } : { kind: 'pending', item, selected: item.companies.map((company) => company.id), key: newKey() });
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
        {accountId && <button className="button button--primary" type="button" disabled={account?.status !== 'ACTIVE' || !rows.length} onClick={() => { setEditor({ kind: 'invite', name: '', email: '', selected: rows.some((row) => row.companyId === companyId && row.available > 0) ? [companyId] : [], key: newKey() }); setError(''); setNotice(''); }}><Plus size={16} /> Novo usuário</button>}
      </div>
      {notice && <div className="notice notice--success" role="status"><Check size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="Fechar aviso"><X size={15} /></button></div>}
      {error && !editor && <div className="notice notice--error" role="alert"><AlertCircle size={16} /><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Fechar erro"><X size={15} /></button></div>}
      {!accountId ? <section className="users-empty"><ShieldCheck size={32} /><h2>Selecione uma empresa sua</h2><p>A gestão de usuários está disponível para o titular da empresa. Troque a empresa no seletor acima para administrar seus convites.</p></section> : <>
        <section className="users-overview" aria-label="Vagas por empresa"><div className="users-overview__intro"><span className="users-overview__icon"><UsersRound size={22} /></span><div><span>CONTRATAÇÃO</span><h2>{account?.name ?? current?.name}</h2><p>5 usuários adicionais por empresa. Convites pendentes reservam vagas por 24 horas.</p></div><strong>{totalFree}<small>vagas livres</small></strong></div>
          <div className="users-capacity-grid">{capacity.isPending && <p>Carregando vagas...</p>}{capacity.isError && <p role="alert">Não foi possível consultar as vagas. <button type="button" onClick={() => capacity.refetch()}>Tentar novamente</button></p>}{rows.map((row) => <div className="users-capacity" key={row.companyId}><div><strong>{row.name}</strong><span>{row.available} de {row.limit} vagas livres</span></div><div className="users-capacity__track"><span style={{ width: `${Math.min(100, ((row.occupied + row.reserved) / Math.max(row.limit, 1)) * 100)}%` }} /></div><small>{row.occupied} ocupadas · {row.reserved} reservadas{row.overLimit > 0 ? ` · ${row.overLimit} acima do limite` : ''}</small></div>)}</div>
        </section>
        <section className="users-list"><div className="users-list__top"><div><h2>Pessoas e convites <span>{list.data?.total ?? 0}</span></h2><p>{pending} {pending === 1 ? 'convite aguardando aceite' : 'convites aguardando aceite'}</p></div><button type="button" className="button button--secondary" onClick={() => { refresh(); list.refetch(); }} aria-label="Atualizar lista"><RefreshCw size={15} /> Atualizar</button></div>
          <form className="users-search" onSubmit={searchUsers}><Search size={16} /><input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Buscar por nome ou e-mail" aria-label="Buscar usuários" /><button type="submit">Buscar</button></form>
          <div className="users-list__head"><span>PESSOA</span><span>EMPRESAS</span><span>SITUAÇÃO</span><span>AÇÕES</span></div>
          {list.isPending && <div className="table-loading" aria-label="Carregando usuários"><div /><div /><div /></div>}
          {list.isError && <div className="users-empty"><AlertCircle size={27} /><h2>Não foi possível carregar os usuários</h2><button className="button button--secondary" type="button" onClick={() => list.refetch()}>Tentar novamente</button></div>}
          {list.isSuccess && !list.data.items.length && <div className="users-empty"><MailPlus size={29} /><h2>Nenhum resultado</h2><p>Convide uma pessoa ou altere sua busca.</p></div>}
          {list.data?.items.map((item) => <div className="users-row" key={`${item.type}-${item.id}`}><div className="users-row__person"><span className="users-avatar">{item.name.slice(0, 1).toUpperCase()}</span><div><strong>{item.name}</strong><small>{item.email}</small></div></div><div className="users-row__companies">{item.companies.filter((company) => !('status' in company) || company.status === 'ACTIVE').map((company) => <span key={'companyId' in company ? company.companyId : company.id}>{'companyName' in company ? company.companyName : company.name}</span>)}{item.companies.length === 0 && <small>Nenhuma empresa</small>}</div><div className="users-row__state"><span className={`users-status users-status--${item.status.toLowerCase()}`}>{item.type === 'INVITATION' && item.status === 'PENDING' ? <Clock3 size={12} /> : null}{statusLabel[item.status]}</span>{item.type === 'INVITATION' && item.status === 'PENDING' && <small>Até {formatDate(item.expiresAt)}<br />{deliveryLabel[item.delivery?.sendStatus ?? ''] ?? 'Aguardando envio'}</small>}</div><div className="users-row__actions">{item.type === 'MEMBER' ? item.status !== 'OWNER' && <button type="button" onClick={() => edit(item)}><Pencil size={14} /> Editar acesso</button> : item.status === 'PENDING' && <><button type="button" disabled={isBusy} onClick={() => edit(item)}><Pencil size={14} /> Empresas</button><button type="button" disabled={isBusy} onClick={() => invitationAction(item, 'resend')}><RefreshCw size={14} /> Reenviar</button><button type="button" className="users-row__danger" disabled={isBusy} onClick={() => invitationAction(item, 'revoke')}><UserRoundX size={14} /> Cancelar</button></>}</div></div>)}
          {list.data && list.data.total > 25 && <div className="users-pagination"><span>{page * 25 + 1}–{Math.min((page + 1) * 25, list.data.total)} de {list.data.total}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" disabled={(page + 1) * 25 >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</button></div></div>}
        </section>
      </>}
      {editor && <div className="modal-backdrop users-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !save.isPending) setEditor(null); }}><section ref={modalRef} className="users-modal" role="dialog" aria-modal="true" aria-labelledby="users-modal-title"><header><div><p className="eyebrow">{editor.kind === 'invite' ? 'NOVO CONVITE' : 'CONTROLE DE ACESSO'}</p><h2 id="users-modal-title">{editor.kind === 'invite' ? 'Convidar usuário' : editor.kind === 'pending' ? `Empresas de ${editor.item.name}` : `Acesso de ${editor.item.name}`}</h2><p>{editor.kind === 'invite' ? 'A pessoa receberá um e-mail para criar ou acessar sua conta.' : editor.kind === 'pending' ? 'Alterar as empresas gera um novo link de convite válido por 24 horas.' : 'Marque as empresas que esta pessoa poderá usar.'}</p></div><button type="button" onClick={() => setEditor(null)} disabled={save.isPending} aria-label="Fechar"><X size={19} /></button></header><form onSubmit={submit}><div className="users-modal__body">{editor.kind === 'invite' && <div className="users-fields"><label className="field"><span>Nome <b>*</b></span><input autoFocus maxLength={200} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value, key: newKey() })} placeholder="Nome completo" /></label><label className="field"><span>E-mail <b>*</b></span><input type="email" maxLength={254} value={editor.email} onChange={(event) => setEditor({ ...editor, email: event.target.value, key: newKey() })} placeholder="pessoa@exemplo.com" autoComplete="email" /></label></div>}{editor.kind !== 'invite' && <p className="users-modal__email">{editor.item.email}</p>}<CompanyChoices rows={rows} selected={editor.selected} existing={editor.kind === 'invite' ? [] : editor.kind === 'pending' ? editor.item.companies.map((company) => company.id) : editor.item.companies.filter((company) => company.status === 'ACTIVE').map((company) => company.companyId)} onChange={(selected) => setEditor({ ...editor, selected, key: newKey() } as Editor)} />{editor.kind === 'member' && editor.selected.length === 0 && <p className="users-modal__hint">Salvar sem empresas desativa o acesso nesta contratação.</p>}{error && <div className="inline-error" role="alert">{error}</div>}</div><footer><button className="button button--secondary" type="button" disabled={save.isPending} onClick={() => setEditor(null)}>Cancelar</button><button className="button button--primary" type="submit" disabled={save.isPending || !rows.length}>{save.isPending ? 'Salvando...' : editor.kind === 'invite' ? 'Enviar convite' : 'Salvar acesso'}</button></footer></form></section></div>}
    </main>
  </WorkspaceLayout>;
}
