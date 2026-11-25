import { useId, useLayoutEffect, useState, type CSSProperties } from 'react';
import { Copy, MoreVertical, Trash2 } from 'lucide-react';
import { useDropdown } from '../../components/useDropdown';
import type { Proposal } from '../../api/client';

const PANEL_WIDTH = 210;
const PANEL_HEIGHT = 108;

/**
 * Menu de ações da linha da proposta. O painel usa posição fixa (relativa à tela)
 * para não ser cortado pela rolagem horizontal da tabela; abre para cima quando falta espaço.
 */
export function ProposalRowMenu({ proposal, busy, onDuplicate, onDelete }: {
  proposal: Pick<Proposal, 'proposalCode' | 'status'>;
  busy: boolean;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const menu = useDropdown();
  const panelId = useId();
  const [position, setPosition] = useState<CSSProperties>({});
  const [above, setAbove] = useState(false);
  const converted = proposal.status === 'CONVERTED';

  useLayoutEffect(() => {
    if (!menu.open) return;
    const place = () => {
      const rect = menu.triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const up = rect.bottom + 8 + PANEL_HEIGHT > window.innerHeight && rect.top - 8 - PANEL_HEIGHT > 0;
      setAbove(up);
      setPosition({ position: 'fixed', left: Math.max(8, rect.right - PANEL_WIDTH), width: PANEL_WIDTH,
        ...(up ? { top: 'auto', bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6, bottom: 'auto' }) });
    };
    place();
    // Rolar ou redimensionar com o menu aberto o fecharia fora do lugar; fecha.
    const close = () => menu.close();
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [menu.open, menu.triggerRef, menu.close]);

  const run = (action: () => void) => { menu.close(); action(); };

  return <div ref={menu.rootRef} className="dropdown proposal-row-menu" onClick={event => event.stopPropagation()}>
    <button ref={menu.triggerRef} type="button" className="proposal-row-menu__trigger" aria-label={`Ações da proposta ${proposal.proposalCode}`}
      aria-haspopup="menu" aria-expanded={menu.open} aria-controls={panelId} disabled={busy} onClick={menu.toggle} onKeyDown={menu.onTriggerKeyDown}>
      <MoreVertical size={17} aria-hidden="true" />
    </button>
    <div id={panelId} ref={menu.panelRef} role="menu" aria-label={`Ações da proposta ${proposal.proposalCode}`} inert={!menu.open} style={position}
      className={`dropdown-panel proposal-row-menu__panel${above ? ' proposal-row-menu__panel--above' : ''}${menu.open ? ' is-open' : ''}`}>
      <button type="button" role="menuitem" className="dropdown-item" onClick={() => run(onDuplicate)}>
        <Copy size={16} aria-hidden="true" /> Duplicar proposta
      </button>
      <div className="dropdown-separator" role="separator" />
      <button type="button" role="menuitem" className="dropdown-item dropdown-item--danger" style={{ '--stagger': '35ms' } as CSSProperties}
        disabled={converted} title={converted ? 'Proposta convertida em pedido não pode ser excluída' : undefined} onClick={() => run(onDelete)}>
        <Trash2 size={16} aria-hidden="true" /> Excluir proposta
      </button>
    </div>
  </div>;
}
