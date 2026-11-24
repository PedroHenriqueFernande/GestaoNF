import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ROLE_LABELS, selectionSummary, sortByCatalog, type RoleLabel, type Selection } from '@gestaonf/permissions';
import { Check, X } from 'lucide-react';
import { api, ApiError, type ManagedInvitation, type ManagedMember, type UserCapacity } from '../../api/client';
import { companyRoleLabel } from '../../utils/format';
import { PermissionsDialog } from './PermissionsDialog';

export type AccessTarget =
  | { kind: 'invite'; defaultCompanyIds: string[] }
  | { kind: 'member'; item: ManagedMember }
  | { kind: 'pending'; item: ManagedInvitation };

type Draft = { name: string; email: string; companyIds: string[]; roleLabel: RoleLabel; permissions: Selection };
type SaveError = { message: string; code?: string; status?: number };

function initialDraft(target: AccessTarget): Draft {
  if (target.kind === 'invite') {
    return { name: '', email: '', companyIds: target.defaultCompanyIds, roleLabel: 'COLLABORATOR', permissions: new Set() };
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

export function UserAccessModal({ target, accountId, rows, onClose, onSaved, onStale, onLocate }: {
  target: AccessTarget;
  accountId: string;
  rows: UserCapacity[];
  onClose: () => void;
  onSaved: (kind: 'invite' | 'access') => void;
  onStale: () => void;
  onLocate: (email: string) => void;
}) {
  const [initial] = useState(() => initialDraft(target));
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
            <label className="field users-modal__classification">
              <span id="role-label">Classificação</span>
              <select value={draft.roleLabel} aria-labelledby="role-label" aria-describedby="role-hint" onChange={event => {
                const roleLabel = ROLE_LABELS.find(label => label === event.target.value);
                if (roleLabel) update({ roleLabel });
              }}>
                {ROLE_LABELS.map(label => <option key={label} value={label}>{companyRoleLabel(label)}</option>)}
              </select>
              <small id="role-hint" className="field-hint">Só identificação. Não concede acesso.</small>
            </label>
            <CompanyChoices rows={rows} selected={draft.companyIds} existing={target.kind === 'invite' ? [] : initial.companyIds} onChange={companyIds => update({ companyIds })} />
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
      {permissionsOpen && <PermissionsDialog subject={draft.name.trim() || email || 'Novo usuário'} initial={draft.permissions}
        onApply={closePermissions} onCancel={closePermissions} />}
    </section>
  </div>;
}
