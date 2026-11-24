import type { PermissionKey } from './catalog.js';

export type ScreenRequirement = PermissionKey | 'ACCOUNT_OWNER' | 'ANY_MEMBER';
export type ScreenGroup = 'crm' | 'records' | 'fiscal';
type ScreenDefinition = Readonly<{ path: string; label: string; group: ScreenGroup | null; menu: boolean; requires: ScreenRequirement }>;

/**
 * Tabela única de telas (Spec 8.4): menu, SessionGate, rota coringa, ações rápidas e `abrir_tela` do suporte.
 * A ordem é a do menu lateral. `group: null` com `menu: true` é item de primeiro nível; `menu: false` fica fora do menu lateral.
 */
export const SCREENS = {
  sales: { path: '/portal-de-servicos', label: 'Portal de Serviços', group: null, menu: true, requires: 'sales.access' },
  finance: { path: '/financeiro', label: 'Financeiro', group: null, menu: true, requires: 'finance.access' },
  crm: { path: '/crm', label: 'Leads e oportunidades', group: 'crm', menu: true, requires: 'crm.access' },
  agenda: { path: '/agenda', label: 'Agenda', group: 'crm', menu: true, requires: 'agenda.access' },
  proposals: { path: '/propostas', label: 'Propostas', group: 'crm', menu: true, requires: 'proposals.access' },
  reports: { path: '/relatorios', label: 'Relatórios', group: null, menu: true, requires: 'reports.access' },
  customers: { path: '/Clientes', label: 'Clientes', group: 'records', menu: true, requires: 'customers.access' },
  services: { path: '/servicos', label: 'Serviços', group: 'records', menu: true, requires: 'services.access' },
  company: { path: '/empresa', label: 'Empresa', group: 'records', menu: true, requires: 'company.access' },
  users: { path: '/usuarios', label: 'Usuários', group: 'records', menu: true, requires: 'ACCOUNT_OWNER' },
  'fiscal-series': { path: '/fiscal/series', label: 'Séries e numeração', group: 'fiscal', menu: true, requires: 'fiscal.series' },
  'fiscal-tax': { path: '/fiscal/tributacao', label: 'Controle de tributação', group: 'fiscal', menu: true, requires: 'fiscal.tax' },
  nero: { path: '/nero', label: 'Nero', group: null, menu: false, requires: 'nero.use' },
  profile: { path: '/meu-perfil', label: 'Meu perfil', group: null, menu: false, requires: 'ANY_MEMBER' },
} as const satisfies Record<string, ScreenDefinition>;

export type ScreenId = keyof typeof SCREENS;
export const SCREEN_IDS = Object.keys(SCREENS) as ScreenId[];
export type ScreenViewer = Readonly<{ accountOwner: boolean; permissions: ReadonlySet<PermissionKey> }>;

export function canOpenScreen(viewer: ScreenViewer, id: ScreenId): boolean {
  const requires: ScreenRequirement = SCREENS[id].requires;
  if (requires === 'ANY_MEMBER') return true;
  if (requires === 'ACCOUNT_OWNER') return viewer.accountOwner;
  return viewer.permissions.has(requires);
}
