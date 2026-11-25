import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ROLE_LABELS, selectionSummary, sortByCatalog, type RoleLabel, type Selection } from '@gestaonf/permissions';
import { Check, ChevronDown, X } from 'lucide-react';
import { api, ApiError, type ManagedInvitation, type ManagedMember, type UserCapacity } from '../../api/client';
import { useDropdown } from '../../components/useDropdown';
import { companyRoleLabel } from '../../utils/format';
import { PermissionsDialog } from './PermissionsDialog';

export type AccessTarget =
  | { kind: 'invite'; defaultCompanyIds: string[] }
  | { kind: 'member'; item: ManagedMember }
  | { kind: 'pending'; item: ManagedInvitation };

type Draft = { name: string; email: string; companyIds: string[]; roleLabel: RoleLabel; permissions: Selection };
type SaveError = { message: string; code?: string; status?: number };

function initialDraft(target: AccessTarget, rows: UserCapacity[]): Draft {
  if (target.kind === 'invite') {
    // Com uma única empresa na contratação, o convite já sai com ela marcada.
    const companyIds = rows.length === 1 && selectable(rows[0]) ? [rows[0].companyId] : target.defaultCompanyIds;
    return { name: '', email: '', companyIds, roleLabel: 'COLLABORATOR', permissions: new Set() };
  }
  const companyIds = target.kind === 'member'
    ? target.item.companies.filter(company => company.status === 'ACTIVE').map(company => company.companyId)
    : target.item.companies.map(company => company.id);
  return { name: target.item.name, email: target.item.email, companyIds, roleLabel: target.item.roleLabel, permissions: new Set(target.item.permissions) };
}

const sameDraft = (a: Draft, b: Draft) => a.name === b.name && a.email === b.email && a.roleLabel === b.roleLabel
  && [...a.companyIds].sort().join() === [...b.companyIds].sort().join()
  && sortByCatalog(a.permissions).join() === sortByCatalog(b.permissions).join();

const conflictMessages: Record<string, string> = {
  VERSION_CONFLICT: 'Os dados mudaram enquanto você editava. Recarregue para ver o acesso atual.',
  IDEMPOTENCY_CONFLICT: 'O salvamento entrou em conflito com uma tentativa anterior. Recarregue os dados.',
  COMPANY_USER_LIMIT_REACHED: 'Uma das empresas selecionadas atingiu o limite de usuários.',
  INVITATION_ALREADY_PENDING: 'Já existe um convite pendente para este e-mail.',
  OWNER_PROTECTED: 'O titular da contratação já tem acesso a todas as empresas.',
};

function saveError(cause: unknown): SaveError {
  if (cause instanceof ApiError) {
    return { message: conflictMessages[cause.code ?? ''] ?? cause.message, status: cause.status, code: cause.code };
  }
  return { message: cause instanceof Error ? cause.message : 'Não foi possível salvar.' };
}

const selectable = (row: UserCapacity) => row.status === 'ACTIVE' && row.available > 0;

function CompanySelect({ rows, selected, onChange, existing = [] }: { rows: UserCapacity[]; selected: string[]; onChange: (next: string[]) => void; existing?: string[] }) {
  const dropdown = useDropdown();
  const [position, setPosition] = useState<CSSProperties>();
  const chosen = rows.filter((row) => selected.includes(row.companyId));
  const summary = chosen.length === 0 ? 'Selecione as empresas' : chosen.length === 1 ? chosen[0].tradeName : `${chosen.length} empresas selecionadas`;
  const { open, close, triggerRef, panelRef } = dropdown;

  // O corpo do modal rola e cortaria um painel absoluto: o painel é fixo, alinhado ao gatilho, abre para cima
  // quando falta espaço embaixo e fecha só quando rola algo que move o gatilho (não o próprio painel ou um campo).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 16;
      const above = rect.top - 16;
      setPosition(below < 200 && above > below
        ? { top: 'auto', bottom: window.innerHeight - rect.top + 6, left: rect.left, width: rect.width, maxHeight: above }
        : { top: rect.bottom + 6, left: rect.left, width: rect.width, maxHeight: below });
    };
    const closeOnScroll = (event: Event) => {
      const scrolled = event.target instanceof Document ? event.target.documentElement : event.target;
      if (scrolled instanceof Node && scrolled.contains(triggerRef.current)) close();
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open, close, triggerRef, panelRef]);

  return <div ref={dropdown.rootRef} className="field dropdown users-company-select">
    <span id="companies-label">Empresas com acesso <b>*</b></span>
    <button ref={triggerRef} type="button" className={`users-company-select__trigger${chosen.length ? '' : ' is-empty'}`} aria-haspopup="menu" aria-expanded={open} aria-controls="companies-menu" aria-labelledby="companies-label companies-summary" aria-describedby="companies-hint" onClick={dropdown.toggle} onKeyDown={dropdown.onTriggerKeyDown}>
      <span id="companies-summary">{summary}</span>
      <ChevronDown className="dropdown-chevron" size={16} aria-hidden="true" />
    </button>
    <small id="companies-hint" className="field-hint">Convites pendentes reservam vagas por 24 horas.</small>
    <div id="companies-menu" ref={panelRef} role="menu" aria-labelledby="companies-label" className={`dropdown-panel users-company-select__panel${open ? ' is-open' : ''}`} style={position} inert={!open}>
      {rows.map((row) => {
        const checked = selected.includes(row.companyId);
        const disabled = !checked && (row.status !== 'ACTIVE' || (!existing.includes(row.companyId) && row.available === 0));
        return <button type="button" role="menuitemcheckbox" aria-checked={checked} disabled={disabled} key={row.companyId}
          className={`dropdown-item users-company-option${checked ? ' is-checked' : ''}`}
          onClick={() => onChange(checked ? selected.filter((id) => id !== row.companyId) : [...selected, row.companyId])}>
          <span className="users-company-option__check" aria-hidden="true"><Check size={13} /></span>
          <span className="users-company-option__name">{row.tradeName}<small>{row.status !== 'ACTIVE' ? 'Empresa indisponível' : `${row.occupied} ocupadas · ${row.reserved} reservadas`}</small></span>
          <strong>{row.available} de {row.limit} livres</strong>
        </button>;
      })}
    </div>
  </div>;
}

export function UserAccessModal({ target, accountId, rows, onClose, onSaved, onStale, onLocate }: {
  target: AccessTarget;
  accountId: string;
  rows: UserCapacity[];
  onClose: () => void;
  onSaved: (kind: 'invite' | 'access') => void;
  onStale: () => void;
  onLocate: (email: string) => void;
}) {
  const [initial] = useState(() => initialDraft(target, rows));
  const [draft, setDraft] = useState(initial);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState<SaveError | null>(null);
  const [permissionsOpen, setPermissionsOpen] = useState(false);
  const modalRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const permissionsButton = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);

  function update(patch: Partial<Draft>) {
    setDraft(current => ({ ...current, ...patch }));
    setKey(crypto.randomUUID());
    setError(null);
  }

  const email = draft.email.trim().toLowerCase();
  const save = useMutation({
    mutationFn: async () => {
      const access = { companyIds: draft.companyIds, roleLabel: draft.roleLabel, permissions: sortByCatalog(draft.permissions) };
      if (target.kind === 'invite') return api.inviteUser(accountId, { name: draft.name.trim(), email, ...access }, key);
      if (target.kind === 'pending') return api.updateInvitationAccess(accountId, target.item.id, { version: target.item.version, ...access }, key);
      return api.updateMemberAccess(accountId, target.item.id, { version: target.item.version, ...access }, key);
    },
    onSuccess: () => onSaved(target.kind === 'invite' ? 'invite' : 'access'),
    onError: cause => setError(saveError(cause)),
    onSettled: () => { submitting.current = false; },
  });

  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);

  function requestClose() {
    if (submitting.current) return;
    if (!sameDraft(draft, initial) && !window.confirm('Descartar alterações?')) return;
    onClose();
  }

  // O listener dura o modal inteiro e lê o estado atualizado sem restaurar o foco a cada renderização.
  const latest = useRef({ permissionsOpen, requestClose });
  useLayoutEffect(() => { latest.current = { permissionsOpen, requestClose }; });
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    (modalRef.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? modalRef.current?.querySelector('button'))?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (latest.current.permissionsOpen) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        latest.current.requestClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const controls = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') ?? [])]
        .filter(element => element.getClientRects().length > 0);
      if (!controls.length) { event.preventDefault(); modalRef.current?.focus(); return; }
      const first = controls[0];
      const last = controls[controls.length - 1];
      const focus = document.activeElement;
      const focusOutside = !modalRef.current?.contains(focus);
      if (event.shiftKey && (focus === first || focusOutside)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (focus === last || focusOutside)) { event.preventDefault(); first.focus(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || !rows.length) return;
    setError(null);
    if (target.kind === 'invite' && (!draft.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError({ message: 'Informe nome e e-mail válidos.' });
      return;
    }
    if (target.kind !== 'member' && draft.companyIds.length === 0) {
      setError({ message: 'Selecione ao menos uma empresa.' });
      return;
    }
    submitting.current = true;
    save.mutate();
  }

  function closePermissions(next?: Selection) {
    if (next && sortByCatalog(next).join() !== sortByCatalog(draft.permissions).join()) update({ permissions: next });
    setPermissionsOpen(false);
    permissionsButton.current?.focus();
  }

  const locateMember = target.kind === 'invite' && error?.code === 'USER_ALREADY_LINKED';
  const reloadData = error?.status === 409 && !locateMember && error.code !== 'OWNER_PROTECTED';

  return <div className="modal-backdrop users-modal-backdrop" onMouseDown={event => {
    if (event.target === event.currentTarget && !permissionsOpen) requestClose();
  }}>
    <section ref={modalRef} className="users-modal" role="dialog" aria-modal="true" aria-labelledby="users-modal-title" tabIndex={-1}>
      <header>
        <div>
          <h2 id="users-modal-title">{target.kind === 'invite' ? 'Convidar usuário' : target.kind === 'pending' ? `Acesso do convite de ${draft.name}` : `Acesso de ${draft.name}`}</h2>
          <p>{target.kind === 'invite' ? 'A pessoa receberá um e-mail para criar ou acessar sua conta.' : target.kind === 'pending' ? 'Alterar as empresas gera um novo link de convite válido por 24 horas.' : 'Marque as empresas que esta pessoa poderá usar.'}</p>
        </div>
        <button type="button" onClick={requestClose} disabled={save.isPending} aria-label="Fechar"><X size={19} /></button>
      </header>
      <form onSubmit={submit} noValidate>
        <div className="users-modal__body">
          <fieldset className="users-modal__fields" disabled={save.isPending}>
            {target.kind === 'invite' ? <div className="users-fields">
              <label className="field"><span>Nome <b>*</b></span>
                <input data-initial-focus maxLength={200} value={draft.name} onChange={event => update({ name: event.target.value })} placeholder="Nome completo" />
              </label>
              <label className="field"><span>E-mail <b>*</b></span>
                <input type="email" maxLength={254} value={draft.email} onChange={event => update({ email: event.target.value })} placeholder="pessoa@exemplo.com" autoComplete="email" />
              </label>
            </div> : <p className="users-modal__email">{draft.email}</p>}
            <div className="users-fields users-access-fields">
              <CompanySelect rows={rows} selected={draft.companyIds} existing={target.kind === 'invite' ? [] : initial.companyIds} onChange={companyIds => update({ companyIds })} />
              <label className="field">
                <span id="role-label">Classificação</span>
                <select value={draft.roleLabel} aria-labelledby="role-label" aria-describedby="role-hint" onChange={event => {
                  const roleLabel = ROLE_LABELS.find(label => label === event.target.value);
                  if (roleLabel) update({ roleLabel });
                }}>
                  {ROLE_LABELS.map(label => <option key={label} value={label}>{companyRoleLabel(label)}</option>)}
                </select>
                <small id="role-hint" className="field-hint">Só identificação. Não concede acesso.</small>
              </label>
            </div>
            {target.kind === 'member' && draft.companyIds.length === 0 && <p className="users-modal__hint">Salvar sem empresas desativa o acesso nesta contratação.</p>}
          </fieldset>
          {error && <div ref={errorRef} tabIndex={-1} className="inline-error users-modal__error" role="alert">
            <span id="user-access-error">{error.message}</span>
            {locateMember && <button type="button" className="button button--secondary" onClick={() => onLocate(email)}>Localizar na lista</button>}
            {error.code === 'PERMISSION_DEPENDENCY_MISSING' && <button type="button" className="button button--secondary" onClick={() => setPermissionsOpen(true)}>Revisar permissões</button>}
            {reloadData && <button type="button" className="button button--secondary" onClick={onStale}>Recarregar dados</button>}
          </div>}
        </div>
        <footer className="users-modal__footer">
          <button className="button button--secondary" type="button" disabled={save.isPending} onClick={requestClose}>Cancelar</button>
          <div className="users-modal__permission-action">
            <button ref={permissionsButton} className="button button--secondary" type="button" aria-describedby="permissions-summary" disabled={save.isPending} onClick={() => setPermissionsOpen(true)}>Permissões de usuário</button>
            <span id="permissions-summary">{selectionSummary(draft.permissions)}</span>
          </div>
          <button className="button button--primary" type="submit" disabled={save.isPending || !rows.length} aria-describedby={error ? 'user-access-error' : undefined}>
            {save.isPending ? 'Salvando...' : target.kind === 'invite' ? 'Enviar convite' : 'Salvar acesso'}
          </button>
        </footer>
      </form>
      {permissionsOpen && <PermissionsDialog subject={draft.name.trim() || email} initial={draft.permissions}
        onApply={closePermissions} onCancel={closePermissions} />}
    </section>
  </div>;
}
