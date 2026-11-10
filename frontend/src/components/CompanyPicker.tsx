import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { Building2, Check, ChevronDown, Search, Settings2 } from 'lucide-react';
import type { Company } from '../api/client';
import { companyRoleLabel, initials } from '../utils/format';
import { useDropdown } from './useDropdown';

const SEARCH_THRESHOLD = 6;
const stagger = (index: number) => ({ '--stagger': `${Math.min(index, 8) * 30}ms` }) as CSSProperties;

export function CompanyPicker({ companies, companyId, onCompanyChange }: {
  companies?: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
}) {
  const dropdown = useDropdown();
  const [query, setQuery] = useState('');
  const activeCompany = companies?.find((item) => item.id === companyId);
  const searchable = (companies?.length ?? 0) > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    return term ? companies?.filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(term)) ?? [] : companies ?? [];
  }, [companies, query]);

  useEffect(() => { if (!dropdown.open) setQuery(''); }, [dropdown.open]);

  function choose(id: string) {
    dropdown.close(true);
    if (id !== companyId) onCompanyChange(id);
  }

  return <div ref={dropdown.rootRef} className="dropdown header-company">
    <button ref={dropdown.triggerRef} type="button" className="header-trigger header-trigger--surface" aria-label={`Empresa ativa: ${activeCompany?.name ?? 'nenhuma selecionada'}. Trocar empresa`} aria-expanded={dropdown.open} aria-controls="workspace-company-menu" disabled={!companies?.length} onClick={dropdown.toggle} onKeyDown={dropdown.onTriggerKeyDown}>
      <Building2 className="header-company__icon" size={20} strokeWidth={1.8} aria-hidden="true" />
      <span className="header-trigger__text">
        <span className="header-trigger__eyebrow">Empresa ativa</span>
        <span className="header-trigger__title header-company__name" title={activeCompany?.name}>{activeCompany?.name ?? 'Selecionar empresa'}</span>
      </span>
      <ChevronDown className="dropdown-chevron" size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>

    <div id="workspace-company-menu" ref={dropdown.panelRef} className={`dropdown-panel dropdown-panel--center header-company__panel${dropdown.open ? ' is-open' : ''}`} inert={!dropdown.open}>
      <div className="dropdown-heading"><span>Suas empresas</span><span className="dropdown-count">{companies?.length ?? 0}</span></div>
      {searchable && <label className="header-company__search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa" />
      </label>}
      <div className="header-company__list">
        {visible.map((item, index) => {
          const selected = item.id === companyId;
          return <button key={item.id} type="button" className={`dropdown-item header-company__option${selected ? ' is-selected' : ''}`} style={stagger(index)} aria-pressed={selected} onClick={() => choose(item.id)}>
            <span className="header-company__initials" aria-hidden="true">{initials(item.name)}</span>
            <span className="header-company__option-text">
              <strong title={item.name}>{item.name}</strong>
              <small>{companyRoleLabel(item.role)}</small>
            </span>
            {selected && <Check size={17} strokeWidth={2.4} aria-label="Empresa ativa" />}
          </button>;
        })}
        {!visible.length && <p className="dropdown-empty">Nenhuma empresa encontrada.</p>}
      </div>
      <div className="dropdown-separator" />
      <Link to="/empresa" className="dropdown-item" style={stagger(visible.length)} onClick={() => dropdown.close()}><Settings2 size={17} aria-hidden="true" />Gerenciar empresas</Link>
    </div>
  </div>;
}
