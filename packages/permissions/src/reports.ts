import type { PermissionKey } from './catalog.js';

/** Permissão do módulo de origem exigida por tipo de relatório (Spec 4.8). Fonte única para backend e frontend. */
export const REPORT_PERMISSIONS = {
  'closed-services': 'sales.access',
  'service-receipts': 'finance.access',
  'lead-entries': 'crm.access',
  'loss-rate': 'crm.access',
  'disqualification-rate': 'crm.access',
  meetings: 'agenda.access',
  customers: 'customers.access',
  'service-catalog': 'services.access',
} as const satisfies Record<string, PermissionKey>;
export type ReportPermissionType = keyof typeof REPORT_PERMISSIONS;

/** O tipo `customers` exporta com `customers.export`; os demais com `reports.export` (D18). */
export const reportExportPermission = (type: ReportPermissionType): PermissionKey => type === 'customers' ? 'customers.export' : 'reports.export';

/** Permissão exigida para listar as opções de cada filtro de relatório. Fonte única para backend e frontend. */
export const REPORT_OPTION_PERMISSION = { customerId: 'customers.access', serviceId: 'services.access', assignedUserId: 'crm.access' } as const satisfies Record<string, PermissionKey>;
