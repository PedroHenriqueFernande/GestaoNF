import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertCircle, BriefcaseBusiness, CalendarDays, Check, CircleDollarSign, Clock3, FileText, Mail, MessageSquarePlus, Phone, Tag, UserRound, X } from 'lucide-react';
import { api, ApiError, type CrmOpportunity, type CrmStatus } from '../../api/client';
import { usePermissions } from '../permissions/usePermissions';
import { SaleDropdown } from '../sales/SaleDropdown';
import { CRM_STATUSES, money, shortDateTime, statusLabel } from './crm-utils';

const activityNames: Record<string, string> = {
  CONTACT_CREATED: 'Contato adicionado', ENTRY_RECEIVED: 'Nova entrada recebida', OPPORTUNITY_CREATED: 'Negociação criada',
  CONTACT_UPDATED: 'Dados atualizados', ASSIGNED: 'Responsável alterado', STAGE_CHANGED: 'Card movimentado',
  STATUS_CHANGED: 'Situação alterada', NOTE_ADDED: 'Nota adicionada', CUSTOMER_LINKED: 'Cliente vinculado',
  ARCHIVED: 'Registro arquivado', RESTORED: 'Registro restaurado',
  MEETING_CREATED: 'Reunião agendada', MEETING_UPDATED: 'Reunião atualizada',
  MEETING_RESCHEDULED: 'Reunião reagendada', MEETING_STATUS_CHANGED: 'Situação da reunião alterada',
};
type EditState = { name: string; organizationName: string; phone: string; email: string; notes: string; title: string; serviceId: string; status: CrmStatus; reasonText: string };

function DetailField({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return <div className="crm-detail-field">{icon}<span><small>{label}</small><strong>{value}</strong></span></div>;
}

export function CrmOpportunityModal({ companyId, opportunity, onClose, onChanged }: { companyId: string; opportunity: CrmOpportunity; onClose: () => void; onChanged: (message: string) => void }) {
  const navigate = useNavigate();
  const access = usePermissions(companyId);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'DETAIL' | 'HISTORY'>('DETAIL');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<EditState | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const detail = useQuery({ queryKey: ['crm-opportunity', companyId, opportunity.id], queryFn: () => api.crmOpportunity(companyId, opportunity.id) });
  const history = useQuery({ queryKey: ['crm-history', companyId, opportunity.contactId], queryFn: () => api.crmHistory(companyId, opportunity.contactId), enabled: tab === 'HISTORY' });
  const services = useQuery({ queryKey: ['crm-services', companyId], queryFn: () => api.services(companyId, { search: '', status: 'ACTIVE', page: 0, limit: 100 }), enabled: edit && access.can('services.access') });
  const current = detail.data;
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.showModal();
    dialog.querySelector<HTMLElement>('.crm-detail-tabs [role="tab"]')?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      previousFocus?.focus();
    };
  }, []);
  useEffect(() => {
    if (!current || form) return;
    setForm({ name: current.lead.name, organizationName: current.lead.organizationName ?? '', phone: current.lead.phone ?? '', email: current.lead.email ?? '', notes: current.lead.notes ?? '', title: current.title, serviceId: current.primaryServiceId ?? '', status: current.commercialStatus, reasonText: current.reasonText ?? '' });
  }, [current, form]);
  const refresh = async (message: string) => {
    await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['crm-opportunities', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm-status-count', companyId] })]);
    setEdit(false); setError(''); onChanged(message);
  };
  const save = useMutation({ mutationFn: async () => {
    if (!current || !form) return;
    if (!form.name.trim() || !form.title.trim()) throw new Error('Informe o nome do lead e o título da negociação.');
    const leadPatch: Record<string, unknown> = { expectedVersion: current.lead.version };
    for (const [key, value] of Object.entries({ name: form.name.trim(), organizationName: form.organizationName.trim() || null, phone: form.phone.trim() || null, email: form.email.trim().toLowerCase() || null, notes: form.notes.trim() || null })) if (value !== current.lead[key as keyof typeof current.lead]) leadPatch[key] = value;
    if (Object.keys(leadPatch).length > 1) await api.updateCrmLead(companyId, current.lead.id, leadPatch as Parameters<typeof api.updateCrmLead>[2]);
    const cardPatch: Parameters<typeof api.updateCrmOpportunity>[2] = { expectedVersion: current.version };
    if (form.title.trim() !== current.title) cardPatch.title = form.title.trim();
    if ((form.serviceId || null) !== current.primaryServiceId) cardPatch.primaryServiceId = form.serviceId || null;
    let cardVersion = current.version;
    if (Object.keys(cardPatch).length > 1) cardVersion = (await api.updateCrmOpportunity(companyId, current.id, cardPatch)).version;
    if (form.status !== current.commercialStatus || (['LOST', 'DISQUALIFIED'].includes(form.status) && (form.reasonText.trim() || null) !== current.reasonText)) {
      await api.updateCrmStatus(companyId, current.id, { expectedVersion: cardVersion, status: form.status, ...(['LOST', 'DISQUALIFIED'].includes(form.status) ? { reasonText: form.reasonText.trim() || null } : {}) });
    }
  }, onSuccess: () => refresh('Alterações da negociação salvas.'), onError: (reason) => setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'Não foi possível salvar.') });
  const addNote = useMutation({ mutationFn: () => api.addCrmNote(companyId, opportunity.contactId, opportunity.id, note.trim(), crypto.randomUUID()), onSuccess: async () => { setNote(''); await history.refetch(); await detail.refetch(); onChanged('Nota adicionada ao histórico.'); }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar a nota.') });
  const busy = save.isPending || addNote.isPending;
  const requestClose = () => { if (!busy) onClose(); };
  const campaign = current?.origin.utmCampaign || current?.origin.sourceLabel || current?.origin.utmSource || 'Origem não informada';
  const serviceName = current?.primaryServiceId ? current.serviceName ?? 'Indisponível' : 'Não definido';
  return <dialog ref={dialogRef} className="drawer-backdrop crm-opportunity-backdrop" aria-labelledby="crm-detail-title"
    onCancel={(event) => { event.preventDefault(); requestClose(); }}
    onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}>
    <section className="drawer crm-opportunity-modal">
      <header className="drawer__header"><div><p className="eyebrow">NEGOCIAÇÃO COMERCIAL</p><h2 id="crm-detail-title">{current?.lead.name ?? opportunity.lead.name}</h2><p>{current?.title ?? opportunity.title}</p></div><button type="button" className="icon-button" onClick={requestClose} disabled={busy} aria-label="Fechar"><X size={20} /></button></header>
      <div className="crm-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'DETAIL'} className={tab === 'DETAIL' ? 'is-active' : ''} onClick={() => setTab('DETAIL')}>Dados da negociação</button><button type="button" role="tab" aria-selected={tab === 'HISTORY'} className={tab === 'HISTORY' ? 'is-active' : ''} onClick={() => setTab('HISTORY')}>Histórico</button></div>
      <div className={`drawer__body crm-detail-body${tab === 'HISTORY' ? ' crm-detail-body--history' : ''}`}>
        {detail.isPending ? <div className="crm-detail-loading"><div /><div /><div /></div> : detail.isError || !current || !form ? <div className="crm-detail-empty" role="alert"><AlertCircle size={23} /><strong>Não foi possível carregar a negociação.</strong><button type="button" onClick={() => detail.refetch()}>Tentar novamente</button></div> : tab === 'DETAIL' ? <>
          <div className={`crm-detail-hero crm-detail-hero--${current.commercialStatus.toLowerCase()}`}>
            <div className="crm-detail-hero__content">
              <UserRound size={24} aria-hidden="true" />
              <span className="crm-detail-hero__label">Etapa do funil</span>
              <strong className="crm-detail-hero__stage">{statusLabel(current.commercialStatus)}</strong>
            </div>
          </div>
          {!edit ? <div className="crm-detail-readonly">
            <section>
              <h3>Contato</h3>
              <div className="crm-detail-grid">
                <DetailField icon={<UserRound size={16} />} label="Nome" value={current.lead.name} />
                <DetailField icon={<Phone size={16} />} label="Telefone" value={current.lead.phone || 'Não informado'} />
                <DetailField icon={<Mail size={16} />} label="E-mail" value={current.lead.email || 'Não informado'} />
                <DetailField icon={<Tag size={16} />} label="Empresa" value={current.lead.organizationName || 'Não informada'} />
              </div>
            </section>
            <section>
              <h3>Negociação</h3>
              <div className="crm-detail-grid">
                <DetailField icon={<BriefcaseBusiness size={16} />} label="Serviço" value={serviceName} />
                <DetailField icon={<CircleDollarSign size={16} />} label="Preço definido" value={money(current.servicePrice)} />
                <DetailField icon={<Tag size={16} />} label="Origem" value={campaign} />
                <DetailField icon={<Clock3 size={16} />} label="Entrada" value={shortDateTime(current.origin.receivedAt)} />
              </div>
              {current.lead.notes && <p className="crm-detail-note">{current.lead.notes}</p>}
            </section>
          </div> : <form id="crm-edit-form" className="crm-detail-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
            <div className="crm-form-grid crm-form-grid--two">
              <label className="field"><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
              <label className="field"><span>Empresa</span><input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} /></label>
              <label className="field"><span>Telefone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label>
              <label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
              <label className="field crm-field--wide"><span>Título da negociação</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
              <div className="field"><span>Serviço</span><SaleDropdown label="Serviço" value={form.serviceId} disabled={!access.can('services.access')} onChange={(serviceId) => setForm({ ...form, serviceId })} options={[
                { value: '', label: 'Não definido' },
                ...(services.data?.items ?? []).map((service) => ({ value: service.id, label: service.name })),
              ]} /></div>
              <div className="field"><span>Situação</span><SaleDropdown label="Situação" value={form.status} onChange={(status) => setForm({ ...form, status })} options={CRM_STATUSES} /></div>
              {['LOST', 'DISQUALIFIED'].includes(form.status) && <label className="field crm-field--wide"><span>Motivo</span><input value={form.reasonText} onChange={(e) => setForm({ ...form, reasonText: e.target.value })} placeholder="O que encerrou esta negociação?" /></label>}
              <label className="field crm-field--wide"><span>Observações, interesses ou necessidades.</span><textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
            </div>
          </form>}
        </> : <section className="crm-history" aria-label="Histórico da negociação">
          {access.can('crm.edit') && <form className="crm-note-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); if (note.trim()) addNote.mutate(); }}>
            <label className="field" htmlFor="crm-history-note"><span><MessageSquarePlus size={16} /> Nova nota</span></label>
            <textarea id="crm-history-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={10000} placeholder="Registre o que aconteceu ou o próximo passo..." />
            <div className="crm-note-composer__actions"><button type="submit" className="button button--primary" disabled={!note.trim() || addNote.isPending}>{addNote.isPending ? 'Salvando...' : 'Adicionar ao histórico'}</button></div>
          </form>}
          {history.isPending ? <div className="crm-detail-loading"><div /><div /><div /></div> : history.isError ? <div className="crm-detail-empty" role="alert"><AlertCircle size={20} /><strong>Não foi possível carregar o histórico.</strong><button type="button" onClick={() => history.refetch()}>Tentar novamente</button></div> : history.data?.items.length ? <ol className="crm-timeline">{history.data.items.map((item) => <li key={item.id}>
            <span className="crm-timeline__dot"><Check size={11} /></span>
            <div className="crm-timeline__content"><strong>{activityNames[item.kind] ?? item.kind}</strong><small>{shortDateTime(item.recordedAt)} · {item.actorType === 'USER' ? 'Usuário' : item.actorType}</small>{item.note && <p>{item.note}</p>}</div>
          </li>)}</ol> : <div className="crm-history__empty">Nenhuma atividade registrada.</div>}
        </section>}
        {error && <div className="crm-modal__error" role="alert"><AlertCircle size={16} />{error}</div>}
      </div>
      <footer className="drawer__footer crm-opportunity-modal__footer">
        <span className="crm-opportunity-modal__updated">{current ? `Atualizado ${shortDateTime(current.updatedAt)}` : ''}</span>
        <div className="crm-opportunity-modal__actions">
          {tab === 'DETAIL' && !edit && <>
            {access.can('proposals.manage') && <button type="button" className="button button--primary" onClick={() => navigate(`/propostas?${new URLSearchParams({ negociacao: opportunity.id, empresa: companyId })}`)}><FileText size={15} /> Criar proposta</button>}
            {access.can('agenda.manage') && <button type="button" className="button button--secondary" onClick={() => navigate(`/agenda?${new URLSearchParams({ contactId: opportunity.contactId, opportunityId: opportunity.id, name: opportunity.lead.name, title: opportunity.title, companyId })}`)}><CalendarDays size={15} /> Agendar reunião</button>}
            {access.can('crm.edit') && <button type="button" className="button button--secondary" onClick={() => { setEdit(true); setError(''); }}>Editar</button>}
          </>}
          {tab === 'DETAIL' && edit && <>
            <button type="button" className="button button--secondary" onClick={() => { setEdit(false); setForm(null); setError(''); }} disabled={save.isPending}>Cancelar</button>
            <button form="crm-edit-form" type="submit" className="button button--primary" disabled={save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar alterações'}</button>
          </>}
          <button type="button" className="button button--secondary" onClick={requestClose} disabled={busy}>Fechar</button>
        </div>
      </footer>
    </section>
  </dialog>;
}
