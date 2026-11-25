import type { LucideIcon } from 'lucide-react';
import { BriefcaseBusiness, Bot, Building2, Calculator, CalendarDays, ChartColumn, ClipboardList, FileText, FolderOpen, Hash, Landmark, ReceiptText, UserCog, UserRound, UserRoundPlus, UsersRound, Wallet } from 'lucide-react';
import { SCREENS, SCREEN_IDS, canOpenScreen, type PermissionKey, type ScreenGroup, type ScreenId, type ScreenViewer } from '@gestaonf/permissions';

export const NO_ACCESS_PATH = '/sem-acesso';

export const SCREEN_ICONS: Record<ScreenId, LucideIcon> = {
  sales: ReceiptText, finance: Wallet, crm: UserRound, agenda: CalendarDays, proposals: FileText, reports: ChartColumn,
  customers: UsersRound, services: ClipboardList, company: Building2, users: UserCog, 'fiscal-series': Hash, 'fiscal-tax': Calculator,
  nero: Bot, profile: UserRound,
};
export const SCREEN_GROUPS: Record<ScreenGroup, { label: string; icon: LucideIcon }> = {
  crm: { label: 'CRM', icon: BriefcaseBusiness }, records: { label: 'Cadastros', icon: FolderOpen }, fiscal: { label: 'Fiscal', icon: Landmark },
};
/** Ações rápidas (Spec 8.4). */
export const QUICK_ACTIONS = [
  { label: 'Nova venda de serviço', path: '/portal-de-servicos?novo=1', icon: ReceiptText, requires: 'sales.create' },
  { label: 'Nova proposta', path: '/propostas?novo=1', icon: FileText, requires: 'proposals.manage' },
  { label: 'Novo cliente', path: '/Clientes?novo=1', icon: UserRoundPlus, requires: 'customers.create' },
] as const satisfies readonly { label: string; path: string; icon: LucideIcon; requires: PermissionKey }[];

export type NavLeaf = { id: ScreenId; label: string; path: string; icon: LucideIcon };
export type NavGroup = { group: ScreenGroup; label: string; icon: LucideIcon; items: NavLeaf[] };
export const navLeaf = (id: ScreenId): NavLeaf => ({ id, label: SCREENS[id].label, path: SCREENS[id].path, icon: SCREEN_ICONS[id] });

/** Menu lateral na ordem da tabela, só com telas permitidas; grupos vazios não existem. */
export function menuEntries(viewer: ScreenViewer): (NavLeaf | NavGroup)[] {
  const entries: (NavLeaf | NavGroup)[] = [];
  for (const id of SCREEN_IDS) {
    const screen = SCREENS[id];
    if (!screen.menu || !canOpenScreen(viewer, id)) continue;
    if (!screen.group) { entries.push(navLeaf(id)); continue; }
    const group = entries.find((entry): entry is NavGroup => 'group' in entry && entry.group === screen.group);
    if (group) group.items.push(navLeaf(id)); else entries.push({ group: screen.group, ...SCREEN_GROUPS[screen.group], items: [navLeaf(id)] });
  }
  return entries;
}

/** Destino de quem não pode abrir a tela pedida: a primeira permitida, ou /sem-acesso (Spec 8.4 e 8.6). */
export function landingPath(viewer: ScreenViewer): string {
  const id = SCREEN_IDS.find((screen) => screen !== 'profile' && canOpenScreen(viewer, screen));
  return id ? SCREENS[id].path : NO_ACCESS_PATH;
}

const ALIASES: Record<string, ScreenId> = { '/serviço': 'services', '/nilo': 'nero' };
export function screenForPath(pathname: string): ScreenId | null {
  let decoded: string;
  try { decoded = decodeURI(pathname); } catch { decoded = pathname; }
  const path = decoded.replace(/\/+$/, '').toLocaleLowerCase('pt-BR');
  if (path.startsWith('/relatorios/')) return 'reports';
  return ALIASES[path] ?? SCREEN_IDS.find((id) => SCREENS[id].path.toLocaleLowerCase('pt-BR') === path) ?? null;
}
