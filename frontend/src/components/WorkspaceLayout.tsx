import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Bot, BriefcaseBusiness, Building2, CalendarDays, Calculator, ChartColumn, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, FileText, FolderOpen, Hash, Landmark, LogOut, Menu, Plus, ReceiptText, Target, UserCog, UserRound, UserRoundPlus, UsersRound, Wallet, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Company, User } from '../api/client';
import { CompanyPicker } from './CompanyPicker';
import { UserAvatar } from './UserAvatar';
import './workspace-sidebar.css';

const MOBILE_QUERY = '(max-width: 959px)';
const COLLAPSED_KEY = 'gestaonf.sidebarCollapsed';

type SectionId = 'profile' | 'customers' | 'services' | 'company' | 'sales' | 'finance' | 'reports' | 'crm' | 'agenda' | 'proposals' | 'nilo' | 'users' | 'fiscal-series' | 'fiscal-tax';
type GroupId = 'crm' | 'records' | 'fiscal';
type NavLeaf = { id: SectionId; label: string; path: string; icon: LucideIcon };
type NavGroup = { group: GroupId; label: string; icon: LucideIcon; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const leaf = {
  sales: { id: 'sales', label: 'Portal de Serviços', path: '/portal-de-servicos', icon: ReceiptText },
  finance: { id: 'finance', label: 'Financeiro', path: '/financeiro', icon: Wallet },
  reports: { id: 'reports', label: 'Relatórios', path: '/relatorios', icon: ChartColumn },
  crm: { id: 'crm', label: 'Leads e oportunidades', path: '/crm', icon: Target },
  agenda: { id: 'agenda', label: 'Agenda', path: '/agenda', icon: CalendarDays },
  proposals: { id: 'proposals', label: 'Propostas', path: '/propostas', icon: FileText },
  customers: { id: 'customers', label: 'Clientes', path: '/Clientes', icon: UsersRound },
  services: { id: 'services', label: 'Serviços', path: '/serviço', icon: ClipboardList },
  users: { id: 'users', label: 'Usuários', path: '/usuarios', icon: UserCog },
  company: { id: 'company', label: 'Empresa', path: '/empresa', icon: Building2 },
  fiscalSeries: { id: 'fiscal-series', label: 'Séries e numeração', path: '/fiscal/series', icon: Hash },
  fiscalTax: { id: 'fiscal-tax', label: 'Controle de tributação', path: '/fiscal/tributacao', icon: Calculator },
} satisfies Record<string, NavLeaf>;

const quickActions = [
  { label: 'Nova venda de serviço', path: '/portal-de-servicos?novo=1', icon: ReceiptText },
  { label: 'Nova proposta', path: '/propostas?novo=1', icon: FileText },
  { label: 'Novo cliente', path: '/Clientes?novo=1', icon: UserRoundPlus },
] as const;

function sectionFor(pathname: string): SectionId {
  if (pathname === '/meu-perfil') return 'profile';
  if (pathname === '/fiscal/series') return 'fiscal-series';
  if (pathname === '/fiscal/tributacao') return 'fiscal-tax';
  if (pathname === '/empresa') return 'company';
  if (pathname === '/usuarios') return 'users';
  if (pathname === '/serviço' || pathname === '/servicos') return 'services';
  if (pathname === '/portal-de-servicos') return 'sales';
  if (pathname === '/financeiro') return 'finance';
  if (pathname === '/relatorios' || pathname.startsWith('/relatorios/')) return 'reports';
  if (pathname === '/crm') return 'crm';
  if (pathname === '/agenda') return 'agenda';
  if (pathname === '/propostas') return 'proposals';
  if (pathname === '/nero' || pathname === '/nilo') return 'nilo';
  return 'customers';
}

function readCollapsed() {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

export function WorkspaceLayout({ user, companies, companyId, onCompanyChange, onLogout, loggingOut, onboarding = false, className = '', children }: {
  user: User;
  companies?: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
  onLogout: () => void;
  loggingOut: boolean;
  onboarding?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const quickRef = useRef<HTMLDivElement>(null);
  const quickButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = decodeURIComponent(location.pathname).toLocaleLowerCase('pt-BR');
  const section = sectionFor(pathname);
  const company = companies?.find((item) => item.id === companyId);
  const isOwner = companies?.some((item) => item.role === 'OWNER') ?? false;
  const isCollapsed = collapsed && !mobile;

  const entries: NavEntry[] = [
    leaf.sales,
    leaf.finance,
    { group: 'crm', label: 'CRM', icon: BriefcaseBusiness, items: [leaf.crm, leaf.agenda, leaf.proposals] },
    leaf.reports,
    { group: 'records', label: 'Cadastros', icon: FolderOpen, items: [leaf.customers, leaf.services, ...(isOwner ? [leaf.users] : [])] },
    { group: 'fiscal', label: 'Fiscal', icon: Landmark, items: [leaf.company, leaf.fiscalSeries, leaf.fiscalTax] },
  ];
  const activeGroup = entries.find((entry): entry is NavGroup => 'group' in entry && entry.items.some((item) => item.id === section))?.group;
  const [openGroups, setOpenGroups] = useState<GroupId[]>(() => onboarding ? ['fiscal'] : activeGroup ? [activeGroup] : []);

  useEffect(() => {
    if (activeGroup) setOpenGroups((current) => current.includes(activeGroup) ? current : [...current, activeGroup]);
  }, [activeGroup]);

  useEffect(() => {
    try { window.localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0'); } catch { /* preferência apenas local */ }
  }, [collapsed]);

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => { setMobile(query.matches); setMobileOpen(false); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobile || !mobileOpen) return;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const menuButton = menuRef.current;
    sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMobileOpen(false); return; }
      if (event.key !== 'Tab') return;
      const elements = Array.from(sidebarRef.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled])') ?? [])
        .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
      if (!elements?.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKeyDown);
      menuButton?.focus();
    };
  }, [mobile, mobileOpen]);

  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event: Event) => {
      if (!profileRef.current?.contains(event.target as Node)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      profileButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [profileOpen]);

  useEffect(() => {
    if (!quickOpen) return;
    const closeOutside = (event: Event) => {
      if (!quickRef.current?.contains(event.target as Node)) setQuickOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setQuickOpen(false);
      quickButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [quickOpen]);

  useEffect(() => { if (isCollapsed) setQuickOpen(false); }, [isCollapsed]);

  const closeNavigation = () => { setMobileOpen(false); setQuickOpen(false); };

  function toggleGroup(group: GroupId) {
    if (isCollapsed) {
      setCollapsed(false);
      setOpenGroups((current) => current.includes(group) ? current : [...current, group]);
      return;
    }
    setOpenGroups((current) => current.includes(group) ? current.filter((item) => item !== group) : [...current, group]);
  }

  function renderLeaf(item: NavLeaf, variant: 'top' | 'sub') {
    const Icon = item.icon;
    const base = variant === 'top' ? 'workspace-nav-link' : 'workspace-subnav__link';
    const content = <>
      <Icon size={variant === 'top' ? 21 : 19} strokeWidth={1.7} aria-hidden="true" />
      <span className={variant === 'top' ? 'workspace-nav-link__label' : undefined}>{item.label}</span>
    </>;
    if (onboarding && item.id !== 'company') {
      return <button key={item.id} type="button" className={`${base} ${base}--disabled`} disabled title="Cadastre uma empresa para liberar esta opção">{content}</button>;
    }
    const active = section === item.id;
    return <Link key={item.id} to={item.path} state={{ workspaceNav: true }} className={`${base}${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined} aria-label={item.label} title={isCollapsed ? item.label : undefined} onClick={closeNavigation}>{content}</Link>;
  }

  return <div className={`app-shell client-workspace workspace-layout${mobileOpen ? ' workspace-layout--menu-open' : ''}${isCollapsed ? ' workspace-layout--collapsed' : ''} ${className}`}>
    <a className="workspace-skip-link" href="#workspace-main">Ir para o conteúdo</a>
    {mobileOpen && <button type="button" className="workspace-menu-backdrop" aria-label="Fechar menu de navegação" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-sidebar" ref={sidebarRef} className="workspace-sidebar" role={mobile && mobileOpen ? 'dialog' : undefined} aria-modal={mobile && mobileOpen ? true : undefined} aria-label="Menu principal" aria-hidden={mobile && !mobileOpen ? true : undefined} inert={mobile && !mobileOpen}>
      <button type="button" className="workspace-sidebar__collapse" onClick={() => setCollapsed((value) => !value)} aria-label={isCollapsed ? 'Expandir menu' : 'Recolher menu'} title={isCollapsed ? 'Expandir menu' : 'Recolher menu'}>
        {isCollapsed ? <ChevronRight size={16} strokeWidth={2.4} /> : <ChevronLeft size={16} strokeWidth={2.4} />}
      </button>
      <div className="workspace-sidebar__scroll">
        <div className="workspace-sidebar__brand">
          <Link to={onboarding ? '/empresa' : '/Clientes'} className="workspace-sidebar__brand-link" aria-label="GestãoNF" onClick={closeNavigation}>
            <img className="workspace-sidebar__logo" src="/gestaonf-logo.svg" alt="GestãoNF" width="182" height="38" />
            <img className="workspace-sidebar__mark" src="/favicon.svg" alt="" width="40" height="37" />
          </Link>
          <button type="button" className="workspace-sidebar__close" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}><X size={20} /></button>
        </div>

        <div ref={quickRef} className="workspace-cta">
          <div className={`workspace-cta__group${onboarding ? ' is-disabled' : ''}`}>
            {onboarding
              ? <button type="button" className="workspace-cta__main" disabled title="Cadastre uma empresa para liberar esta opção"><Plus size={19} strokeWidth={2.4} aria-hidden="true" /><span className="workspace-cta__label">Nova venda</span></button>
              : <Link to="/portal-de-servicos?novo=1" className="workspace-cta__main" title={isCollapsed ? 'Nova venda' : undefined} aria-label="Nova venda" onClick={closeNavigation}><Plus size={19} strokeWidth={2.4} aria-hidden="true" /><span className="workspace-cta__label">Nova venda</span></Link>}
            <span className="workspace-cta__divider" aria-hidden="true" />
            <button ref={quickButtonRef} type="button" className="workspace-cta__more" aria-label="Mais ações rápidas" aria-expanded={quickOpen} aria-controls="workspace-quick-actions" disabled={onboarding} onClick={() => setQuickOpen((value) => !value)}>
              <ChevronDown size={19} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
          <div id="workspace-quick-actions" className={`workspace-cta__menu${quickOpen ? ' is-open' : ''}`} inert={!quickOpen}>
            {quickActions.map(({ label, path, icon: Icon }) => <Link key={path} to={path} onClick={closeNavigation}><Icon size={17} aria-hidden="true" />{label}</Link>)}
          </div>
        </div>

        <nav className="workspace-sidebar__navigation" aria-label="Módulos">
          {entries.map((entry) => {
            if (!('group' in entry)) return renderLeaf(entry, 'top');
            const Icon = entry.icon;
            const open = openGroups.includes(entry.group) && !isCollapsed;
            const hasActive = entry.group === activeGroup;
            const listId = `workspace-subnav-${entry.group}`;
            return <div key={entry.group} className="workspace-nav-group">
              <button type="button" className={`workspace-nav-link${hasActive ? ' has-active' : ''}`} aria-expanded={open} aria-controls={listId} title={isCollapsed ? entry.label : undefined} onClick={() => toggleGroup(entry.group)}>
                <Icon size={21} strokeWidth={1.7} aria-hidden="true" />
                <span className="workspace-nav-link__label">{entry.label}</span>
                <ChevronDown className="workspace-nav-link__chevron" size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <div id={listId} className={`workspace-subnav${open ? ' is-open' : ''}`} inert={!open}>
                <div className="workspace-subnav__clip"><div className="workspace-subnav__list">{entry.items.map((item) => renderLeaf(item, 'sub'))}</div></div>
              </div>
            </div>;
          })}
        </nav>

        <div className="workspace-sidebar__footer">
          {onboarding
            ? <button type="button" className="workspace-nero workspace-nero--disabled" disabled title="Cadastre uma empresa para liberar esta opção"><span className="workspace-nero__icon"><Bot size={19} aria-hidden="true" /></span><span className="workspace-nero__text"><strong>Nero</strong><small>Seu secretário no WhatsApp</small></span></button>
            : <Link to="/nero" className={`workspace-nero${section === 'nilo' ? ' is-active' : ''}`} aria-current={section === 'nilo' ? 'page' : undefined} aria-label="Nero" title={isCollapsed ? 'Nero' : undefined} onClick={closeNavigation}><span className="workspace-nero__icon"><Bot size={19} aria-hidden="true" /></span><span className="workspace-nero__text"><strong>Nero</strong><small>Seu secretário no WhatsApp</small></span></Link>}
        </div>
      </div>
    </aside>
    <div className="workspace-content" inert={mobile && mobileOpen}>
      <header className="topbar"><div className="topbar__inner">
        <button ref={menuRef} type="button" className="icon-button workspace-menu-toggle" onClick={() => setMobileOpen((value) => !value)} aria-label="Abrir menu de navegação" aria-controls="workspace-sidebar" aria-expanded={mobileOpen}>
          <Menu size={20} />
        </button>
        <div className="topbar__right">
          <CompanyPicker companies={companies} companyId={companyId} onCompanyChange={onCompanyChange} />
          <div className="topbar__divider" />
          <UserAvatar user={user} className="user-badge" />
          <div className="user-info"><strong>{user.name}</strong><span>{onboarding ? 'Cadastro pendente' : company?.role === 'OWNER' ? 'Proprietário' : company?.role ?? 'Usuário'}</span></div>
          <div ref={profileRef} className="topbar__profile-menu">
            <button ref={profileButtonRef} type="button" className="icon-button topbar__profile-toggle" title="Opções do perfil" aria-label="Opções do perfil" aria-controls={profileOpen ? 'workspace-profile-options' : undefined} aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}><ChevronDown size={18} strokeWidth={2.2} /></button>
            {profileOpen && <div id="workspace-profile-options" className="topbar__profile-options"><Link to="/meu-perfil" aria-current={section === 'profile' ? 'page' : undefined} onClick={() => setProfileOpen(false)}><UserRound size={16} aria-hidden="true" />Meu perfil</Link><button type="button" onClick={() => { setProfileOpen(false); onLogout(); }} disabled={loggingOut}><LogOut size={16} aria-hidden="true" />Sair</button></div>}
          </div>
        </div>
      </div></header>
      {children}
    </div>
  </div>;
}
