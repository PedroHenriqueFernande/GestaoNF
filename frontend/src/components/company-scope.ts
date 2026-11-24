import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { PermissionKey } from '@gestaonf/permissions';
import { ApiError } from '../api/client';
import type { Company, CompanyScopeParam, User } from '../api/client';
import { permissionView } from '../features/permissions/usePermissions';

/** Portal e CRM têm visões próprias por aba. Agenda e Propostas compartilham a visão do CRM. */
const VIEW_KEYS = { sales: 'gestaonf.companyView', crm: 'gestaonf.companyView.crm' } as const;
type ScopeArea = keyof typeof VIEW_KEYS;
type StoredView = { userId: string; mode: 'all' } | { userId: string; mode: 'selected'; ids: string[] };
export type MultipleView = { mode: 'all' | 'selected'; ids: string[]; param: CompanyScopeParam; scopeKey: string };
export type CompanyScope = { multiple: MultipleView | null; eligibleIds: string[]; selectAll: () => void; selectMany: (ids: string[]) => void; clear: () => void };

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function write(key: string, view: StoredView | null) {
  if (view) sessionStorage.setItem(key, JSON.stringify(view)); else sessionStorage.removeItem(key);
  listeners.forEach(listener => listener());
}
function parse(raw: string | null): StoredView | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredView> & { ids?: unknown };
    if (typeof value.userId !== 'string') return null;
    if (value.mode === 'all') return { userId: value.userId, mode: 'all' };
    if (value.mode === 'selected' && Array.isArray(value.ids) && value.ids.every(id => typeof id === 'string')) return { userId: value.userId, mode: 'selected', ids: value.ids };
  } catch { /* JSON inválido conta como visão ausente */ }
  return null;
}

export function useCompanyScope(user: User, companies: Company[] | undefined, area: ScopeArea, permission: PermissionKey): CompanyScope {
  const key = VIEW_KEYS[area];
  const raw = useSyncExternalStore(subscribe, () => sessionStorage.getItem(key), () => null);
  const eligibleIds = useMemo(() => (companies ?? []).filter(company => permissionView(companies, company.id).can(permission)).map(company => company.id).sort(), [companies, permission]);
  const multiple = useMemo<MultipleView | null>(() => {
    const stored = parse(raw);
    // Visão de outro usuário na mesma aba (logout/login) é ignorada.
    if (!stored || stored.userId !== user.id) return null;
    const ids = stored.mode === 'all' ? eligibleIds : eligibleIds.filter(id => stored.ids.includes(id));
    if (ids.length < 2) return null;
    return stored.mode === 'all'
      ? { mode: 'all', ids, param: { companies: 'all' }, scopeKey: `all:${ids.join(',')}` }
      : { mode: 'selected', ids, param: { companyIds: ids.join(',') }, scopeKey: ids.join(',') };
  }, [raw, user.id, eligibleIds]);
  const selectAll = useCallback(() => { if (eligibleIds.length >= 2) write(key, { userId: user.id, mode: 'all' }); }, [key, user.id, eligibleIds]);
  const selectMany = useCallback((ids: string[]) => {
    const eligible = eligibleIds.filter(id => ids.includes(id));
    if (eligible.length >= 2) write(key, { userId: user.id, mode: 'selected', ids: eligible });
  }, [key, user.id, eligibleIds]);
  const clear = useCallback(() => write(key, null), [key]);
  return { multiple, eligibleIds, selectAll, selectMany, clear };
}

export function isOverviewForbidden(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 403;
}

export function useOverviewFallback(multiple: MultipleView | null, clear: () => void, error: unknown, notify: (message: string) => void) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!multiple || !isOverviewForbidden(error)) return;
    clear();
    // O QueryClient já recarrega os dois erros de permissão padronizados.
    if (error.code !== 'PERMISSION_DENIED' && error.code !== 'ACCOUNT_OWNER_REQUIRED') {
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
    }
    notify('Algumas empresas não estão mais disponíveis. Mostrando uma empresa.');
  }, [multiple, clear, error, notify, queryClient]);
}
