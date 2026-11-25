import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, Bell, CalendarDays, ChevronLeft, ChevronRight, Filter, Plus, RefreshCw, Settings2, Video, MapPin, X } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { api, type Meeting, type MeetingFilters, type MeetingSettings, type MeetingStatus, type User } from '../../api/client';
import { isOverviewForbidden, useCompanyScope, useOverviewFallback } from '../../components/company-scope';
import { WorkspaceLayout } from '../../components/WorkspaceLayout';
import { permissionView, usePermissions } from '../permissions/usePermissions';
import { creationOptions } from './CompanyField';
import { MeetingDialog, type MeetingPreset } from './MeetingDialog';
import { dateInZone, formatMeetingTime, instantInZone, shiftDate, weekStart } from './meeting-time';
import './crm.css';
import './agenda.css';

const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const statuses: { value: MeetingStatus | ''; label: string }[] = [{ value: '', label: 'Todas' }, { value: 'SCHEDULED', label: 'Agendadas' }, { value: 'COMPLETED', label: 'Concluídas' }, { value: 'NO_SHOW', label: 'Não compareceu' }, { value: 'CANCELED', label: 'Canceladas' }];
const statusName: Record<MeetingStatus, string> = { SCHEDULED: 'Agendada', COMPLETED: 'Concluída', CANCELED: 'Cancelada', NO_SHOW: 'Não compareceu' };
function dayLabel(day: string) { return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`)); }
function formatWeek(first: string, last: string) { return `${dayLabel(first)} - ${dayLabel(last)}`; }
type AgendaDialog = { kind: 'create'; preset?: MeetingPreset; companyId?: string } | { kind: 'open'; meetingId: string; companyId: string };

export function AgendaPage({ user }: { user: User }) {
  const client = useQueryClient();
  const [url, setUrl] = useSearchParams();
  const [companyId, setCompanyId] = useState(() => sessionStorage.getItem('gestaonf.companyId') ?? '');
  const companies = useQuery({ queryKey: ['companies'], queryFn: api.companies });
  useEffect(() => { if (companies.data && !companies.data.some((item) => item.id === companyId)) setCompanyId(companies.data[0]?.id ?? ''); }, [companies.data, companyId]);
  useEffect(() => { if (companyId) sessionStorage.setItem('gestaonf.companyId', companyId); }, [companyId]);
  const access = usePermissions(companyId);
  const scope = useCompanyScope(user, companies.data, 'crm', 'agenda.access');
  const multiple = scope.multiple;
  const companyById = useMemo(() => new Map((companies.data ?? []).map(company => [company.id, company])), [companies.data]);
  const meetingOptions = multiple ? creationOptions(companies.data, multiple.ids, id => permissionView(companies.data, id).can('agenda.manage')) : null;
  const canManage = meetingOptions ? meetingOptions.length > 0 : access.can('agenda.manage');
  const [createCompanyId, setCreateCompanyId] = useState('');
  const profile = useQuery({ queryKey: ['company', companyId], queryFn: () => api.company(companyId), enabled: !!companyId });
  const timezone = profile.data?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [week, setWeek] = useState(() => weekStart(dateInZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone)));
  const [draft, setDraft] = useState({ search: '', status: '' as MeetingStatus | '', assignedUserId: '', modality: '' as '' | Meeting['modality'] });
  const [filters, setFilters] = useState(draft);
  const [page, setPage] = useState(0);
  const [dialog, setDialog] = useState<AgendaDialog | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const dialogCompanyId = dialog?.companyId ?? (meetingOptions ? meetingOptions.find(company => company.id === createCompanyId)?.id ?? (meetingOptions.length === 1 ? meetingOptions[0].id : '') : companyId);
  const dialogAccess = permissionView(companies.data, dialogCompanyId);
  const mayOpenDialog = dialog?.kind === 'open' ? dialogAccess.can('agenda.access') : dialog?.companyId ? dialogAccess.can('agenda.manage') : canManage;
  const dialogCompany = useQuery({ queryKey: ['company', dialogCompanyId], queryFn: () => api.company(dialogCompanyId),
    enabled: dialog?.kind === 'create' && mayOpenDialog && !!dialogCompanyId && dialogCompanyId !== companyId });
  const dialogZone = dialog?.kind === 'open' ? timezone : dialogCompanyId === companyId ? profile.data?.timezone : dialogCompany.data?.timezone;
  // A empresa do atalho é a da negociação. O formulário mantém esse vínculo.
  useEffect(() => {
    const contactId = url.get('contactId'), opportunityId = url.get('opportunityId');
    if (!contactId || !opportunityId || !companyId || !companies.data) return;
    const target = url.get('companyId') ?? companyId;
    if (permissionView(companies.data, target).can('agenda.manage')) {
      setDialog({ kind: 'create', companyId: target, preset: { contactId, opportunityId, name: url.get('name') ?? '', title: url.get('title') ?? '' } });
    }
    const next = new URLSearchParams(url);
    for (const key of ['contactId', 'opportunityId', 'companyId', 'name', 'title']) next.delete(key);
    setUrl(next, { replace: true });
  }, [url, setUrl, companies.data, companyId]);
  useEffect(() => { if (profile.data) setWeek(weekStart(dateInZone(new Date(), profile.data.timezone))); }, [profile.data?.timezone, companyId]);
  useEffect(() => { if (!message) return; const id = window.setTimeout(() => setMessage(''), 4500); return () => window.clearTimeout(id); }, [message]);
  useEffect(() => setPage(0), [multiple?.scopeKey]);
  const first = week, last = shiftDate(first, 6);
  const windowFrom = instantInZone(`${first}T00:00`, timezone);
  const windowTo = instantInZone(`${shiftDate(first, 7)}T00:00`, timezone);
  const params: MeetingFilters | null = windowFrom && windowTo ? { from: windowFrom, to: windowTo,
    ...(filters.search ? { search: filters.search } : {}), ...(filters.status ? { status: filters.status } : {}),
    ...(filters.modality ? { modality: filters.modality } : {}), ...(filters.assignedUserId ? { assignedUserId: filters.assignedUserId } : {}) } : null;
  const canList = !!companyId && access.can('agenda.access');
  const list = useQuery({ queryKey: multiple ? ['crm', 'overview', 'meetings', multiple.scopeKey, first, filters, page, timezone] : ['meetings', companyId, first, filters, page, timezone],
    queryFn: () => multiple ? api.crmOverviewMeetings(multiple.param, params!, page * 100, 100) : api.meetings(companyId, params!, page * 100, 100),
    enabled: (canList || !!multiple) && !!profile.data && !!params });
  const responsibles = useQuery({ queryKey: multiple ? ['crm', 'overview', 'responsibles', multiple.scopeKey] : ['meeting-responsibles', companyId],
    queryFn: () => multiple ? api.crmOverviewResponsibles(multiple.param) : api.meetingResponsibles(companyId), enabled: canList || !!multiple });
  useOverviewFallback(multiple, scope.clear, [list.error, responsibles.error].find(isOverviewForbidden), setMessage);
  const settings = useQuery({ queryKey: ['meeting-settings', companyId], queryFn: () => api.meetingSettings(companyId), enabled: canList && settingsOpen && !multiple });
  const notifications = useQuery({ queryKey: ['meeting-notifications', companyId], queryFn: () => api.meetingNotifications(companyId), enabled: canList, refetchInterval: 30_000 });
  const unread = notifications.data?.items.filter((item) => !item.readAt).length ?? 0;
  const read = useMutation({ mutationFn: (id: string) => api.readMeetingNotification(companyId, id), onSuccess: () => client.invalidateQueries({ queryKey: ['meeting-notifications', companyId] }) });
  const saveSettings = useMutation({ mutationFn: (input: Parameters<typeof api.updateMeetingSettings>[1]) => api.updateMeetingSettings(companyId, input), onSuccess: () => { client.invalidateQueries({ queryKey: ['meeting-settings', companyId] }); setMessage('Preferências da agenda salvas.'); }, onError: (error) => { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar as preferências.'); settings.refetch(); } });
  const logout = useMutation({ mutationFn: api.logout, onSuccess: () => { sessionStorage.removeItem('gestaonf.companyId'); client.clear(); window.location.assign('/agenda'); } });
  function chooseCompany(id: string) { scope.clear(); setCompanyId(id); setPage(0); setDialog(null); setNotificationsOpen(false); setSettingsOpen(false); setMessage(''); }
  function openCreate() {
    setCreateCompanyId(meetingOptions ? (meetingOptions.length === 1 ? meetingOptions[0].id : '') : companyId);
    setDialog({ kind: 'create' });
  }
  function renderMeeting(item: Meeting) {
    return <MeetingCard key={item.id} item={item} timezone={timezone} companyName={multiple ? companyById.get(item.companyId)?.tradeName : undefined}
      onOpen={() => setDialog({ kind: 'open', meetingId: item.id, companyId: item.companyId })} />;
  }
  function apply(event: FormEvent) { event.preventDefault(); setFilters({ ...draft, search: draft.search.trim() }); setPage(0); }
  const grouped = Array.from({ length: 7 }, (_, index) => ({ day: shiftDate(first, index), items: (list.data?.items ?? []).filter((item) => dateInZone(item.startsAt, timezone) === shiftDate(first, index)) }));
  const carried = (list.data?.items ?? []).filter((item) => dateInZone(item.startsAt, timezone) < first);
  const currentDay = dateInZone(new Date(), timezone);
  const otherZone = !!multiple && list.data?.items.some(meeting => meeting.timezone !== timezone);
  return <WorkspaceLayout user={user} companies={companies.data} companyId={companyId} onCompanyChange={chooseCompany} allowMultiple scope={scope} onLogout={() => logout.mutate()} loggingOut={logout.isPending} className="crm-workspace agenda-workspace">
    <main id="workspace-main" className="crm-main agenda-main" tabIndex={-1}>
      <header className="crm-page-header agenda-page-header"><div><span className="crm-eyebrow">RELACIONAMENTO / AGENDA COMERCIAL</span><h1>Reuniões</h1><p>Organize compromissos com seus leads e acompanhe cada próxima conversa.</p></div><div className="crm-page-header__actions"><button type="button" className="crm-refresh" onClick={() => setNotificationsOpen((value) => !value)} aria-label={unread ? `${unread} lembretes não lidos` : 'Abrir lembretes'} aria-expanded={notificationsOpen}><Bell size={17} />{unread > 0 && <span className="agenda-unread">{unread}</span>}</button>{!multiple && <button type="button" className="crm-refresh" onClick={() => setSettingsOpen((value) => !value)} aria-expanded={settingsOpen}><Settings2 size={16} /> Preferências</button>}{canManage && <button type="button" className="button button--primary" onClick={openCreate} disabled={!profile.data}><Plus size={16} /> Agendar reunião</button>}</div></header>
      {notificationsOpen && <section className="agenda-notifications" aria-label="Lembretes"><header><h2>Lembretes</h2><button type="button" aria-label="Fechar lembretes" onClick={() => setNotificationsOpen(false)}><X size={17} /></button></header>{notifications.isPending ? <p>Carregando lembretes...</p> : notifications.isError ? <p role="alert">Não foi possível carregar os lembretes.</p> : notifications.data?.items.length ? <div>{notifications.data.items.map((item) => <article key={item.id} className={item.readAt ? '' : 'is-unread'}><button type="button" onClick={() => { if (!item.readAt) read.mutate(item.id); setDialog({ kind: 'open', meetingId: item.meetingId, companyId }); setNotificationsOpen(false); }}><strong>{item.title}</strong><span>{item.body}</span><small>{formatMeetingTime(item.createdAt, timezone, { year: 'numeric' })}</small></button></article>)}</div> : <p>Nenhum lembrete por enquanto.</p>}</section>}
      {settingsOpen && !multiple && <section className="agenda-settings" aria-label="Preferências da agenda"><header><div><h2>Preferências da agenda</h2><p>Valem para a empresa selecionada.</p></div><button type="button" aria-label="Fechar preferências" onClick={() => setSettingsOpen(false)}><X size={17} /></button></header>{settings.isPending ? <p>Carregando...</p> : settings.isError ? <p role="alert">Não foi possível carregar as preferências.</p> : settings.data && <SettingsForm key={`${companyId}-${settings.data.version}`} current={settings.data} canEdit={access.can('agenda.settings')} busy={saveSettings.isPending} onSubmit={(input) => saveSettings.mutate(input)} />}</section>}
      <section className="agenda-board" aria-labelledby="agenda-week-heading"><div className="agenda-board__top"><div><span>SEMANA EM FOCO</span><h2 id="agenda-week-heading">{formatWeek(first, last)}</h2><p>Horários em {timezone}</p>{otherZone && <p className="agenda-zone-note" role="note">Algumas empresas usam outro fuso; horários exibidos em {timezone}.</p>}</div><div className="agenda-board__navigation"><button type="button" aria-label="Semana anterior" onClick={() => { setWeek(shiftDate(first, -7)); setPage(0); }}><ChevronLeft size={17} /></button><button type="button" onClick={() => { setWeek(weekStart(currentDay)); setPage(0); }}>Hoje</button><button type="button" aria-label="Próxima semana" onClick={() => { setWeek(shiftDate(first, 7)); setPage(0); }}><ChevronRight size={17} /></button></div></div><div className="agenda-board__stats"><div><strong>{list.data?.summary.scheduled ?? '-'}</strong><span>Agendadas</span></div><div><strong>{list.data?.summary.completed ?? '-'}</strong><span>Concluídas</span></div><div><strong>{list.data?.summary.noShow ?? '-'}</strong><span>Ausências</span></div><div><strong>{list.data?.summary.total ?? '-'}</strong><span>No período</span></div></div></section>
      <section className="crm-filters agenda-filters" aria-label="Filtrar reuniões"><div className="crm-filters__heading"><div><Filter size={17} /><h2>Filtrar agenda</h2></div><span>Os filtros valem para esta semana</span></div><form onSubmit={apply}><label className="crm-filter-field agenda-filter-search"><span>Lead ou reunião</span><input value={draft.search} onChange={(event) => setDraft({ ...draft, search: event.target.value })} maxLength={200} placeholder="Buscar pelo nome ou título" /></label><label className="crm-filter-field"><span>Situação</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as MeetingStatus | '' })}>{statuses.map((status) => <option key={status.value} value={status.value}>{status.label}</option>)}</select></label><label className="crm-filter-field"><span>Responsável</span><select value={draft.assignedUserId} onChange={(event) => setDraft({ ...draft, assignedUserId: event.target.value })}><option value="">Todos</option>{responsibles.data?.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="crm-filter-field"><span>Modalidade</span><select value={draft.modality} onChange={(event) => setDraft({ ...draft, modality: event.target.value as typeof draft.modality })}><option value="">Todas</option><option value="ONLINE">Online</option><option value="IN_PERSON">Presencial</option></select></label><div className="crm-filters__actions"><button type="button" onClick={() => { const blank = { search: '', status: '' as const, assignedUserId: '', modality: '' as const }; setDraft(blank); setFilters(blank); setPage(0); }}>Limpar</button><button type="submit" className="button button--primary">Aplicar filtros</button></div></form></section>
      <section className="agenda-calendar" aria-label="Calendário semanal">{list.isPending ? <div className="agenda-state"><RefreshCw size={22} className="is-spinning" /> Carregando reuniões...</div> : list.isError ? <div className="agenda-state" role="alert"><AlertCircle size={22} /> Não foi possível carregar a agenda.<button type="button" onClick={() => list.refetch()}>Tentar novamente</button></div> : <>{carried.length > 0 && <div className="agenda-carried"><strong>Iniciadas antes desta semana</strong>{carried.map(renderMeeting)}</div>}<div className="agenda-days">{grouped.map(({ day, items }, index) => <div key={day} className={`agenda-day${day === currentDay ? ' is-today' : ''}`}><header><span>{labels[index]}</span><strong>{day.slice(-2)}</strong><small>{dayLabel(day)}</small></header><div className="agenda-day__list">{items.map(renderMeeting)}{items.length === 0 && <span className="agenda-day__empty">Livre</span>}</div></div>)}</div>{(list.data?.total ?? 0) === 0 && <div className="agenda-empty"><CalendarDays size={25} /><strong>Nenhuma reunião nesta semana</strong><span>Agende um compromisso ou ajuste os filtros.</span>{canManage && <button type="button" onClick={openCreate}>Agendar reunião</button>}</div>}</>}</section>
      {list.data && list.data.total > 100 && <div className="agenda-pagination"><span>{page * 100 + 1}–{Math.min((page + 1) * 100, list.data.total)} de {list.data.total}</span><div><button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button type="button" disabled={(page + 1) * 100 >= list.data.total} onClick={() => setPage(page + 1)}>Próxima</button></div></div>}
      <p className="agenda-return"><Link to="/crm">Voltar ao banco de leads</Link></p>
    </main>
    {dialog && mayOpenDialog && <MeetingDialog key={`${dialog.kind}-${dialogCompanyId}-${dialog.kind === 'open' ? dialog.meetingId : ''}`} companyId={dialogCompanyId} timezone={dialogZone} userId={user.id}
      meetingId={dialog.kind === 'open' ? dialog.meetingId : undefined} preset={dialog.kind === 'create' ? dialog.preset : undefined}
      fixedCompanyName={dialog.kind === 'create' && dialog.preset ? companyById.get(dialogCompanyId)?.tradeName : undefined}
      companyChoice={dialog.kind === 'create' && !dialog.preset && meetingOptions ? { options: meetingOptions, onChange: setCreateCompanyId } : undefined}
      onClose={() => setDialog(null)} onSaved={setMessage} />}
    {message && <div className="action-toast" role="status"><div className="action-toast__body"><strong>Agenda</strong><span>{message}</span></div></div>}
  </WorkspaceLayout>;
}

function MeetingCard({ item, timezone, companyName, onOpen }: { item: Meeting; timezone: string; companyName?: string; onOpen: () => void }) {
  const time = new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(new Date(item.startsAt));
  return <button type="button" className={`agenda-card agenda-card--${item.status.toLowerCase()}`} onClick={onOpen} aria-label={`Abrir ${item.title}, ${item.lead.name}, ${formatMeetingTime(item.startsAt, timezone)}${companyName ? `, ${companyName}` : ''}`}><span className="agenda-card__time">{time}<span className="agenda-card__kind">{item.modality === 'ONLINE' ? <Video size={13} /> : <MapPin size={13} />}</span></span>{companyName && <small className="crm-card__company">{companyName}</small>}<strong>{item.title}</strong><span className="agenda-card__lead">{item.lead.name}</span><span className="agenda-card__foot">{item.responsible.name}<em>{statusName[item.status]}</em></span></button>;
}

function SettingsForm({ current, canEdit, busy, onSubmit }: { current: MeetingSettings; canEdit: boolean; busy: boolean; onSubmit: (input: Parameters<typeof api.updateMeetingSettings>[1]) => void }) {
  const [qualify, setQualify] = useState(current.qualifyOpportunityOnMeeting);
  const [reminder, setReminder] = useState(current.defaultReminderMinutes === null ? 'none' : String(current.defaultReminderMinutes));
  const [policy, setPolicy] = useState(current.conflictPolicy);
  return <form onSubmit={(event) => { event.preventDefault(); const patch = { expectedVersion: current.version, qualifyOpportunityOnMeeting: qualify, defaultReminderMinutes: reminder === 'none' ? null : Number(reminder), conflictPolicy: policy }; onSubmit(patch); }}><label><input type="checkbox" checked={qualify} onChange={(event) => setQualify(event.target.checked)} disabled={!canEdit || busy} /> Qualificar a negociação ao agendar</label><label>Antecedência padrão<select value={reminder} onChange={(event) => setReminder(event.target.value)} disabled={!canEdit || busy}><option value="none">Sem lembrete</option><option value="0">Na hora</option><option value="15">15 minutos</option><option value="30">30 minutos</option><option value="60">1 hora</option><option value="1440">1 dia</option></select></label><label>Conflito de horários<select value={policy} onChange={(event) => setPolicy(event.target.value as MeetingSettings['conflictPolicy'])} disabled={!canEdit || busy}><option value="WARN">Pedir confirmação</option><option value="ALLOW">Permitir sobreposição</option></select></label>{canEdit && <button type="submit" className="button button--primary" disabled={busy}>Salvar preferências</button>}</form>;
}
