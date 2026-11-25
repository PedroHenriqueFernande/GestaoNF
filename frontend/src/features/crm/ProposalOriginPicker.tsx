import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowRight, ChevronDown, Search } from 'lucide-react';
import type { ProposalSource } from './ProposalEditor';

type Option = { id: string; source: ProposalSource; name: string; description: string };

export function ProposalOriginPicker({ label, value, options, status, failed, disabled, onSearch, onSelect }: {
  label: string;
  value: string;
  options: readonly Option[];
  status?: string;
  failed: boolean;
  disabled: boolean;
  onSearch: (value: string) => void;
  onSelect: (source: ProposalSource) => void;
}) {
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const expanded = open && !disabled;
  const activeIndex = expanded ? Math.min(highlight, options.length - 1) : -1;
  const activeOption = options[activeIndex];

  useEffect(() => {
    list.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, activeOption?.id]);

  function close() {
    setOpen(false);
    setHighlight(-1);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && expanded) {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (!options.length) return;
      const down = event.key === 'ArrowDown';
      const nextIndex = activeIndex < 0 ? (down ? 0 : options.length - 1) : activeIndex + (down ? 1 : -1);
      setHighlight(Math.max(0, Math.min(nextIndex, options.length - 1)));
    } else if (event.key === 'Enter' && activeOption) {
      event.preventDefault();
      onSelect(activeOption.source);
    }
  }

  return (
    <div className="proposal-origin-picker" data-open={expanded} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) close();
    }}>
      <div className="proposal-chooser-search">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          maxLength={200}
          placeholder={label}
          disabled={disabled}
          value={value}
          onClick={() => setOpen(true)}
          onChange={event => { onSearch(event.target.value); setOpen(true); setHighlight(-1); }}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={expanded ? 'Ocultar opções' : 'Mostrar opções'}
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          disabled={disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => { input.current?.focus(); if (expanded) close(); else setOpen(true); }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
      </div>
      {expanded && <div className="proposal-chooser-menu">
        <ul ref={list} id={listId} className="proposal-chooser-list" role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <li
              key={option.id}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={event => event.preventDefault()}
              onClick={() => onSelect(option.source)}
            >
              <span><strong>{option.name}</strong><small>{option.description}</small></span>
              <ArrowRight size={15} aria-hidden="true" />
            </li>
          ))}
        </ul>
        {status && <p role={failed ? 'alert' : 'status'}>{status}</p>}
      </div>}
    </div>
  );
}
