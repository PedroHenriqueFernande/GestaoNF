import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { api, type Service } from '../../api/client';

const PAGE_SIZE = 100;
const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function ProposalServicePicker({ companyId, selected, atLimit, onToggle }: {
  companyId: string;
  selected: ReadonlySet<string>;
  atLimit: boolean;
  onToggle: (service: Service, checked: boolean) => void;
}) {
  const inputId = useId();
  const menuId = useId();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const term = search.trim();
  const catalog = useQuery({
    queryKey: ['crm-services', companyId, term, page],
    queryFn: () => api.services(companyId, { search: term, status: 'ACTIVE', page, limit: PAGE_SIZE }),
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [open]);

  return <div ref={root} className="proposal-service-picker" onBlur={event => {
    // No <dialog> modal, clicar num trecho não focável (texto da opção) manda o foco ao próprio diálogo,
    // que é ancestral do seletor. Isso não é "sair" do seletor; cliques fora já são tratados no pointerdown.
    const next = event.relatedTarget;
    if (next instanceof Node && !event.currentTarget.contains(next) && !next.contains(event.currentTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (!open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    input.current?.focus();
  }}>
    <div className="proposal-service-picker__head">
      <label htmlFor={inputId} className="field">Buscar serviço</label>
      {selected.size > 0 && <span className="proposal-service-picker__count" aria-live="polite">
        {selected.size} {selected.size === 1 ? 'serviço selecionado' : 'serviços selecionados'}
      </span>}
    </div>
    <div className="proposal-chooser-search">
      <input id={inputId} ref={input} value={search} maxLength={100} autoComplete="off" placeholder="Nome do serviço" aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(true)}
        onChange={event => { setSearch(event.target.value); setPage(0); setOpen(true); }}
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'Enter') {
            event.preventDefault();
            setOpen(true);
            if (event.key === 'ArrowDown') root.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')?.focus();
          }
        }} />
      <button type="button" aria-label={open ? 'Ocultar serviços' : 'Mostrar serviços'} aria-expanded={open}
        aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)}>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
    </div>
    {open && <div id={menuId} className="proposal-service-menu" role="group" aria-label="Serviços cadastrados" aria-busy={catalog.isFetching}>
      {catalog.isPending ? <p className="proposal-service-menu__note" role="status">Carregando serviços…</p> : catalog.isError ? <div className="proposal-service-menu__message" role="alert">
        <p className="proposal-service-menu__note">Não foi possível carregar os serviços.</p>
        <button type="button" onClick={() => void catalog.refetch()}>Tentar novamente</button>
      </div> : <>
        <div className="proposal-service-menu__head">
          <span>{catalog.data.total} {catalog.data.total === 1 ? 'serviço' : 'serviços'}{term ? ` para “${term}”` : ''}</span>
          {selected.size > 0 && <span>{selected.size} na proposta</span>}
        </div>
        {catalog.data.items.length === 0 ? <p className="proposal-service-menu__note" role="status">Nenhum serviço encontrado.</p> : <div className="proposal-service-menu__list">
          {catalog.data.items.map(service => {
            const checked = selected.has(service.id);
            const price = service.suggestedUnitPrice === null ? null : money.format(Number(service.suggestedUnitPrice));
            return <label className={`proposal-service-option${checked ? ' is-selected' : ''}`} key={service.id}>
              <input type="checkbox" className="proposal-check" checked={checked} disabled={atLimit && !checked}
                onChange={event => onToggle(service, event.target.checked)} />
              <span className="proposal-service-option__text">
                <span className="proposal-service-option__name">{service.name}</span>
                {service.internalCode && <span className="proposal-service-option__code">Cód. {service.internalCode}</span>}
              </span>
              {price && <span className="proposal-service-option__price">{price}</span>}
            </label>;
          })}
        </div>}
        {catalog.data.total > PAGE_SIZE && <div className="proposal-service-menu__pages">
          <button type="button" disabled={page === 0} onClick={() => { input.current?.focus(); setPage(page - 1); }}>
            <ChevronLeft size={14} aria-hidden="true" /> Anterior
          </button>
          <span>Página {page + 1} de {Math.ceil(catalog.data.total / PAGE_SIZE)}</span>
          <button type="button" disabled={(page + 1) * PAGE_SIZE >= catalog.data.total} onClick={() => { input.current?.focus(); setPage(page + 1); }}>
            Próxima <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>}
      </>}
      {atLimit && <p className="proposal-service-menu__limit" role="status">Limite de 100 serviços por proposta.</p>}
    </div>}
  </div>;
}
