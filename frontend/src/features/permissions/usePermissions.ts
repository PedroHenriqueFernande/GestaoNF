import { useQuery } from '@tanstack/react-query';
import { canOpenScreen, type PermissionKey, type ScreenViewer } from '@gestaonf/permissions';
import { api, type Company } from '../../api/client';

export type PermissionView = Readonly<{
  accountOwner: boolean;
  viewer: ScreenViewer;
  can: (key: PermissionKey) => boolean;
  /** Verdadeiro só se todas as empresas informadas têm a chave (visão combinada). */
  canInAll: (key: PermissionKey, companyIds: readonly string[]) => boolean;
}>;

/** Permissões efetivas de uma empresa, derivadas de ['companies'] (Spec 8.4). Sem estado próprio. */
export function permissionView(companies: readonly Company[] | undefined, companyId: string | undefined): PermissionView {
  const company = companies?.find((item) => item.id === companyId);
  const viewer: ScreenViewer = { accountOwner: company?.accountOwner ?? false, permissions: new Set(company?.permissions ?? []) };
  return {
    accountOwner: viewer.accountOwner, viewer,
    can: (key) => viewer.permissions.has(key),
    canInAll: (key, ids) => ids.length > 0 && ids.every((id) => companies?.find((item) => item.id === id)?.permissions.includes(key) ?? false),
  };
}

export function usePermissions(companyId: string | undefined): PermissionView {
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  return permissionView(companies.data, companyId);
}

/** Empresa ativa guardada na aba, se ainda pertence à lista; senão a primeira (mesma regra das páginas). */
export function storedCompanyId(companies: readonly Company[]): string {
  const stored = sessionStorage.getItem('gestaonf.companyId');
  return companies.some((item) => item.id === stored) ? stored! : companies[0]?.id ?? '';
}

const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

/** Um link de revisão pode escolher outra empresa vinculada que permita abrir Vendas. */
export function salesReviewTarget(params: URLSearchParams, companies: readonly Company[] | undefined, activeCompanyId?: string) {
  const id = params.get('editar');
  const companyId = params.get('empresa') ?? activeCompanyId;
  if (!id || !UUID.test(id) || !companyId || !canOpenScreen(permissionView(companies, companyId).viewer, 'sales')) return null;
  return { id, companyId };
}
