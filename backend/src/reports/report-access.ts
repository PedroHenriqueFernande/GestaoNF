import { REPORT_PERMISSIONS, reportExportPermission, type PermissionKey } from '@gestaonf/permissions';
import { requirePermission, type Actor } from '../permissions/actor.js';
import type { ReportType } from './reports.schemas.js';

/** Força em tempo de compilação que o pacote cubra todo tipo do backend. */
const MODULE_PERMISSION: Readonly<Record<ReportType, PermissionKey>> = REPORT_PERMISSIONS;
export { REPORT_OPTION_PERMISSION } from '@gestaonf/permissions';

/** Ver um relatório: tela de Relatórios + módulo de origem (Spec 4.8). Única regra, usada por HTTP, Nero e suporte. */
export function requireReportView(actor: Actor, type: ReportType, entry: string) {
  requirePermission(actor, 'reports.access', entry);
  requirePermission(actor, MODULE_PERMISSION[type], entry);
}

/** Exportar (CSV/PDF): ver + chave de exportação do tipo (D18). */
export function requireReportExport(actor: Actor, type: ReportType, entry: string) {
  requireReportView(actor, type, entry);
  requirePermission(actor, reportExportPermission(type), entry);
}
