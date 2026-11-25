import { useId, useLayoutEffect, useState, type CSSProperties } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useDropdown } from '../../components/useDropdown';
import { saleFinancePath, type SaleActions } from './sale-permissions';

/** Menu ⋯ da venda (D15, APG Menu Button). Não renderiza nada sem ações permitidas. */
export function SaleActionsMenu({ orderCode, companyId, actions, onEdit, onDelete, className = '' }: {
  orderCode: string; companyId: string; actions: SaleActions; onEdit: () => void; onDelete: (trigger: HTMLButtonElement | null) => void; className?: string;
}) {
  const navigate = useNavigate();
  const menu = useDropdown();
  const { open, close, triggerRef, panelRef } = menu;
  const menuId = useId();
  const [position, setPosition] = useState<CSSProperties>();

  // Posiciona fora da rolagem da tabela para o painel não aumentar sua altura nem ser recortado.
  useLayoutEffect(() => {
    if (!open) return;

    let anchor: DOMRect | undefined;
    const place = () => {
      const trigger = triggerRef.current;
      const panel = panelRef.current;
      if (!trigger || !panel) return;

      const rect = trigger.getBoundingClientRect();
      anchor = rect;
      const { clientHeight, clientWidth } = document.documentElement;
      const gap = 8;
      const below = clientHeight - rect.bottom - 2 * gap;
      const above = rect.top - 2 * gap;
      const panelHeight = panel.scrollHeight + panel.offsetHeight - panel.clientHeight;
      const opensAbove = panelHeight > below && above > below;

      setPosition({
        top: opensAbove ? 'auto' : rect.bottom + gap,
        bottom: opensAbove ? clientHeight - rect.top + gap : 'auto',
        left: Math.max(gap, Math.min(rect.right, clientWidth - gap) - panel.offsetWidth),
        maxHeight: Math.max(0, opensAbove ? above : below),
      });
    };

    const closeOnScroll = (event: Event) => {
      const trigger = triggerRef.current;
      if (!trigger || !anchor || !(event.target instanceof Node) || !event.target.contains(trigger)) return;

      const rect = trigger.getBoundingClientRect();
      if (rect.top !== anchor.top || rect.left !== anchor.left) close();
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', closeOnScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', closeOnScroll, true);
    };
  }, [open, close, triggerRef, panelRef]);

  if (!actions.edit && !actions.remove && !actions.finance) return null;
  const label = `Ações da venda #${orderCode}`;
  const choose = (action: () => void) => { close(); action(); };
  // A empresa ativa da aba passa a ser a da venda (inclusive na visão com várias empresas), como o Financeiro espera.
  const goToFinance = () => { sessionStorage.setItem('gestaonf.companyId', companyId); navigate(saleFinancePath(orderCode)); };
  // stopPropagation: o clique no ⋯ não pode abrir a linha da tabela (D15).
  return <div ref={menu.rootRef} className={`dropdown sale-actions ${className}`} onClick={(event) => event.stopPropagation()}>
    <button ref={triggerRef} type="button" className="sale-actions__trigger" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} aria-label={label}
      onClick={() => (open ? close() : menu.openAt('first'))} onKeyDown={menu.onTriggerKeyDown}>
      <MoreHorizontal size={18} aria-hidden="true" />
    </button>
    <div id={menuId} ref={panelRef} role="menu" aria-label={label} className={`dropdown-panel sale-actions__menu${open ? ' is-open' : ''}`} style={position} inert={!open}>
      {actions.edit && <button type="button" role="menuitem" className="dropdown-item" onClick={() => choose(onEdit)}>Editar</button>}
      {actions.finance && <button type="button" role="menuitem" className="dropdown-item" onClick={() => choose(goToFinance)}>Ir para o financeiro</button>}
      {actions.remove && <button type="button" role="menuitem" className="dropdown-item" onClick={() => choose(() => onDelete(triggerRef.current))}>Excluir</button>}
    </div>
  </div>;
}
