import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { ChevronDown, LogOut, UserRound } from 'lucide-react';
import type { User } from '../api/client';
import { UserAvatar } from './UserAvatar';
import { useDropdown } from './useDropdown';

const stagger = (index: number) => ({ '--stagger': `${index * 35}ms` }) as CSSProperties;

export function UserMenu({ user, roleLabel, profileActive, onLogout, loggingOut }: {
  user: User;
  roleLabel: string;
  profileActive: boolean;
  onLogout: () => void;
  loggingOut: boolean;
}) {
  const dropdown = useDropdown();

  return <div ref={dropdown.rootRef} className="dropdown header-user">
    <button ref={dropdown.triggerRef} type="button" className="header-trigger header-trigger--surface" aria-label={`Opções do perfil de ${user.name}`} aria-expanded={dropdown.open} aria-controls="workspace-user-menu" onClick={dropdown.toggle} onKeyDown={dropdown.onTriggerKeyDown}>
      <UserAvatar user={user} className="header-avatar" />
      <span className="header-trigger__text header-user__text">
        <span className="header-trigger__title">{user.name}</span>
        <span className="header-trigger__eyebrow">{roleLabel}</span>
      </span>
      <ChevronDown className="dropdown-chevron" size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>

    <div id="workspace-user-menu" ref={dropdown.panelRef} className={`dropdown-panel dropdown-panel--center header-user__panel${dropdown.open ? ' is-open' : ''}`} inert={!dropdown.open}>
      <div className="header-user__card">
        <UserAvatar user={user} className="header-avatar header-avatar--lg" />
        <div><strong title={user.name}>{user.name}</strong><span title={user.email}>{user.email}</span></div>
      </div>
      <div className="dropdown-separator" />
      <Link to="/meu-perfil" className="dropdown-item" style={stagger(0)} aria-current={profileActive ? 'page' : undefined} onClick={() => dropdown.close()}><UserRound size={17} aria-hidden="true" />Meu perfil</Link>
      <div className="dropdown-separator" />
      <button type="button" className="dropdown-item dropdown-item--danger" style={stagger(1)} disabled={loggingOut} onClick={() => { dropdown.close(); onLogout(); }}><LogOut size={17} aria-hidden="true" />{loggingOut ? 'Saindo…' : 'Sair'}</button>
    </div>
  </div>;
}
