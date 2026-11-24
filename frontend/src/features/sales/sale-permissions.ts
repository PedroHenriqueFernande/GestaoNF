import type { SaleStatus } from '../../api/client';
import type { PermissionView } from '../permissions/usePermissions';

export type SaleActions = Readonly<{ edit: boolean; remove: boolean }>;

/** Regra única das ações da venda na interface (D15). O servidor decide do mesmo jeito (D14). */
export function saleActions(status: SaleStatus, access: Pick<PermissionView, 'can'>): SaleActions {
  if (status === 'CANCELED') return { edit: false, remove: false };
  return { edit: access.can(status === 'DRAFT' ? 'sales.create' : 'sales.edit'), remove: access.can('sales.delete') };
}
