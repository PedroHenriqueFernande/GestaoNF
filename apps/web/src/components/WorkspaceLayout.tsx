import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { Building2, ChevronDown, ChevronRight, ClipboardList, Landmark, LogOut, Menu, ReceiptText, UsersRound, X } from 'lucide-react';
import type { Company, User } from '../api/client';
import { initials } from '../utils/format';
import { CompanyPicker } from './CompanyPicker';

const MOBILE_QUERY = '(max-width: 959px)';
const navigation = [
  { id: 'customers', label: 'Clientes', path: '/Clientes', icon: UsersRound },
  { id: 'services', label: 'Serviços', path: '/serviço', icon: ClipboardList },
  { id: 'company', label: 'Empresa', path: '/empresa', icon: Building2 },
  { id: 'sales', label: 'Portal de Serviços', path: '/portal-de-servicos', icon: ReceiptText },
  { id: 'finance', label: 'Financeiro', path: '/financeiro', icon: Landmark },
] as const;

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
  const sidebarRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const pathname = decodeURIComponent(location.pathname).toLocaleLowerCase('pt-BR');
  const section = pathname === '/empresa' ? 'company' : pathname === '/serviço' || pathname === '/servicos' ? 'services' : pathname === '/portal-de-servicos' ? 'sales' : pathname === '/financeiro' ? 'finance' : 'customers';
  const company = companies?.find((item) => item.id === companyId);

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
        .filter((element) => element.getClientRects().length > 0);
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

  return <div className={`app-shell client-workspace workspace-layout${mobileOpen ? ' workspace-layout--menu-open' : ''} ${className}`}>
    <a className="workspace-skip-link" href="#workspace-main">Ir para o conteúdo</a>
    {mobileOpen && <button type="button" className="workspace-menu-backdrop" aria-label="Fechar menu de navegação" onClick={() => setMobileOpen(false)} />}
    <aside id="workspace-sidebar" ref={sidebarRef} className="workspace-sidebar" role={mobile && mobileOpen ? 'dialog' : undefined} aria-modal={mobile && mobileOpen ? true : undefined} aria-label="Menu principal" aria-hidden={mobile && !mobileOpen ? true : undefined} inert={mobile && !mobileOpen}>
      <div className="workspace-sidebar__brand">
        <Link to={onboarding ? '/empresa' : '/Clientes'} className="workspace-sidebar__brand-link" aria-label="GestãoNF" onClick={() => setMobileOpen(false)}><img src="/gestaonf-logo-dark.svg" alt="GestãoNF" width="196" height="41" /></Link>
        <button type="button" className="workspace-sidebar__close" aria-label="Fechar menu" onClick={() => setMobileOpen(false)}><X size={20} /></button>
      </div>
      <div className="workspace-sidebar__navigation">
        {([
          { label: 'Gestão', items: [navigation[3], navigation[4]] },
          { label: 'Cadastros', items: onboarding ? [navigation[2], navigation[0], navigation[1]] : [navigation[0], navigation[1], navigation[2]] },
        ] as const).map((group) => <div className="workspace-nav-group" key={group.label}>
        <p className="workspace-sidebar__label">{group.label}</p>
        <nav aria-label={group.label}>
          {group.items.map(({ id, label, path, icon: Icon }) => onboarding && id !== 'company'
            ? <button key={id} type="button" className="workspace-nav-link workspace-nav-link--disabled" disabled title="Cadastre uma empresa para liberar esta opção">
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span><ChevronRight className="workspace-nav-link__arrow" size={15} aria-hidden="true" />
              </button>
            : <Link key={id} to={path} className={`workspace-nav-link${section === id ? ' is-active' : ''}`} aria-current={section === id ? 'page' : undefined} aria-label={label} onClick={() => setMobileOpen(false)}>
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span><ChevronRight className="workspace-nav-link__arrow" size={15} aria-hidden="true" />
              </Link>)}
        </nav>
        </div>)}
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
          <span className="user-badge" title={user.email}>{initials(user.name)}</span>
          <div className="user-info"><strong>{user.name}</strong><span>{onboarding ? 'Cadastro pendente' : company?.role === 'OWNER' ? 'Proprietário' : company?.role ?? 'Usuário'}</span></div>
          <div ref={profileRef} className="topbar__profile-menu">
            <button ref={profileButtonRef} type="button" className="icon-button topbar__profile-toggle" title="Opções do perfil" aria-label="Opções do perfil" aria-controls={profileOpen ? 'workspace-profile-options' : undefined} aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}><ChevronDown size={18} strokeWidth={2.2} /></button>
            {profileOpen && <div id="workspace-profile-options" className="topbar__profile-options"><button type="button" onClick={() => { setProfileOpen(false); onLogout(); }} disabled={loggingOut}><LogOut size={16} aria-hidden="true" />Sair</button></div>}
          </div>
        </div>
      </div></header>
      {children}
    </div>
  </div>;
}
