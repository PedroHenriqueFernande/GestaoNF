import { SCREENS, canOpenScreen, type ScreenId, type ScreenViewer } from '@gestaonf/permissions';
import { reportTypes, type ReportType } from '../reports/reports.schemas.js';
import { reportFilename, reportPdfDefinitions } from '../reports/report-pdf-definitions.js';

export { reportFilename };

/** Vocabulário do modelo (ids em português) → tela da tabela única (Spec 8.4). */
export const destinations = {
  clientes: 'customers', servicos: 'services', portal_servicos: 'sales', financeiro: 'finance', relatorios: 'reports',
  fiscal_series: 'fiscal-series', fiscal_tributacao: 'fiscal-tax', empresa: 'company', crm: 'crm', agenda: 'agenda',
  propostas: 'proposals', nero: 'nero', usuarios: 'users', meu_perfil: 'profile',
} as const satisfies Record<string, ScreenId>;
export type Destination = keyof typeof destinations;
export const destinationIds = Object.keys(destinations) as [Destination, ...Destination[]];
export const destinationPath = (destination: Destination) => SCREENS[destinations[destination]].path;
export const destinationLabel = (destination: Destination) => SCREENS[destinations[destination]].label;
export const canOpenDestination = (viewer: ScreenViewer, destination: Destination) => canOpenScreen(viewer, destinations[destination]);
/** Nunca vazia: `meu_perfil` é de qualquer membro. */
export const allowedDestinations = (viewer: ScreenViewer) =>
  destinationIds.filter((destination) => canOpenDestination(viewer, destination)) as [Destination, ...Destination[]];
export const reportTitles = Object.fromEntries(reportTypes.map((type) => [type, reportPdfDefinitions[type].title])) as Record<ReportType, string>;

export type ActionKind = 'CREATE_CUSTOMER' | 'CREATE_SERVICE';
export type ActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'EXPIRED' | 'FAILED';
export type TextBlock = { type: 'text'; text: string };
export type NoticeBlock = { type: 'notice'; level: 'info' | 'error'; text: string };
export type NavigateBlock = { type: 'navigate'; label: string; to: string };
export type DownloadBlock = { type: 'download'; label: string; url: string; filename: string };
export type ActionBlock = {
  type: 'action'; actionId: string; kind: ActionKind; status: ActionStatus;
  summary: { label: string; value: string }[]; expiresAt: string; resultTo?: string; errorMessage?: string;
};
export type SupportBlock = TextBlock | NoticeBlock | NavigateBlock | DownloadBlock | ActionBlock;

export const navigateBlock = (destination: Destination): NavigateBlock =>
  ({ type: 'navigate', label: `Abrir ${destinationLabel(destination)}`, to: destinationPath(destination) });

export const saleBlock = (sale: { id: string; orderCode: string; customerName: string }, companyId: string): NavigateBlock =>
  ({ type: 'navigate', label: `Abrir pedido #${sale.orderCode} — ${sale.customerName}`, to: `/portal-de-servicos?editar=${sale.id}&empresa=${companyId}` });

export function downloadBlock(type: ReportType, from: string | null, to: string | null): DownloadBlock {
  const query = from && to ? `?${new URLSearchParams({ from, to })}` : '';
  return { type: 'download', label: `Baixar PDF — ${reportTitles[type]}`, url: `/reports/${type}/pdf${query}`, filename: reportFilename(type, from, to) };
}

const routeValues = new Set<string>(destinationIds.map(destinationPath));
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const saleLink = new RegExp(`^/portal-de-servicos\\?editar=${uuid}&empresa=${uuid}$`, 'i');
const downloadLink = new RegExp(`^/reports/(${reportTypes.join('|')})/pdf(\\?from=\\d{4}-\\d{2}-\\d{2}&to=\\d{4}-\\d{2}-\\d{2})?$`);

export function isSafeBlock(block: SupportBlock): boolean {
  if (block.type === 'navigate') return routeValues.has(block.to) || saleLink.test(block.to);
  if (block.type === 'download') return downloadLink.test(block.url);
  return true;
}

export function withExpiredActions(blocks: SupportBlock[], now = new Date()): SupportBlock[] {
  return blocks.map((block) => block.type === 'action' && block.status === 'PENDING' && Date.parse(block.expiresAt) <= now.getTime()
    ? { ...block, status: 'EXPIRED' as const }
    : block);
}
