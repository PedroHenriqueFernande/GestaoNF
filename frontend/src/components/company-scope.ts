import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Company, CompanyScopeParam, User } from '../api/client';

/** Visão múltipla do Portal de Serviços, por aba. A empresa ativa (gestaonf.companyId) continua com cada página. */
const VIEW_KEY = 'gestaonf.companyView';
type StoredView = { userId: string; mode: 'all' } | { userId: string; mode: 'selected'; ids: string[] };
export type MultipleView = { mode: 'all' | 'selected'; ids: string[]; param: CompanyScopeParam; scopeKey: string };
export type CompanyScope = { multiple: MultipleView | null; selectAll: () => void; selectMany: (ids: string[]) => void; clear: () => void };

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const readRaw = () => sessionStorage.getItem(VIEW_KEY);
function write(view: StoredView | null) {
  if (view) sessionStorage.setItem(VIEW_KEY, JSON.stringify(view)); else sessionStorage.removeItem(VIEW_KEY);
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

export function useCompanyScope(user: User, companies: Company[] | undefined): CompanyScope {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  const multiple = useMemo<MultipleView | null>(() => {
    const stored = parse(raw);
    // Visão de outro usuário na mesma aba (logout/login) é ignorada.
    if (!stored || stored.userId !== user.id || !companies) return null;
    const available = new Set(companies.map(c => c.id));
    const ids = (stored.mode === 'all' ? [...available] : stored.ids.filter(id => available.has(id))).sort();
    if (ids.length < 2) return null;
    return stored.mode === 'all'
      ? { mode: 'all', ids, param: { companies: 'all' }, scopeKey: 'all' }
      : { mode: 'selected', ids, param: { companyIds: ids.join(',') }, scopeKey: ids.join(',') };
  }, [raw, user.id, companies]);
  const selectAll = useCallback(() => write({ userId: user.id, mode: 'all' }), [user.id]);
  const selectMany = useCallback((ids: string[]) => { if (ids.length >= 2) write({ userId: user.id, mode: 'selected', ids: [...new Set(ids)].sort() }); }, [user.id]);
  const clear = useCallback(() => write(null), []);
  return { multiple, selectAll, selectMany, clear };
}
