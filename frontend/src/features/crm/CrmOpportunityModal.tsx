import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { AlertCircle, CalendarDays, Check, CircleDollarSign, Clock3, FileText, Mail, MessageSquarePlus, Phone, Tag, UserRound, X } from 'lucide-react';
import { api, ApiError, type CrmOpportunity, type CrmStatus } from '../../api/client';
import { CRM_STATUSES, dateOnly, money, normalizeMoney, shortDateTime, statusLabel } from './crm-utils';

const activityNames: Record<string, string> = {
  CONTACT_CREATED: 'Contato adicionado', ENTRY_RECEIVED: 'Nova entrada recebida', OPPORTUNITY_CREATED: 'Negociação criada',
  CONTACT_UPDATED: 'Dados atualizados', ASSIGNED: 'Responsável alterado', STAGE_CHANGED: 'Card movimentado',
  STATUS_CHANGED: 'Situação alterada', NOTE_ADDED: 'Nota adicionada', CUSTOMER_LINKED: 'Cliente vinculado',
  ARCHIVED: 'Registro arquivado', RESTORED: 'Registro restaurado',
  MEETING_CREATED: 'Reunião agendada', MEETING_UPDATED: 'Reunião atualizada',
  MEETING_RESCHEDULED: 'Reunião reagendada', MEETING_STATUS_CHANGED: 'Situação da reunião alterada',
};
type EditState = { name: string; organizationName: string; phone: string; email: string; notes: string; title: string; amount: string; expectedCloseOn: string; serviceId: string; status: CrmStatus; reasonText: string };

export function CrmOpportunityModal({ companyId, opportunity, onClose, onChanged }: { companyId: string; opportunity: CrmOpportunity; onClose: () => void; onChanged: (message: string) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'DETAIL' | 'HISTORY'>('DETAIL');
  const [edit, setEdit] = useState(false);
  const [form, setForm] = useState<EditState | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const detail = useQuery({ queryKey: ['crm-opportunity', companyId, opportunity.id], queryFn: () => api.crmOpportunity(companyId, opportunity.id) });
  const history = useQuery({ queryKey: ['crm-history', companyId, opportunity.contactId], queryFn: () => api.crmHistory(companyId, opportunity.contactId), enabled: tab === 'HISTORY' });
  const services = useQuery({ queryKey: ['crm-services', companyId], queryFn: () => api.services(companyId, { search: '', status: 'ACTIVE', page: 0, limit: 100 }), enabled: edit });
  const current = detail.data;
  const busy = false;
  useEffect(() => {
    const overflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', close);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', close); };
  }, [busy, onClose]);
  useEffect(() => {
    if (!current || form) return;
    setForm({ name: current.lead.name, organizationName: current.lead.organizationName ?? '', phone: current.lead.phone ?? '', email: current.lead.email ?? '', notes: current.lead.notes ?? '', title: current.title, amount: current.estimatedAmount ?? '', expectedCloseOn: current.expectedCloseOn ?? '', serviceId: current.primaryServiceId ?? '', status: current.commercialStatus, reasonText: current.reasonText ?? '' });
  }, [current, form]);
  const refresh = async (message: string) => {
    await Promise.all([detail.refetch(), queryClient.invalidateQueries({ queryKey: ['crm-opportunities', companyId] }), queryClient.invalidateQueries({ queryKey: ['crm-status-count', companyId] })]);
    setEdit(false); setError(''); onChanged(message);
  };
  const save = useMutation({ mutationFn: async () => {
    if (!current || !form) return;
    if (!form.name.trim() || !form.title.trim()) throw new Error('Informe o nome do lead e o título da negociação.');
    const estimatedAmount = normalizeMoney(form.amount);
    if (estimatedAmount === undefined) throw new Error('Informe um valor estimado válido.');
    const leadPatch: Record<string, unknown> = { expectedVersion: current.lead.version };
    for (const [key, value] of Object.entries({ name: form.name.trim(), organizationName: form.organizationName.trim() || null, phone: form.phone.trim() || null, email: form.email.trim().toLowerCase() || null, notes: form.notes.trim() || null })) if (value !== current.lead[key as keyof typeof current.lead]) leadPatch[key] = value;
    if (Object.keys(leadPatch).length > 1) await api.updateCrmLead(companyId, current.lead.id, leadPatch as Parameters<typeof api.updateCrmLead>[2]);
    const cardPatch: Parameters<typeof api.updateCrmOpportunity>[2] = { expectedVersion: current.version };
    if (form.title.trim() !== current.title) cardPatch.title = form.title.trim();
    if ((form.serviceId || null) !== current.primaryServiceId) cardPatch.primaryServiceId = form.serviceId || null;
    if (estimatedAmount !== current.estimatedAmount) cardPatch.estimatedAmount = estimatedAmount;
    if ((form.expectedCloseOn || null) !== current.expectedCloseOn) cardPatch.expectedCloseOn = form.expectedCloseOn || null;
    let cardVersion = current.version;
    if (Object.keys(cardPatch).length > 1) cardVersion = (await api.updateCrmOpportunity(companyId, current.id, cardPatch)).version;
    if (form.status !== current.commercialStatus || (['LOST', 'DISQUALIFIED'].includes(form.status) && (form.reasonText.trim() || null) !== current.reasonText)) {
      await api.updateCrmStatus(companyId, current.id, { expectedVersion: cardVersion, status: form.status, ...(['LOST', 'DISQUALIFIED'].includes(form.status) ? { reasonText: form.reasonText.trim() || null } : {}) });
    }
  }, onSuccess: () => refresh('Alterações da negociação salvas.'), onError: (reason) => setError(reason instanceof ApiError || reason instanceof Error ? reason.message : 'Não foi possível salvar.') });
  const addNote = useMutation({ mutationFn: () => api.addCrmNote(companyId, opportunity.contactId, opportunity.id, note.trim(), crypto.randomUUID()), onSuccess: async () => { setNote(''); await history.refetch(); await detail.refetch(); onChanged('Nota adicionada ao histórico.'); }, onError: (reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível adicionar a nota.') });
  const campaign = current?.origin.utmCampaign || current?.origin.sourceLabel || current?.origin.utmSource || 'Origem não informada';
  const statusItems = useMemo(() => CRM_STATUSES, []);
  return <div className="crm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !save.isPending && !addNote.isPending) onClose(); }}>
    <section className="crm-modal crm-modal--detail" role="dialog" aria-modal="true" aria-labelledby="crm-detail-title">
      <header className="crm-modal__header crm-modal__header--detail"><div><span>NEGOCIAÇÃO COMERCIAL</span><h2 id="crm-detail-title">{current?.lead.name ?? opportunity.lead.name}</h2><p>{current?.title ?? opportunity.title}</p></div><button type="button" onClick={onClose} disabled={save.isPending || addNote.isPending} aria-label="Fechar"><X size={20} /></button></header>
      <div className="crm-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'DETAIL'} className={tab === 'DETAIL' ? 'is-active' : ''} onClick={() => setTab('DETAIL')}>Dados da negociação</button><button type="button" role="tab" aria-selected={tab === 'HISTORY'} className={tab === 'HISTORY' ? 'is-active' : ''} onClick={() => setTab('HISTORY')}>Histórico</button></div>
      <div className="crm-modal__body crm-detail-body">
        {detail.isPending ? <div className="crm-detail-loading"><div /><div /><div /></div> : detail.isError || !current || !form ? <div className="crm-detail-empty" role="alert"><AlertCircle size={23} /><strong>Não foi possível carregar a negociação.</strong><button type="button" onClick={() => detail.refetch()}>Tentar novamente</button></div> : tab === 'DETAIL' ? <>
          <div className="crm-detail-hero"><span className={`crm-status crm-status--${current.commercialStatus.toLowerCase()}`}>{statusLabel(current.commercialStatus)}</span><strong>{money(current.estimatedAmount)}</strong><small>Valor estimado</small></div>
          {!edit ? <div className="crm-detail-readonly">
            <section><h3>Contato</h3><div className="crm-detail-grid"><div><UserRound size={16} /><span><small>Nome</small><strong>{current.lead.name}</strong></span></div><div><Phone size={16} /><span><small>Telefone</small><strong>{current.lead.phone || 'Não informado'}</strong></span></div><div><Mail size={16} /><span><small>E-mail</small><strong>{current.lead.email || 'Não informado'}</strong></span></div><div><Tag size={16} /><span><small>Empresa</small><strong>{current.lead.organizationName || 'Não informada'}</strong></span></div></div></section>
            <section><h3>Negociação</h3><div className="crm-detail-grid"><div><CircleDollarSign size={16} /><span><small>Valor estimado</small><strong>{money(current.estimatedAmount)}</strong></span></div><div><CalendarDays size={16} /><span><small>Fechamento previsto</small><strong>{dateOnly(current.expectedCloseOn)}</strong></span></div><div><Tag size={16} /><span><small>Origem</small><strong>{campaign}</strong></span></div><div><Clock3 size={16} /><span><small>Entrada</small><strong>{shortDateTime(current.origin.receivedAt)}</strong></span></div></div>{current.lead.notes && <p className="crm-detail-note">{current.lead.notes}</p>}</section>
          </div> : <form id="crm-edit-form" className="crm-detail-form" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}><div className="crm-form-grid crm-form-grid--two"><label className="field"><span>Nome</span><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label className="field"><span>Empresa</span><input value={form.organizationName} onChange={(e) => setForm({ ...form, organizationName: e.target.value })} /></label><label className="field"><span>Telefone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></label><label className="field"><span>E-mail</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label className="field crm-field--wide"><span>Título da negociação</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><label className="field"><span>Serviço</span><select value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}><option value="">Não definido</option>{services.data?.items.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label className="field"><span>Valor estimado</span><input inputMode="decimal" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></label><label className="field"><span>Previsão de fechamento</span><input type="date" value={form.expectedCloseOn} onChange={(e) => setForm({ ...form, expectedCloseOn: e.target.value })} /></label><label className="field"><span>Situação</span><select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as CrmStatus })}>{statusItems.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{['LOST', 'DISQUALIFIED'].includes(form.status) && <label className="field crm-field--wide"><span>Motivo</span><input value={form.reasonText} onChange={(e) => setForm({ ...form, reasonText: e.target.value })} placeholder="O que encerrou esta negociação?" /></label>}<label className="field crm-field--wide"><span>Observações</span><textarea rows={4} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label></div></form>}
        </> : <div className="crm-history">
          <form className="crm-note-composer" onSubmit={(event: FormEvent) => { event.preventDefault(); if (note.trim()) addNote.mutate(); }}><label><MessageSquarePlus size={17} /><span>Nova nota</span></label><textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={10000} placeholder="Registre o que aconteceu ou o próximo passo..." /><button className="button button--primary" disabled={!note.trim() || addNote.isPending}>{addNote.isPending ? 'Salvando...' : 'Adicionar ao histórico'}</button></form>
          {history.isPending ? <div className="crm-detail-loading"><div /><div /><div /></div> : history.isError ? <div className="crm-detail-empty"><AlertCircle size={20} /><strong>Não foi possível carregar o histórico.</strong></div> : <ol className="crm-timeline">{history.data?.items.map((item) => <li key={item.id}><span className="crm-timeline__dot"><Check size={11} /></span><div><strong>{activityNames[item.kind] ?? item.kind}</strong><small>{shortDateTime(item.recordedAt)} · {item.actorType === 'USER' ? 'Usuário' : item.actorType}</small>{item.note && <p>{item.note}</p>}</div></li>)}</ol>}
        </div>}
        {error && <div className="crm-modal__error" role="alert"><AlertCircle size={16} />{error}</div>}
      </div>
      <footer className="crm-modal__footer"><span>{current ? `Atualizado ${shortDateTime(current.updatedAt)}` : ''}</span><div>{tab === 'DETAIL' && !edit && <><button type="button" className="button button--primary" onClick={() => navigate(`/propostas?negociacao=${opportunity.id}`)}><FileText size={15} /> Criar proposta</button><button type="button" className="button button--secondary" onClick={() => navigate(`/agenda?${new URLSearchParams({ contactId: opportunity.contactId, opportunityId: opportunity.id, name: opportunity.lead.name, title: opportunity.title })}`)}><CalendarDays size={15} /> Agendar reunião</button><button type="button" className="button button--secondary" onClick={() => { setEdit(true); setError(''); }}>Editar</button></>}{tab === 'DETAIL' && edit && <><button type="button" className="button button--secondary" onClick={() => { setEdit(false); setForm(null); setError(''); }} disabled={save.isPending}>Cancelar</button><button form="crm-edit-form" type="submit" className="button button--primary" disabled={save.isPending}>{save.isPending ? 'Salvando...' : 'Salvar alterações'}</button></>}<button type="button" className="button button--secondary" onClick={onClose}>Fechar</button></div></footer>
    </section>
  </div>;
}
