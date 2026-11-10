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
      const inField = document.activeElement instanceof HTMLInputElement;
      if (inField && event.key !== 'ArrowDown') return;
      const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
      if (!items.length) return;
      event.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? items.length - 1
          : event.key === 'ArrowDown' ? (index + 1) % items.length
            : index <= 0 ? items.length - 1 : index - 1;
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
    const position = event.key === 'ArrowDown' ? 'first' : 'last';
    setOpen(true);
    requestAnimationFrame(() => focusItem(position));
  }, [focusItem]);

  return { open, setOpen, toggle, close, rootRef, triggerRef, panelRef, onTriggerKeyDown };
}
