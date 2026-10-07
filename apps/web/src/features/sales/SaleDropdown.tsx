import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

export type SaleDropdownOption<Value extends string> = { value: Value; label: string };

export function SaleDropdown<Value extends string>({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: Value;
  options: readonly SaleDropdownOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const currentIndex = Math.min(highlight, Math.max(0, options.length - 1));

  function openAtSelection() {
    setHighlight(Math.max(0, selectedIndex));
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openAtSelection(); return; }
      if (options.length) setHighlight((index) => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setHighlight(event.key === 'Home' ? 0 : options.length - 1);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(currentIndex);
      else openAtSelection();
    }
  }

  return <div className={`sale-select${open ? ' is-open' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="sale-select__trigger" role="combobox" aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[currentIndex] ? `${listId}-${currentIndex}` : undefined} disabled={disabled} onClick={() => { if (open) setOpen(false); else openAtSelection(); }} onKeyDown={handleKeyDown}>
      <span>{options[selectedIndex]?.label ?? 'Selecione'}</span><ChevronDown size={15} />
    </button>
    {open && <div id={listId} className="sale-lookup-options sale-select__options" role="listbox" aria-label={label}>
      {options.map((option, index) => <button key={option.value} id={`${listId}-${index}`} type="button" role="option" aria-selected={option.value === value} className={`sale-lookup-option${index === currentIndex ? ' is-highlighted' : ''}`} onMouseEnter={() => setHighlight(index)} onClick={() => choose(index)}><strong>{option.label}</strong></button>)}
    </div>}
  </div>;
}
