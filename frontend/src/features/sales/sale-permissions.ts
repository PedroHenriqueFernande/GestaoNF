import { canOpenScreen } from '@gestaonf/permissions';
import type { SaleStatus } from '../../api/client';
import type { PermissionView } from '../permissions/usePermissions';

export type SaleActions = Readonly<{ edit: boolean; remove: boolean; finance: boolean }>;

export const noSaleActions: SaleActions = { edit: false, remove: false, finance: false };

/** Regra única das ações da venda na interface (D15). O servidor decide do mesmo jeito (D14). */
export function saleActions(status: SaleStatus, access: Pick<PermissionView, 'can' | 'viewer'>): SaleActions {
  if (status === 'CANCELED') return noSaleActions;
  return {
    edit: access.can(status === 'DRAFT' ? 'sales.create' : 'sales.edit'),
    remove: access.can('sales.delete'),
    // O Financeiro só lista parcelas de vendas confirmadas.
    finance: status === 'CONFIRMED' && canOpenScreen(access.viewer, 'finance'),
  };
}

/** Abre o Financeiro na empresa da venda, filtrado pelo pedido (lido uma vez pelo FinancePage). */
export function saleFinancePath(orderCode: string): string {
  return `/financeiro?pedido=${encodeURIComponent(orderCode)}`;
}
