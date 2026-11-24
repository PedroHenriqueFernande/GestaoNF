import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { Check, ChevronDown, Layers, Search, Settings2 } from 'lucide-react';
import type { Company } from '../api/client';
import { companyRoleLabel } from '../utils/format';
import { CompanyLogo } from './CompanyLogo';
import type { CompanyScope } from './company-scope';
import { useDropdown } from './useDropdown';

const SEARCH_THRESHOLD = 6;
const STACK_LIMIT = 3;
const stagger = (index: number) => ({ '--stagger': `${Math.min(index, 8) * 30}ms` }) as CSSProperties;

export function CompanyPicker({ companies, companyId, onCompanyChange, allowMultiple = false, scope }: {
  companies?: Company[];
  companyId: string;
  onCompanyChange: (id: string) => void;
  /** "Ver todas", caixas e "Ver selecionadas" quando há duas empresas elegíveis. */
  allowMultiple?: boolean;
  scope?: CompanyScope;
}) {
  const dropdown = useDropdown();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<string[]>([]);
  const multiple = allowMultiple ? scope?.multiple ?? null : null;
  const eligible = new Set(scope?.eligibleIds);
  const canCombine = allowMultiple && eligible.size >= 2;
  const draftIds = draft.filter(id => eligible.has(id));
  const activeCompany = companies?.find((item) => item.id === companyId);
  const searchable = (companies?.length ?? 0) > SEARCH_THRESHOLD;
  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    return term ? companies?.filter((item) => item.name.toLocaleLowerCase('pt-BR').includes(term)) ?? [] : companies ?? [];
  }, [companies, query]);
  const stacked = multiple ? multiple.ids.map((id) => companies?.find((item) => item.id === id)).filter((item): item is Company => !!item).slice(0, STACK_LIMIT) : [];

  useEffect(() => { if (!dropdown.open) setQuery(''); }, [dropdown.open]);
  // Rascunho dos checkboxes: recriado a cada abertura; Esc ou clique fora o descartam.
  useEffect(() => { if (dropdown.open) setDraft(multiple?.ids ?? (eligible.has(companyId) ? [companyId] : [])); }, [dropdown.open]);

  function choose(id: string) {
    dropdown.close(true);
    if (id !== companyId || multiple) onCompanyChange(id);
  }
  function toggleDraft(id: string) { setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]); }
  function applyDraft() {
    dropdown.close(true);
    if (draftIds.length === 1) onCompanyChange(draftIds[0]); else scope?.selectMany(draftIds);
  }

  const label = multiple
    ? multiple.mode === 'all' ? `Visão: todas as empresas (${multiple.ids.length}). Trocar empresas` : `Visão: ${multiple.ids.length} empresas selecionadas. Trocar empresas`
    : `Empresa ativa: ${activeCompany?.name ?? 'nenhuma selecionada'}. Trocar empresa`;
  const title = multiple ? (multiple.mode === 'all' ? 'Todas as empresas' : `${multiple.ids.length} empresas`) : activeCompany?.name ?? 'Selecionar empresa';
  let index = 0;

  return <div ref={dropdown.rootRef} className="dropdown header-company">
    <button ref={dropdown.triggerRef} type="button" className="header-trigger header-trigger--surface" aria-label={label} aria-expanded={dropdown.open} aria-controls="workspace-company-menu" disabled={!companies?.length} onClick={dropdown.toggle} onKeyDown={dropdown.onTriggerKeyDown}>
      {multiple
        ? <span className="header-company__stack" aria-hidden="true">
            {stacked.map((item) => <CompanyLogo key={item.id} company={item} className="header-company__badge header-company__badge--stacked" />)}
            {multiple.ids.length > STACK_LIMIT && <span className="header-company__more">+{multiple.ids.length - STACK_LIMIT}</span>}
          </span>
        : <CompanyLogo company={activeCompany} className="header-company__badge" />}
      <span className="header-trigger__title header-company__name" title={title}>{title}</span>
      <ChevronDown className="dropdown-chevron" size={17} strokeWidth={2.2} aria-hidden="true" />
    </button>

    <div id="workspace-company-menu" ref={dropdown.panelRef} className={`dropdown-panel dropdown-panel--center header-company__panel${dropdown.open ? ' is-open' : ''}`} inert={!dropdown.open}>
      <div className="dropdown-heading"><span>Suas empresas</span><span className="dropdown-count">{companies?.length ?? 0}</span></div>
      {canCombine && <button type="button" className={`dropdown-item header-company__all${multiple?.mode === 'all' ? ' is-selected' : ''}`} style={stagger(index++)} aria-pressed={multiple?.mode === 'all'} onClick={() => { dropdown.close(true); scope?.selectAll(); }}>
        <Layers size={17} aria-hidden="true" />Ver todas as empresas
      </button>}
      {searchable && <label className="header-company__search">
        <Search size={16} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar empresa" aria-label="Buscar empresa" />
      </label>}
      <div className="header-company__list">
        {visible.map((item) => {
          const selected = !multiple && item.id === companyId;
          // O checkbox fica fora de .dropdown-item: Tab o alcança; as setas a partir dele seguem a ordem do painel (useDropdown).
          return <div key={item.id} className="header-company__row">
            {canCombine && eligible.has(item.id) && <input type="checkbox" className="header-company__check" checked={draftIds.includes(item.id)} onChange={() => toggleDraft(item.id)} aria-label={`Incluir ${item.name} na visão`} />}
            <button type="button" className={`dropdown-item header-company__option${selected ? ' is-selected' : ''}`} style={stagger(index++)} aria-pressed={selected} onClick={() => choose(item.id)}>
              <CompanyLogo company={item} className="header-company__initials" />
              <span className="header-company__option-text">
                <strong title={item.name}>{item.name}</strong>
                <small>{companyRoleLabel(item.roleLabel)}</small>
              </span>
              {selected && <Check size={17} strokeWidth={2.4} aria-label="Empresa ativa" />}
            </button>
          </div>;
        })}
        {!visible.length && <p className="dropdown-empty">Nenhuma empresa encontrada.</p>}
      </div>
      {canCombine && <button type="button" className="dropdown-item header-company__apply" style={stagger(index++)} disabled={!draftIds.length} onClick={applyDraft}>Ver selecionadas ({draftIds.length})</button>}
      <div className="dropdown-separator" />
      <Link to="/empresa" className="dropdown-item" style={stagger(index)} onClick={() => dropdown.close()}><Settings2 size={17} aria-hidden="true" />Gerenciar empresas</Link>
    </div>
  </div>;
}
