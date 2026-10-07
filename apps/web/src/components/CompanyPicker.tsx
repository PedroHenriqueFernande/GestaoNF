import { useEffect, useRef, useState } from 'react';
import { Building2, Check, ChevronDown } from 'lucide-react';
import type { Company } from '../api/client';

export function CompanyPicker({ companies, companyId, onCompanyChange }: {
  companies?: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const activeCompany = companies?.find((item) => item.id === companyId);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: Event) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('focusin', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return <div ref={pickerRef} className="company-picker">
    <button ref={triggerRef} type="button" className="company-picker__trigger" aria-label={`Empresa ativa: ${activeCompany?.name ?? 'nenhuma selecionada'}`} aria-expanded={open} aria-controls={open ? 'workspace-company-options' : undefined} disabled={!companies?.length} onClick={() => setOpen((value) => !value)}>
      <Building2 size={16} aria-hidden="true" />
      <span className="company-picker__name" title={activeCompany?.name}>{activeCompany?.name ?? 'Selecionar empresa'}</span>
      <ChevronDown className="company-picker__chevron" size={15} aria-hidden="true" />
    </button>
    {open && <div id="workspace-company-options" className="company-picker__popover">
      <div className="company-picker__list">
        {companies?.map((item) => <button key={item.id} type="button" className={`company-picker__option${item.id === companyId ? ' is-selected' : ''}`} aria-pressed={item.id === companyId} onClick={() => { setOpen(false); if (item.id !== companyId) onCompanyChange(item.id); triggerRef.current?.focus(); }}>
          <span className="company-picker__option-name" title={item.name}>{item.name}</span>
          {item.id === companyId && <Check size={15} aria-hidden="true" />}
        </button>)}
      </div>
    </div>}
  </div>;
}
