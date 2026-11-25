import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { Bot, ChevronDown, ChevronLeft, ChevronRight, Menu, Plus, X } from 'lucide-react';
import { canOpenScreen, type ScreenGroup, type ScreenViewer } from '@gestaonf/permissions';
import type { Company, User } from '../api/client';
import { CompanyPicker } from './CompanyPicker';
import type { CompanyScope } from './company-scope';
import { UserAvatar } from './UserAvatar';
import { UserMenu } from './UserMenu';
import { useDropdown } from './useDropdown';
import { companyRoleLabel } from '../utils/format';
import { landingPath, menuEntries, QUICK_ACTIONS, screenForPath, type NavGroup, type NavLeaf } from '../features/permissions/screens';
import { permissionView } from '../features/permissions/usePermissions';
import { SupportWidget } from '../features/support/SupportWidget';
import './dropdown.css';
import './workspace-sidebar.css';
import './workspace-header.css';

const MOBILE_QUERY = '(max-width: 959px)';
const COLLAPSED_KEY = 'gestaonf.sidebarCollapsed';

function readCollapsed() {
  try { return window.localStorage.getItem(COLLAPSED_KEY) === '1'; } catch { return false; }
}

export function WorkspaceLayout({ user, companies, companyId, onCompanyChange, allowMultiple, scope, onLogout, loggingOut, onboarding = false, className = '', children }: {
  user: User;
  companies?: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
  /** Habilita a seleção combinada do módulo no seletor de empresas. */
  allowMultiple?: boolean;
  scope?: CompanyScope;
  onLogout: () => void;
  loggingOut: boolean;
  onboarding?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const location = useLocation();
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const quick = useDropdown();
  const company = companies?.find((item) => item.id === companyId);
  const access = permissionView(companies, companyId);
  const section = screenForPath(location.pathname);
  const navigate = useNavigate();
  /** Troca pelo seletor: se a tela atual não abre na empresa escolhida, grava a escolha e navega no mesmo evento, sem entregar a troca à página. Assim nenhuma consulta da tela que sai usa o X-Company-Id sem acesso (Spec 7.4). */
  function changeCompany(id: string) {
    const target = permissionView(companies, id).viewer;
    if (!onboarding && section && !canOpenScreen(target, section)) {
      sessionStorage.setItem('gestaonf.companyId', id);
      scope?.clear();
      navigate(landingPath(target), { replace: true });
      return;
    }
    onCompanyChange(id);
  }
  /** Onboarding (sem empresa): só Empresa, para cadastrar a primeira. */
  const onboardingViewer: ScreenViewer = { accountOwner: false, permissions: new Set(['company.access']) };
  const entries = menuEntries(onboarding ? onboardingViewer : access.viewer);
  const quickActions = onboarding ? [] : QUICK_ACTIONS.filter((action) => access.can(action.requires));
  const canSell = !onboarding && access.can('sales.create');
  const showNero = onboarding || canOpenScreen(access.viewer, 'nero');
  const isCollapsed = collapsed && !mobile;

  const activeGroup = entries.find((entry): entry is NavGroup => 'group' in entry && entry.items.some((item) => item.id === section))?.group;
  const [openGroups, setOpenGroups] = useState<ScreenGroup[]>(() => onboarding ? ['records'] : activeGroup ? [activeGroup] : []);

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

  const closeQuick = quick.close;
  useEffect(() => { if (isCollapsed) closeQuick(); }, [isCollapsed, closeQuick]);

  const closeNavigation = () => { setMobileOpen(false); quick.close(); };

  function toggleGroup(group: ScreenGroup) {
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

  // Rede para revogação ou refetch de ['companies'] (Spec 8.3). A troca pelo seletor já navega no evento (changeCompany). Só com a empresa resolvida, para não redirecionar no primeiro render da página.
  if (!onboarding && company && section && !canOpenScreen(access.viewer, section)) return <Navigate to={landingPath(access.viewer)} replace />;

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

        {(onboarding || canSell || quickActions.length > 0) && <div ref={quick.rootRef} className="dropdown workspace-cta">
          <div className={`workspace-cta__group${onboarding ? ' is-disabled' : ''}`}>
            {onboarding
              ? <button type="button" className="workspace-cta__main" disabled title="Cadastre uma empresa para liberar esta opção"><Plus size={19} strokeWidth={2.4} aria-hidden="true" /><span className="workspace-cta__label">Nova venda</span></button>
              : canSell && <Link to="/portal-de-servicos?novo=1" className="workspace-cta__main" title={isCollapsed ? 'Nova venda' : undefined} aria-label="Nova venda" onClick={closeNavigation}><Plus size={19} strokeWidth={2.4} aria-hidden="true" /><span className="workspace-cta__label">Nova venda</span></Link>}
            {(onboarding || (canSell && quickActions.length > 0)) && <span className="workspace-cta__divider" aria-hidden="true" />}
            {(onboarding || quickActions.length > 0) && <button ref={quick.triggerRef} type="button" className="workspace-cta__more" aria-label="Mais ações rápidas" aria-expanded={quick.open} aria-controls="workspace-quick-actions" disabled={onboarding} onClick={quick.toggle} onKeyDown={quick.onTriggerKeyDown}>
              <ChevronDown size={19} strokeWidth={2.4} aria-hidden="true" />
            </button>}
          </div>
          {quickActions.length > 0 && <div id="workspace-quick-actions" ref={quick.panelRef} className={`dropdown-panel workspace-cta__menu${quick.open ? ' is-open' : ''}`} inert={!quick.open}>
            {quickActions.map(({ label, path, icon: Icon }, index) => <Link key={path} to={path} className="dropdown-item" style={{ '--stagger': `${index * 35}ms` } as CSSProperties} onClick={closeNavigation}><Icon size={17} aria-hidden="true" />{label}</Link>)}
          </div>}
        </div>}

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

        {showNero && <div className="workspace-sidebar__assistant">
          {onboarding
            ? <button type="button" className="workspace-nero workspace-nero--disabled" disabled title="Cadastre uma empresa para liberar esta opção"><span className="workspace-nero__icon"><Bot size={19} aria-hidden="true" /></span><span className="workspace-nero__text"><strong>Nero</strong><small>Seu secretário no WhatsApp</small></span></button>
            : <Link to="/nero" className={`workspace-nero${section === 'nero' ? ' is-active' : ''}`} aria-current={section === 'nero' ? 'page' : undefined} aria-label="Nero" title={isCollapsed ? 'Nero' : undefined} onClick={closeNavigation}><span className="workspace-nero__icon"><Bot size={19} aria-hidden="true" /></span><span className="workspace-nero__text"><strong>Nero</strong><small>Seu secretário no WhatsApp</small></span></Link>}
        </div>}

        <div className="workspace-sidebar__footer">
          <Link to="/meu-perfil" className="workspace-profile" aria-current={section === 'profile' ? 'page' : undefined} aria-label={`Meu perfil - ${user.name}`} title={isCollapsed ? 'Meu perfil' : undefined} onClick={closeNavigation}>
            <UserAvatar user={user} className="header-avatar workspace-profile__avatar" />
            <span className="workspace-profile__text"><strong title={user.name}>{user.name}</strong><small>Meu perfil</small></span>
          </Link>
        </div>
      </div>
    </aside>
    <div className="workspace-content" inert={mobile && mobileOpen}>
      <header className="workspace-header">
        <button ref={menuRef} type="button" className="workspace-header__menu" onClick={() => setMobileOpen((value) => !value)} aria-label="Abrir menu de navegação" aria-controls="workspace-sidebar" aria-expanded={mobileOpen}>
          <Menu size={21} aria-hidden="true" />
        </button>
        <CompanyPicker companies={companies} companyId={companyId} onCompanyChange={changeCompany} allowMultiple={allowMultiple} scope={scope} />
        <div className="workspace-header__end">
          <UserMenu user={user} roleLabel={onboarding ? 'Cadastro pendente' : companyRoleLabel(company?.roleLabel)} profileActive={section === 'profile'} onLogout={onLogout} loggingOut={loggingOut} />
        </div>
      </header>
      {children}
      {!onboarding && companyId && <SupportWidget key={user.id} userId={user.id} companyId={companyId} />}
    </div>
  </div>;
}
