import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CalendarClock, Clock3, History, Link2, Plus, RotateCcw, X } from 'lucide-react';
import { api, ApiError, type MeetingConflict, type MeetingParticipant, type MeetingStatus } from '../../api/client';
import { RegistrationDialog } from '../../components/RegistrationDialog';
import { PERMISSION_DENIED_MESSAGE } from '@gestaonf/permissions';
import { usePermissions } from '../permissions/usePermissions';
import { CompanyField, type CompanyChoice } from './CompanyField';
import { formatMeetingTime, instantInZone, localInZone } from './meeting-time';

type Form = { contactId: string; opportunityId: string; assignedUserId: string; startsAt: string; endsAt: string; meetingUrl: string; reminderMinutes: number[]; participants: MeetingParticipant[] };
const empty = (): Form => ({ contactId: '', opportunityId: '', assignedUserId: '', startsAt: '', endsAt: '', meetingUrl: '', reminderMinutes: [30], participants: [] });
const nullable = (value: string) => value.trim() || null;
const statusText: Record<MeetingStatus, string> = { SCHEDULED: 'Agendada', COMPLETED: 'Concluída', CANCELED: 'Cancelada', NO_SHOW: 'Não compareceu' };
const eventText: Record<string, string> = { CREATED: 'Reunião criada', UPDATED: 'Dados atualizados', RESCHEDULED: 'Horário alterado', STATUS_CHANGED: 'Situação alterada' };
export type MeetingPreset = { contactId: string; opportunityId: string; name: string; opportunityTitle: string };

function defaultTimes(timezone: string) {
  const now = localInZone(new Date().toISOString(), timezone);
  const startsAt = new Date(Date.parse(`${now}:00Z`) + 60 * 60_000).toISOString().slice(0, 16);
  const endsAt = new Date(Date.parse(`${startsAt}:00Z`) + 60 * 60_000).toISOString().slice(0, 16);
  return { startsAt, endsAt };
}

export function MeetingDialog({ companyId, timezone, userId, meetingId, preset, companyChoice, fixedCompanyName, onClose, onSaved }: {
  companyId: string; timezone?: string; userId: string; meetingId?: string;
  preset?: MeetingPreset; companyChoice?: CompanyChoice; fixedCompanyName?: string;
  onClose: () => void; onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const access = usePermissions(companyId);
  const manage = access.can('agenda.manage'), assign = access.can('crm.assign');
  const creationKey = useRef(crypto.randomUUID());
  const detail = useQuery({ queryKey: ['meeting', companyId, meetingId], queryFn: () => api.meeting(companyId, meetingId!), enabled: !!companyId && !!meetingId });
  const responsibles = useQuery({ queryKey: ['meeting-responsibles', companyId], queryFn: () => api.meetingResponsibles(companyId), enabled: !!companyId });
  const [tab, setTab] = useState<'DETAIL' | 'HISTORY'>('DETAIL');
  const history = useQuery({ queryKey: ['meeting-history', companyId, meetingId], queryFn: () => api.meetingHistory(companyId, meetingId!), enabled: !!companyId && !!meetingId && tab === 'HISTORY' });
  const [form, setForm] = useState<Form>(() => ({ ...empty(), contactId: preset?.contactId ?? '', opportunityId: preset?.opportunityId ?? '',
    assignedUserId: userId, ...(timezone && !meetingId ? defaultTimes(timezone) : {}) }));
  const [contactSearch, setContactSearch] = useState(preset?.name ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState(preset?.name ?? '');
  const [chosenContact, setChosenContact] = useState(preset?.name ?? '');
  const leads = useQuery({ queryKey: ['meeting-leads', companyId, debouncedSearch], queryFn: () => api.crmLeads(companyId, debouncedSearch), enabled: !!companyId && !meetingId && debouncedSearch.length >= 2 && !chosenContact });
  const opportunities = useQuery({ queryKey: ['meeting-opportunities', companyId, form.contactId], queryFn: () => api.crmOpportunities(companyId, { contactId: form.contactId }, 0, 100), enabled: !!companyId && !meetingId && !!form.contactId });
  const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<MeetingConflict[]>([]);
  const [confirmedConflict, setConfirmedConflict] = useState(false);
  const [result, setResult] = useState('');
  const [nextSteps, setNextSteps] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [statusAction, setStatusAction] = useState<MeetingStatus | 'REOPEN' | null>(null);
  const current = detail.data;
  const selected = current;
  const activeTimezone = current?.timezone ?? timezone;
  const displayTimezone = activeTimezone ?? 'UTC';
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!meetingId && timezone) setForm(current => current.startsAt ? current : { ...current, ...defaultTimes(timezone) });
  }, [meetingId, timezone]);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(contactSearch.trim()), 250); return () => window.clearTimeout(timer); }, [contactSearch]);
  useEffect(() => {
    if (!current || loaded) return;
    setForm({ contactId: current.contactId, opportunityId: current.opportunityId ?? '',
      assignedUserId: current.assignedUserId, startsAt: localInZone(current.startsAt, current.timezone), endsAt: localInZone(current.endsAt, current.timezone),
      meetingUrl: current.meetingUrl ?? '',
      reminderMinutes: current.reminderMinutes, participants: current.participants });
    setContactSearch(current.lead.name); setChosenContact(current.lead.name); setResult(current.outcomeNotes ?? ''); setNextSteps(current.nextSteps ?? ''); setCancelReason(current.cancellationReason ?? ''); setLoaded(true);
  }, [current, loaded, timezone]);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => { creationKey.current = crypto.randomUUID(); setForm((old) => ({ ...old, [key]: value })); setError(''); setConflicts([]); setConfirmedConflict(false); };
  const refresh = async (message: string) => {
    await Promise.all([client.invalidateQueries({ queryKey: ['meetings', companyId] }), client.invalidateQueries({ queryKey: ['meeting', companyId, meetingId] }), client.invalidateQueries({ queryKey: ['meeting-history', companyId, meetingId] }), client.invalidateQueries({ queryKey: ['crm-opportunities', companyId] }), client.invalidateQueries({ queryKey: ['crm-status-count', companyId] }), client.invalidateQueries({ queryKey: ['crm', 'overview'] })]);
    onSaved(message);
  };
  const save = useMutation({ mutationFn: async () => {
    if (!companyId || !activeTimezone) throw new Error('Selecione a empresa para agendar a reunião.');
    const startsAt = instantInZone(form.startsAt, activeTimezone), endsAt = instantInZone(form.endsAt, activeTimezone);
    if (!form.contactId || !form.assignedUserId) throw new Error('Informe o lead e o responsável.');
    if (!startsAt || !endsAt) throw new Error('Informe horários válidos no fuso da empresa.');
    if (endsAt <= startsAt) throw new Error('O término deve ser posterior ao início.');
    if (form.meetingUrl.trim() && !/^https?:\/\//i.test(form.meetingUrl.trim())) throw new Error('O link precisa começar com https:// ou http://.');
    if (form.participants.some((person) => person.kind === 'EXTERNAL' && !person.name?.trim() && !person.email?.trim() && !person.phone?.trim())) throw new Error('Preencha o nome ou e-mail de cada participante externo.');
    if (!confirmedConflict) {
      const availability = await api.meetingConflicts(companyId, { assignedUserId: form.assignedUserId, startsAt, endsAt, ...(meetingId ? { excludeMeetingId: meetingId } : {}) });
      if (availability.hasConflict) { setConflicts(availability.items); throw new Error('Existe outro compromisso neste horário. Revise e confirme se deseja manter a sobreposição.'); }
    }
    if (!meetingId) {
      const created = await api.createMeeting(companyId, { contactId: form.contactId, opportunityId: form.opportunityId || null, assignedUserId: form.assignedUserId,
        startsAt, endsAt, timezone: activeTimezone, meetingUrl: nullable(form.meetingUrl),
        participants: form.participants, reminderMinutes: form.reminderMinutes, allowConflict: confirmedConflict }, creationKey.current);
      return created.opportunityQualified ? 'Reunião agendada e negociação qualificada.' : 'Reunião agendada.';
    }
    if (!selected) throw new Error('Recarregue os dados da reunião.');
    const content = { assignedUserId: form.assignedUserId, meetingUrl: nullable(form.meetingUrl),
      participants: form.participants, reminderMinutes: form.reminderMinutes };
    const contentChanged = Object.entries(content).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(selected[key as keyof typeof selected]));
    let version = selected.version;
    if (contentChanged) version = (await api.updateMeeting(companyId, meetingId, { expectedVersion: version, allowConflict: confirmedConflict, ...content })).version;
    if (startsAt !== new Date(selected.startsAt).toISOString() || endsAt !== new Date(selected.endsAt).toISOString()) {
      await api.rescheduleMeeting(companyId, meetingId, { expectedVersion: version, startsAt, endsAt, timezone: activeTimezone, allowConflict: confirmedConflict });
    }
    return 'Reunião atualizada.';
  }, onSuccess: refresh, onError: (reason) => {
    if (reason instanceof ApiError && reason.status === 409) detail.refetch();
    setError(reason instanceof Error ? reason.message : 'Não foi possível salvar a reunião.');
  } });
  const changeStatus = useMutation({ mutationFn: async () => {
    if (!meetingId || !selected || !statusAction) return;
    if (statusAction === 'REOPEN') {
      const availability = await api.meetingConflicts(companyId, { assignedUserId: selected.assignedUserId, startsAt: selected.startsAt, endsAt: selected.endsAt, excludeMeetingId: meetingId });
      if (availability.hasConflict && !confirmedConflict) { setConflicts(availability.items); throw new Error('Existe outro compromisso neste horário. Confirme a sobreposição para reabrir.'); }
      return api.reopenMeeting(companyId, meetingId, selected.version, confirmedConflict);
    }
    return api.changeMeetingStatus(companyId, meetingId, { expectedVersion: selected.version, status: statusAction,
      ...(statusAction === 'COMPLETED' ? { outcomeNotes: nullable(result), nextSteps: nullable(nextSteps) } : {}),
      ...(statusAction === 'CANCELED' ? { cancellationReason: nullable(cancelReason) } : {}) });
  }, onSuccess: async () => { setStatusAction(null); setConfirmedConflict(false); setConflicts([]); await refresh('Situação da reunião atualizada.'); await detail.refetch(); }, onError: (reason) => {
    if (reason instanceof ApiError && reason.status === 409) detail.refetch();
    setError(reason instanceof Error ? reason.message : 'Não foi possível alterar a situação.');
  } });
  const busy = save.isPending || changeStatus.isPending;
  const canEdit = manage && !!companyId && !!activeTimezone && (!meetingId || selected?.status === 'SCHEDULED');
  const toggleReminder = (minutes: number) => set('reminderMinutes', form.reminderMinutes.includes(minutes) ? form.reminderMinutes.filter((item) => item !== minutes) : [...form.reminderMinutes, minutes].sort((a, b) => a - b));
  return <RegistrationDialog
    eyebrow={meetingId ? 'AGENDA COMERCIAL / COMPROMISSO' : 'AGENDA COMERCIAL'}
    title={meetingId ? 'Detalhes da reunião' : 'Agendar reunião'}
    description={meetingId ? current && `${current.lead.name} · ${statusText[current.status]}` : 'Escolha o lead, reserve o horário e configure os lembretes.'}
    panelClassName="agenda-dialog"
    initialFocus={meetingId ? '.crm-detail-tabs [role="tab"]' : undefined}
    dismissDisabled={busy}
    closeOnSuccess={save.isSuccess}
    onClose={onClose}
  >
    {(requestClose) => <>
      {meetingId && <div className="crm-detail-tabs" role="tablist"><button type="button" role="tab" aria-selected={tab === 'DETAIL'} className={tab === 'DETAIL' ? 'is-active' : ''} onClick={() => setTab('DETAIL')}>Dados da reunião</button><button type="button" role="tab" aria-selected={tab === 'HISTORY'} className={tab === 'HISTORY' ? 'is-active' : ''} onClick={() => setTab('HISTORY')}>Histórico</button></div>}
      <form onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (tab === 'DETAIL' && canEdit && !busy) save.mutate();
      }}>
        <div className="drawer__body agenda-dialog__body">
          {detail.isPending && meetingId ? <div className="crm-detail-loading"><div /><div /><div /></div> : detail.isError ? <div className="crm-detail-empty" role="alert"><AlertCircle size={20} /><strong>Não foi possível carregar a reunião.</strong><button type="button" onClick={() => detail.refetch()}>Tentar novamente</button></div> : tab === 'HISTORY' ? <div className="agenda-history"><h3><History size={17} /> Histórico do compromisso</h3>{history.isPending ? <p>Carregando...</p> : history.isError ? <p role="alert">Não foi possível carregar o histórico.</p> : <ol>{history.data?.items.map((event) => <li key={event.id}><strong>{eventText[event.kind] ?? event.kind}</strong><span>{formatMeetingTime(event.occurredAt, displayTimezone, { year: 'numeric' })} · {event.actorType === 'USER' ? 'Usuário' : event.actorType}</span></li>)}</ol>}</div> : <>
            {companyChoice && <CompanyField choice={companyChoice} value={companyId} disabled={busy} />}
            {fixedCompanyName && <p className="crm-company-field">Empresa <strong>{fixedCompanyName}</strong></p>}
            <fieldset className="crm-fieldset" disabled={busy || !companyId || !activeTimezone}>
              <div className="form-section-heading"><CalendarClock size={18} /><h3>Reunião</h3></div>
              <div className="form-grid form-grid--two agenda-form-grid">
                {meetingId ? (
                  <div className="agenda-lead-fixed crm-field--wide">
                    <strong>{current?.lead.name}</strong>
                    <span>{current?.opportunity?.title ?? 'Sem negociação vinculada'}</span>
                    {current?.lead.phone && <small>{current.lead.phone}</small>}
                  </div>
                ) : (
                  <>
                    <div className="field crm-field--wide agenda-contact-search">
                      <span>Lead</span>
                      <input
                        aria-label="Lead"
                        value={contactSearch}
                        onChange={(event) => {
                          setContactSearch(event.target.value);
                          setChosenContact('');
                          set('contactId', '');
                          set('opportunityId', '');
                        }}
                        placeholder="Busque pelo nome, telefone ou e-mail"
                        autoComplete="off"
                        required
                      />
                      {!chosenContact && leads.data && (
                        <div className="agenda-contact-results" role="listbox">
                          {leads.data.items.map((lead) => (
                            <button type="button" role="option" aria-selected={false} key={lead.id} onClick={() => {
                              set('contactId', lead.id);
                              set('opportunityId', '');
                              setContactSearch(lead.name);
                              setChosenContact(lead.name);
                            }}>
                              <strong>{lead.name}</strong>
                              <small>{lead.organizationName || lead.email || lead.phone || 'Contato individual'}</small>
                            </button>
                          ))}
                          {leads.data.items.length === 0 && <p>Nenhum lead encontrado.</p>}
                        </div>
                      )}
                    </div>
                    <label className="field">
                      <span>Negociação vinculada</span>
                      <select value={form.opportunityId} onChange={(event) => set('opportunityId', event.target.value)} disabled={!form.contactId}>
                        <option value="">Sem negociação</option>
                        {opportunities.data?.items.map((opportunity) => <option key={opportunity.id} value={opportunity.id}>{opportunity.title}</option>)}
                        {preset?.opportunityId && !opportunities.data?.items.some((item) => item.id === preset.opportunityId) && (
                          <option value={preset.opportunityId}>{preset.opportunityTitle}</option>
                        )}
                      </select>
                    </label>
                  </>
                )}
                <label className={meetingId ? 'field crm-field--wide' : 'field'}>
                  <span>Responsável</span>
                  <select value={form.assignedUserId} onChange={(event) => set('assignedUserId', event.target.value)} disabled={!canEdit || !assign} aria-describedby={canEdit && !assign ? 'agenda-assignee-hint' : undefined}>
                    {responsibles.data?.items.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
                    {form.assignedUserId && !responsibles.data?.items.some((person) => person.id === form.assignedUserId) && (
                      <option value={form.assignedUserId}>{current?.responsible.name ?? 'Responsável atual'}</option>
                    )}
                  </select>
                  {canEdit && !assign && <small id="agenda-assignee-hint" className="field-hint">{PERMISSION_DENIED_MESSAGE}</small>}
                </label>
                <label className="field">
                  <span>Início</span>
                  <input type="datetime-local" value={form.startsAt} onChange={(event) => set('startsAt', event.target.value)} required disabled={!canEdit} />
                </label>
                <label className="field">
                  <span>Término</span>
                  <input type="datetime-local" value={form.endsAt} onChange={(event) => set('endsAt', event.target.value)} required disabled={!canEdit} />
                </label>
                <label className="field crm-field--wide">
                  <span>Link da reunião</span>
                  <input type="url" value={form.meetingUrl} onChange={(event) => set('meetingUrl', event.target.value)} placeholder="https://..." maxLength={2000} disabled={!canEdit} />
                </label>
              </div>
              <div className="form-section-heading"><Clock3 size={18} /><h3>Notificação de aviso</h3></div>
              <div className="agenda-reminders">{[[0, 'Na hora'], [15, '15 min'], [30, '30 min'], [60, '1 hora'], [1440, '1 dia']] .map(([minutes, label]) => <button type="button" key={minutes} className={form.reminderMinutes.includes(Number(minutes)) ? 'is-active' : ''} aria-pressed={form.reminderMinutes.includes(Number(minutes))} onClick={() => toggleReminder(Number(minutes))} disabled={!canEdit}>{label}</button>)}</div>
              <div className="form-section-heading"><Plus size={18} /><h3>Participantes externos</h3></div>
              <div className="agenda-participants">{form.participants.map((participant, index) => participant.kind === 'EXTERNAL' ? <div key={index}><input aria-label={`Nome do participante ${index + 1}`} value={participant.name ?? ''} onChange={(event) => set('participants', form.participants.map((item, i) => i === index && item.kind === 'EXTERNAL' ? { ...item, name: event.target.value || null } : item))} placeholder="Nome" disabled={!canEdit} /><input aria-label={`E-mail do participante ${index + 1}`} type="email" value={participant.email ?? ''} onChange={(event) => set('participants', form.participants.map((item, i) => i === index && item.kind === 'EXTERNAL' ? { ...item, email: event.target.value || null } : item))} placeholder="E-mail" disabled={!canEdit} /><button type="button" aria-label={`Remover participante ${index + 1}`} onClick={() => set('participants', form.participants.filter((_, i) => i !== index))} disabled={!canEdit}><X size={16} /></button></div> : <p key={index}>{participant.kind === 'USER' ? 'Usuário interno' : 'Contato'} vinculado</p>)}</div>{canEdit && <button type="button" className="agenda-add-participant" onClick={() => set('participants', [...form.participants, { kind: 'EXTERNAL', name: null, email: null, phone: null }])}><Plus size={14} /> Adicionar participante</button>}
            </fieldset>
            {meetingId && selected && <section className="agenda-status-section"><h3>Situação <span className={`agenda-status agenda-status--${selected.status.toLowerCase()}`}>{statusText[selected.status]}</span></h3>{selected.status === 'SCHEDULED' ? (manage && <div className="agenda-status-actions"><button type="button" onClick={() => { setStatusAction('COMPLETED'); setError(''); }}>Concluir</button><button type="button" onClick={() => { setStatusAction('NO_SHOW'); setError(''); }}>Não compareceu</button><button type="button" onClick={() => { setStatusAction('CANCELED'); setError(''); }}>Cancelar</button></div>) : <><p>{selected.outcomeNotes || selected.cancellationReason || 'Compromisso encerrado.'}</p>{manage && <button type="button" className="agenda-reopen" onClick={() => { setStatusAction('REOPEN'); setError(''); }}><RotateCcw size={15} /> Reabrir reunião</button>}</>}{statusAction && <div className="agenda-status-confirm"><strong>{statusAction === 'REOPEN' ? 'Reabrir este compromisso?' : `Marcar como ${statusText[statusAction].toLowerCase()}?`}</strong>{statusAction === 'COMPLETED' && <><textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="Resultado da reunião" rows={2} maxLength={10000} /><textarea value={nextSteps} onChange={(event) => setNextSteps(event.target.value)} placeholder="Próximos passos" rows={2} maxLength={10000} /></>}{statusAction === 'CANCELED' && <textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Motivo do cancelamento" rows={2} maxLength={1000} />}<div><button type="button" className="button button--secondary" onClick={() => { setStatusAction(null); setConflicts([]); setError(''); }}>Voltar</button><button type="button" className="button button--primary" disabled={busy} onClick={() => changeStatus.mutate()}>Confirmar</button></div></div>}</section>}
            {conflicts.length > 0 && <div className="agenda-conflicts" role="alert"><AlertCircle size={17} /><div><strong>Horário ocupado para este responsável</strong>{conflicts.map((item) => <p key={item.id}>{formatMeetingTime(item.startsAt, displayTimezone)}–{formatMeetingTime(item.endsAt, displayTimezone, { hour: '2-digit', minute: '2-digit' })}</p>)}<button type="button" onClick={() => { creationKey.current = crypto.randomUUID(); setConfirmedConflict(true); setError(''); }}>Confirmar sobreposição</button></div></div>}
            {confirmedConflict && <p className="agenda-conflict-accepted">Sobreposição confirmada para o próximo envio.</p>}
            {meetingId && current?.meetingUrl && <a className="agenda-open-link" href={current.meetingUrl} target="_blank" rel="noopener noreferrer"><Link2 size={14} /> Abrir reunião online</a>}
          </>}
        </div>
        {tab === 'DETAIL' && error && <div className="drawer__save-feedback" role="alert">{error}</div>}
        <footer className="drawer__footer">
          <button type="button" className="button button--secondary" onClick={requestClose} disabled={busy}>{meetingId ? 'Fechar' : 'Cancelar'}</button>
          {tab === 'DETAIL' && canEdit && (
            <button type="submit" className="button button--primary" disabled={busy}>
              {save.isPending ? 'Salvando...' : meetingId ? 'Salvar alterações' : 'Agendar reunião'}
            </button>
          )}
        </footer>
      </form>
    </>}
  </RegistrationDialog>;
}

