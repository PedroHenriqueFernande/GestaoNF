import { useId } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useDropdown } from '../../components/useDropdown';
import type { SaleActions } from './sale-permissions';

/** Menu ⋯ da venda (D15, APG Menu Button). Não renderiza nada sem ações permitidas. */
export function SaleActionsMenu({ orderCode, actions, onEdit, onDelete, className = '' }: {
  orderCode: string; actions: SaleActions; onEdit: () => void; onDelete: (trigger: HTMLButtonElement | null) => void; className?: string;
}) {
  const menu = useDropdown();
  const menuId = useId();
  if (!actions.edit && !actions.remove) return null;
  const label = `Ações da venda #${orderCode}`;
  const choose = (action: () => void) => { menu.close(); action(); };
  // stopPropagation: o clique no ⋯ não pode abrir a linha da tabela (D15).
  return <div ref={menu.rootRef} className={`dropdown sale-actions ${className}`} onClick={(event) => event.stopPropagation()}>
    <button ref={menu.triggerRef} type="button" className="sale-actions__trigger" aria-haspopup="menu" aria-expanded={menu.open} aria-controls={menuId} aria-label={label}
      onClick={() => (menu.open ? menu.close() : menu.openAt('first'))} onKeyDown={menu.onTriggerKeyDown}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    <div id={menuId} ref={menu.panelRef} role="menu" aria-label={label} className={`dropdown-panel sale-actions__menu${menu.open ? ' is-open' : ''}`} inert={!menu.open}>
      {actions.edit && <button type="button" role="menuitem" className="dropdown-item" onClick={() => choose(onEdit)}>Editar</button>}
      {actions.remove && <button type="button" role="menuitem" className="dropdown-item" onClick={() => choose(() => onDelete(menu.triggerRef.current))}>Excluir</button>}
    </div>
  </div>;
}
