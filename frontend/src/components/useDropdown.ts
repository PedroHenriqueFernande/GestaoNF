import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

const ITEM_SELECTOR = '.dropdown-item:not(:disabled)';

/**
 * Comportamento padrão dos dropdowns da GestãoNF: fecha ao clicar fora ou com Esc
 * (devolvendo o foco ao gatilho) e permite navegar pelos itens com as setas.
 * O painel fica sempre montado; a classe `is-open` controla a animação (dropdown.css).
 */
export function useDropdown<T extends HTMLElement = HTMLButtonElement>() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  const focusItem = useCallback((position: 'first' | 'last') => {
    const items = panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR);
    if (!items?.length) return;
    (position === 'first' ? items[0] : items[items.length - 1]).focus();
  }, []);

  /** Abre e foca o primeiro ou o último item (APG Menu Button). */
  const openAt = useCallback((position: 'first' | 'last') => {
    setOpen(true);
    requestAnimationFrame(() => focusItem(position));
  }, [focusItem]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(true);
        return;
      }
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      if (!rootRef.current?.contains(document.activeElement)) return;
      const active = document.activeElement as HTMLElement;
      // Campo de texto (busca) usa ArrowUp/Home/End no cursor; só ArrowDown desce para a lista.
      const textField = active instanceof HTMLInputElement && active.type !== 'checkbox' && active.type !== 'radio';
      if (textField && event.key !== 'ArrowDown') return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
      if (!items.length) return;
      event.preventDefault();
      // Foco fora dos itens (busca, checkbox, gatilho): a seta parte da posição do elemento no painel.
      const index = items.indexOf(active);
      const after = index >= 0 ? index + 1 : items.findIndex((item) => active.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING);
      const before = index >= 0 ? index - 1 : (after === -1 ? items.length : after) - 1;
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (after === -1 || after >= items.length ? 0 : after)
            : before < 0 ? items.length - 1 : before;
      items[next].focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  /** Seta para baixo/cima no gatilho abre o menu e foca o primeiro/último item. */
  const onTriggerKeyDown = useCallback((event: ReactKeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    openAt(event.key === 'ArrowDown' ? 'first' : 'last');
  }, [openAt]);

  return { open, setOpen, toggle, close, openAt, rootRef, triggerRef, panelRef, onTriggerKeyDown };
}
