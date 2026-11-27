import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ChevronDown } from 'lucide-react';

export type SaleDropdownOption<Value extends string> = { value: Value; label: string; disabled?: boolean };

export function SaleDropdown<Value extends string>({ label, value, options, onChange, disabled = false, describedBy }: {
  label: string;
  value: Value;
  options: readonly SaleDropdownOption<Value>[];
  onChange: (value: Value) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState<number | null>(null);
  const selectedIndex = options.findIndex((option) => option.value === value);
  const currentIndex = highlight === null ? -1 : Math.min(highlight, options.length - 1);
  const enabledIndices = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const initialIndex = enabledIndices.includes(selectedIndex) ? selectedIndex : enabledIndices[0];

  function openAtSelection() {
    setHighlight(initialIndex ?? null);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') { if (open) { event.preventDefault(); setOpen(false); } return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) { openAtSelection(); return; }
      if (enabledIndices.length) {
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const index = enabledIndices.indexOf(highlight ?? selectedIndex);
        const next = index === -1
          ? (direction === 1 ? 0 : enabledIndices.length - 1)
          : (index + direction + enabledIndices.length) % enabledIndices.length;
        setHighlight(enabledIndices[next]);
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      if (!open) return;
      event.preventDefault();
      setHighlight((event.key === 'Home' ? enabledIndices[0] : enabledIndices.at(-1)) ?? null);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (open) choose(highlight === null ? (initialIndex ?? -1) : currentIndex);
      else openAtSelection();
    }
  }

  return <div className={`sale-select${open ? ' is-open' : ''}`} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="sale-select__trigger" role="combobox" aria-label={label} aria-describedby={describedBy} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} aria-activedescendant={open && options[currentIndex] ? `${listId}-${currentIndex}` : undefined} disabled={disabled} onClick={() => { setHighlight(null); setOpen(!open); }} onKeyDown={handleKeyDown}>
      <span>{options[selectedIndex]?.label ?? 'Selecione'}</span><ChevronDown size={15} />
    </button>
    {open && <div id={listId} className="sale-lookup-options sale-select__options" role="listbox" aria-label={label} onPointerMove={() => { if (highlight !== null) setHighlight(null); }}>
      {options.map((option, index) => <button key={option.value} id={`${listId}-${index}`} type="button" role="option" disabled={option.disabled} aria-selected={option.value === value} className={`sale-lookup-option${index === currentIndex && !option.disabled ? ' is-highlighted' : ''}`} onClick={() => choose(index)}><strong>{option.label}</strong></button>)}
    </div>}
  </div>;
}
