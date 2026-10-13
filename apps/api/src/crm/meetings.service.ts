import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { companyUsers, crmActivities, crmContacts, crmMeetingEvents, crmMeetingParticipants, crmMeetingReminders, crmMeetings, crmOpportunities, crmSettings, users } from '@gestaonf/database/schema';
import { and, asc, count, desc, eq, gt, ilike, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { changedFields, commandHash, expectVersion, escapeLike, lockKeys, type CrmDb, type CrmTx } from './crm-normalization.js';
import { CrmPolicyService, type CrmAccess } from './crm-policy.service.js';
import type { CrmContext } from './crm.schemas.js';
import type { ConflictInput, CreateMeeting, MeetingListInput, MeetingStatusInput, RescheduleMeeting, UpdateMeeting } from './meeting.schemas.js';
import { MeetingReminderService } from './meeting-reminder.service.js';

type Meeting = typeof crmMeetings.$inferSelect;
type Participant = CreateMeeting['participants'][number];
export type MeetingContext = CrmContext & { actorType?: 'USER' | 'NERO'; causeReference?: string };
type Access = CrmAccess & { actorType: 'USER' | 'NERO'; causeReference?: string };
const publicMeeting = ({ commandNamespace: _namespace, idempotencyKey: _key, requestHash: _hash, creationResult: _result, ...rest }: Meeting) => rest;

@Injectable()
export class MeetingsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CrmPolicyService) private readonly policy: CrmPolicyService,
    @Inject(MeetingReminderService) private readonly reminders: MeetingReminderService) {}

  private async access(ctx: MeetingContext, db: CrmDb = this.database.db): Promise<Access> {
    return { ...await this.policy.access(ctx, db), actorType: ctx.actorType ?? 'USER', causeReference: ctx.causeReference };
  }
  private settings(a: CrmAccess, db: CrmDb) {
    return db.select().from(crmSettings).where(eq(crmSettings.companyId, a.companyId)).limit(1)
      .then(([row]) => row ?? { companyId: a.companyId, qualifyOpportunityOnMeeting: true, defaultReminderMinutes: 30, conflictPolicy: 'WARN', version: 1, createdAt: null, updatedAt: null });
  }
  private async activeMember(a: CrmAccess, id: string, db: CrmDb) {
    const [row] = await db.select({ id: users.id }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, a.companyId), eq(companyUsers.userId, id), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'))).limit(1);
    if (!row) throw new BadRequestException('Participante interno inválido ou inativo');
  }
  private async links(a: CrmAccess, contactId: string, opportunityId: string | null, tx: CrmTx, existingMeeting = false) {
    // A responsável por um compromisso já atribuído pode mantê-lo sem ganhar acesso comercial à negociação.
    const [contact] = existingMeeting ? await tx.select().from(crmContacts).where(and(eq(crmContacts.companyId, a.companyId), eq(crmContacts.id, contactId))).for('update').limit(1)
      : [await this.policy.contact(a, contactId, tx, true)];
    if (!contact || contact.archivedAt) throw new BadRequestException('Restaure o lead antes de reservar um horário');
    if (!opportunityId) return null;
    const [card] = existingMeeting ? await tx.select().from(crmOpportunities).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, opportunityId))).for('update').limit(1)
      : [await this.policy.opportunity(a, opportunityId, tx, true)];
    if (!card || card.contactId !== contactId || card.archivedAt) throw new BadRequestException('Negociação inválida ou arquivada');
    return card;
  }
  private async lockAgenda(tx: CrmTx, a: CrmAccess, ids: string[]) {
    await lockKeys(tx, ids.map((id) => `crm:agenda:${a.companyId}:${id}`));
  }
  private conflictsFor(a: CrmAccess, responsible: string, start: Date, end: Date, exclude: string | undefined, db: CrmDb) {
    return db.select({ id: crmMeetings.id, title: crmMeetings.title, startsAt: crmMeetings.startsAt, endsAt: crmMeetings.endsAt }).from(crmMeetings)
      .where(and(this.policy.meetingScope(a), eq(crmMeetings.assignedUserId, responsible), eq(crmMeetings.status, 'SCHEDULED'),
        lt(crmMeetings.startsAt, end), gt(crmMeetings.endsAt, start), exclude ? ne(crmMeetings.id, exclude) : sql`true`)).orderBy(asc(crmMeetings.startsAt), asc(crmMeetings.id));
  }
  private async availability(tx: CrmTx, a: CrmAccess, responsible: string, start: Date, end: Date, exclude: string | undefined, allow: boolean) {
    await this.policy.assignee(a, responsible, tx, responsible !== a.userId);
    const settings = await this.settings(a, tx);
    const conflicts = await this.conflictsFor(a, responsible, start, end, exclude, tx);
    if (conflicts.length && !allow && settings.conflictPolicy !== 'ALLOW') throw new ConflictException({ message: 'O responsável já possui compromisso nesse horário', code: 'MEETING_TIME_CONFLICT', conflicts });
    return conflicts;
  }
  private async participants(tx: CrmDb, a: CrmAccess, id: string): Promise<Participant[]> {
    const rows = await tx.select().from(crmMeetingParticipants).where(and(eq(crmMeetingParticipants.companyId, a.companyId), eq(crmMeetingParticipants.meetingId, id))).orderBy(asc(crmMeetingParticipants.id));
    return rows.map((p): Participant => p.kind === 'CONTACT' ? { kind: 'CONTACT', contactId: p.contactId! } : p.kind === 'USER' ? { kind: 'USER', userId: p.userId! } : { kind: 'EXTERNAL', name: p.name, email: p.email, phone: p.phone });
  }
  private normalizeParticipants(items: Participant[]) {
    return items.map((p): Participant => p.kind === 'EXTERNAL' ? { kind: p.kind, name: p.name ?? null, email: p.email ?? null, phone: p.phone ?? null } : p)
      .sort((a, b) => commandHash(a).localeCompare(commandHash(b)));
  }
  private async replaceParticipants(tx: CrmTx, a: CrmAccess, id: string, items: Participant[]) {
    const keys = new Set<string>();
    for (const p of items) {
      const key = commandHash(p);
      if (keys.has(key)) throw new BadRequestException('Participante repetido');
      keys.add(key);
      if (p.kind === 'CONTACT') this.policy.activeContact(await this.policy.contact(a, p.contactId, tx));
      if (p.kind === 'USER') await this.activeMember(a, p.userId, tx);
    }
    await tx.delete(crmMeetingParticipants).where(and(eq(crmMeetingParticipants.companyId, a.companyId), eq(crmMeetingParticipants.meetingId, id)));
    if (items.length) await tx.insert(crmMeetingParticipants).values(items.map((p) => ({ companyId: a.companyId, meetingId: id, kind: p.kind,
      contactId: p.kind === 'CONTACT' ? p.contactId : null, userId: p.kind === 'USER' ? p.userId : null,
      name: p.kind === 'EXTERNAL' ? p.name : null, email: p.kind === 'EXTERNAL' ? p.email : null, phone: p.kind === 'EXTERNAL' ? p.phone : null })));
  }
  private async record(tx: CrmTx, a: Access, meeting: Meeting, kind: string, activity: string, changes: Record<string, unknown>) {
    const [event] = await tx.insert(crmMeetingEvents).values({ companyId: a.companyId, meetingId: meeting.id, contactId: meeting.contactId, opportunityId: meeting.opportunityId,
      kind, actorType: a.actorType, actorUserId: a.userId, changes }).returning();
    await tx.insert(crmActivities).values({ companyId: a.companyId, contactId: meeting.contactId, opportunityId: meeting.opportunityId, meetingId: meeting.id,
      kind: activity, actorType: a.actorType, actorUserId: a.userId, changes: { meetingEventId: event.id, title: meeting.title }, causeReference: a.causeReference ?? `meeting:${meeting.id}` });
    if (meeting.opportunityId) {
      // O contato é bloqueado antes do card, na mesma ordem das outras escritas CRM.
      await tx.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, meeting.opportunityId))).for('update');
      await tx.update(crmOpportunities).set({ lastActivityAt: new Date(), updatedAt: new Date(), version: sql`${crmOpportunities.version} + 1` })
        .where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, meeting.opportunityId)));
    }
  }

  async create(ctx: MeetingContext, input: CreateMeeting, key: string) {
    const hash = commandHash(input), namespace = `crm.meetings.create:${ctx.userId}:${ctx.actorType ?? 'USER'}`;
    return this.database.db.transaction(async (tx) => {
      const a = await this.access(ctx, tx);
      await lockKeys(tx, [`${a.companyId}:${namespace}:${key}`]);
      const [existing] = await tx.select().from(crmMeetings).where(and(eq(crmMeetings.companyId, a.companyId), eq(crmMeetings.commandNamespace, namespace), eq(crmMeetings.idempotencyKey, key))).limit(1);
      if (existing) {
        await this.policy.meeting(a, existing.id, tx);
        if (existing.requestHash !== hash) throw new ConflictException('Idempotency-Key já utilizada com outro conteúdo');
        return existing.creationResult;
      }
      const responsible = input.assignedUserId ?? a.userId;
      await this.lockAgenda(tx, a, [responsible]);
      const card = await this.links(a, input.contactId, input.opportunityId ?? null, tx);
      const conflicts = await this.availability(tx, a, responsible, input.startsAt, input.endsAt, undefined, input.allowConflict);
      const settings = await this.settings(a, tx);
      const qualified = !!(card && settings.qualifyOpportunityOnMeeting && ['NEW', 'CONTACTING'].includes(card.commercialStatus));
      const [meeting] = await tx.insert(crmMeetings).values({ companyId: a.companyId, contactId: input.contactId, opportunityId: input.opportunityId ?? null,
        title: input.title, assignedUserId: responsible, startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone ?? a.timezone,
        modality: input.modality, location: input.location ?? null, meetingUrl: input.meetingUrl ?? null, description: input.description ?? null, notes: input.notes ?? null,
        createdByUserId: a.userId, commandNamespace: namespace, idempotencyKey: key, requestHash: hash }).returning();
      await this.replaceParticipants(tx, a, meeting.id, this.normalizeParticipants(input.participants));
      const minutes = input.reminderMinutes ?? (settings.defaultReminderMinutes === null ? [] : [settings.defaultReminderMinutes]);
      await this.reminders.setRules(tx, meeting, minutes);
      await this.record(tx, a, meeting, 'CREATED', 'MEETING_CREATED', { meeting: publicMeeting(meeting), participants: input.participants, reminderMinutes: minutes, confirmedConflicts: conflicts });
      if (qualified && card) {
        await tx.update(crmOpportunities).set({ commercialStatus: 'QUALIFIED' }).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, card.id)));
        await tx.insert(crmActivities).values({ companyId: a.companyId, contactId: meeting.contactId, opportunityId: card.id, meetingId: meeting.id,
          kind: 'STATUS_CHANGED', actorType: 'SYSTEM', changes: { commercialStatus: { before: card.commercialStatus, after: 'QUALIFIED' } }, causeReference: `meeting:${meeting.id}` });
      }
      const result = JSON.parse(JSON.stringify({ meetingId: meeting.id, conflicts, opportunityQualified: qualified })) as Record<string, unknown>;
      await tx.update(crmMeetings).set({ creationResult: result }).where(eq(crmMeetings.id, meeting.id));
      return result;
    });
  }

  async list(ctx: CrmContext, input: MeetingListInput) {
    const a = await this.access(ctx), db = this.database.db;
    const terms = [this.policy.meetingScope(a), lt(crmMeetings.startsAt, input.to), gt(crmMeetings.endsAt, input.from)];
    if (input.assignedUserId) terms.push(eq(crmMeetings.assignedUserId, input.assignedUserId));
    if (input.contactId) terms.push(eq(crmMeetings.contactId, input.contactId));
    if (input.opportunityId) terms.push(eq(crmMeetings.opportunityId, input.opportunityId));
    if (input.status) terms.push(eq(crmMeetings.status, input.status));
    if (input.modality) terms.push(eq(crmMeetings.modality, input.modality));
    if (input.search) { const q = escapeLike(input.search); terms.push(or(ilike(crmMeetings.title, q), ilike(crmContacts.name, q), ilike(crmContacts.organizationName, q))!); }
    const filter = and(...terms), join = and(eq(crmContacts.companyId, crmMeetings.companyId), eq(crmContacts.id, crmMeetings.contactId));
    const [rows, [summary]] = await Promise.all([
      db.select({ meeting: crmMeetings, lead: { id: crmContacts.id, name: crmContacts.name, organizationName: crmContacts.organizationName }, responsible: { id: users.id, name: users.name } })
        .from(crmMeetings).innerJoin(crmContacts, join).innerJoin(users, eq(users.id, crmMeetings.assignedUserId)).where(filter).orderBy(asc(crmMeetings.startsAt), asc(crmMeetings.id)).limit(input.limit).offset(input.offset),
      db.select({ total: count(), scheduled: sql<number>`count(*) filter (where ${crmMeetings.status} = 'SCHEDULED')::integer`, completed: sql<number>`count(*) filter (where ${crmMeetings.status} = 'COMPLETED')::integer`, canceled: sql<number>`count(*) filter (where ${crmMeetings.status} = 'CANCELED')::integer`, noShow: sql<number>`count(*) filter (where ${crmMeetings.status} = 'NO_SHOW')::integer` })
        .from(crmMeetings).innerJoin(crmContacts, join).where(filter),
    ]);
    return { items: rows.map((r) => ({ ...publicMeeting(r.meeting), lead: r.lead, responsible: r.responsible })), total: summary.total, summary, limit: input.limit, offset: input.offset };
  }
  async get(ctx: CrmContext, id: string) {
    const a = await this.access(ctx), meeting = await this.policy.meeting(a, id), db = this.database.db;
    const [lead] = await db.select({ id: crmContacts.id, name: crmContacts.name, organizationName: crmContacts.organizationName, email: crmContacts.email, phone: crmContacts.phone }).from(crmContacts)
      .where(and(eq(crmContacts.companyId, a.companyId), eq(crmContacts.id, meeting.contactId))).limit(1);
    const [opportunity] = meeting.opportunityId ? await db.select({ id: crmOpportunities.id, title: crmOpportunities.title, commercialStatus: crmOpportunities.commercialStatus }).from(crmOpportunities)
      .where(and(this.policy.opportunityScope(a), eq(crmOpportunities.id, meeting.opportunityId))).limit(1) : [];
    const [responsible] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, meeting.assignedUserId)).limit(1);
    const participants = await this.participants(db, a, id), reminderMinutes = await this.reminders.ruleMinutes(db, meeting);
    return { ...publicMeeting(meeting), lead, opportunity: opportunity ?? null, responsible, participants, reminderMinutes };
  }
  async conflicts(ctx: CrmContext, input: ConflictInput) {
    const a = await this.access(ctx);
    await this.policy.assignee(a, input.assignedUserId, this.database.db, input.assignedUserId !== a.userId);
    if (input.excludeMeetingId) await this.policy.meeting(a, input.excludeMeetingId);
    const items = await this.conflictsFor(a, input.assignedUserId, input.startsAt, input.endsAt, input.excludeMeetingId, this.database.db);
    return { hasConflict: items.length > 0, items };
  }
  async responsibles(ctx: CrmContext) {
    const a = await this.access(ctx);
    const items = await this.database.db.select({ id: users.id, name: users.name }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId))
      .where(and(eq(companyUsers.companyId, a.companyId), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'), a.manager ? sql`true` : eq(users.id, a.userId))).orderBy(asc(users.name), asc(users.id));
    return { items };
  }

  private async mutate(ctx: MeetingContext, id: string, version: number, nextResponsible: string | undefined, apply: (tx: CrmTx, a: Access, old: Meeting) => Promise<Meeting>) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.access(ctx, tx), initial = await this.policy.meeting(a, id, tx);
      await this.lockAgenda(tx, a, [initial.assignedUserId, nextResponsible ?? initial.assignedUserId]);
      await tx.select({ id: crmContacts.id }).from(crmContacts).where(and(eq(crmContacts.companyId, a.companyId), eq(crmContacts.id, initial.contactId))).for('update');
      if (initial.opportunityId) await tx.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, initial.opportunityId))).for('update');
      const old = await this.policy.meeting(a, id, tx, true); expectVersion(old.version, version);
      // Se uma transferência venceu a corrida, a versão impede escrever usando os locks da leitura antiga.
      return publicMeeting(await apply(tx, a, old));
    });
  }
  update(ctx: MeetingContext, id: string, input: UpdateMeeting) {
    return this.mutate(ctx, id, input.expectedVersion, input.assignedUserId, async (tx, a, old) => {
      if (old.status !== 'SCHEDULED') throw new BadRequestException('Somente reuniões agendadas podem ser editadas');
      const { expectedVersion: _version, allowConflict: _allow, participants, reminderMinutes, ...patch } = input;
      const changes = changedFields(old, patch);
      const normalized = participants === undefined ? undefined : this.normalizeParticipants(participants);
      if (normalized !== undefined) Object.assign(changes, changedFields({ participants: this.normalizeParticipants(await this.participants(tx, a, id)) }, { participants: normalized }));
      if (reminderMinutes !== undefined) Object.assign(changes, changedFields({ reminderMinutes: await this.reminders.ruleMinutes(tx, old) }, { reminderMinutes }));
      if (!Object.keys(changes).length) return old;
      await this.links(a, old.contactId, old.opportunityId, tx, true);
      const responsible = patch.assignedUserId ?? old.assignedUserId;
      const conflicts = await this.availability(tx, a, responsible, old.startsAt, old.endsAt, id, input.allowConflict);
      const revising = responsible !== old.assignedUserId || 'reminderMinutes' in changes;
      const [meeting] = await tx.update(crmMeetings).set({ ...patch, version: old.version + 1, scheduleRevision: old.scheduleRevision + Number(revising), updatedAt: new Date() }).where(eq(crmMeetings.id, id)).returning();
      if ('participants' in changes && normalized) await this.replaceParticipants(tx, a, id, normalized);
      if ('reminderMinutes' in changes && reminderMinutes) await this.reminders.setRules(tx, meeting, reminderMinutes);
      else if (revising) await this.reminders.refresh(tx, meeting);
      await this.record(tx, a, meeting, 'UPDATED', 'MEETING_UPDATED', { ...changes, confirmedConflicts: conflicts });
      return meeting;
    });
  }
  reschedule(ctx: MeetingContext, id: string, input: RescheduleMeeting) {
    return this.mutate(ctx, id, input.expectedVersion, undefined, async (tx, a, old) => {
      if (old.status !== 'SCHEDULED') throw new BadRequestException('Somente reuniões agendadas podem ser reagendadas');
      const patch = { startsAt: input.startsAt, endsAt: input.endsAt, timezone: input.timezone ?? old.timezone }, changes = changedFields(old, patch);
      if (!Object.keys(changes).length) return old;
      await this.links(a, old.contactId, old.opportunityId, tx, true);
      const conflicts = await this.availability(tx, a, old.assignedUserId, input.startsAt, input.endsAt, id, input.allowConflict);
      const [meeting] = await tx.update(crmMeetings).set({ ...patch, version: old.version + 1, scheduleRevision: old.scheduleRevision + 1, updatedAt: new Date() }).where(eq(crmMeetings.id, id)).returning();
      await this.reminders.refresh(tx, meeting);
      await this.record(tx, a, meeting, 'RESCHEDULED', 'MEETING_RESCHEDULED', { ...changes, confirmedConflicts: conflicts });
      return meeting;
    });
  }
  async status(ctx: MeetingContext, id: string, input: MeetingStatusInput) {
    if (input.status === 'SCHEDULED') throw new BadRequestException('Utilize a ação de reabertura para voltar a Agendada');
    return this.mutate(ctx, id, input.expectedVersion, undefined, async (tx, a, old) => {
      const now = new Date();
      const patch = { status: input.status,
        completedAt: input.status === 'COMPLETED' ? (old.completedAt ?? now) : null,
        canceledAt: input.status === 'CANCELED' ? (old.canceledAt ?? now) : null,
        outcomeNotes: input.status === 'COMPLETED' ? (input.outcomeNotes === undefined ? old.outcomeNotes : input.outcomeNotes) : null,
        nextSteps: input.status === 'COMPLETED' ? (input.nextSteps === undefined ? old.nextSteps : input.nextSteps) : null,
        cancellationReason: input.status === 'CANCELED' ? (input.cancellationReason === undefined ? old.cancellationReason : input.cancellationReason) : null };
      const changes = changedFields(old, patch); if (!Object.keys(changes).length) return old;
      const [meeting] = await tx.update(crmMeetings).set({ ...patch, version: old.version + 1, updatedAt: now }).where(eq(crmMeetings.id, id)).returning();
      await this.reminders.cancel(tx, meeting);
      await this.record(tx, a, meeting, 'STATUS_CHANGED', 'MEETING_STATUS_CHANGED', changes);
      return meeting;
    });
  }
  reopen(ctx: MeetingContext, id: string, input: { expectedVersion: number; allowConflict: boolean }) {
    return this.mutate(ctx, id, input.expectedVersion, undefined, async (tx, a, old) => {
      if (old.status === 'SCHEDULED') return old;
      await this.links(a, old.contactId, old.opportunityId, tx, true);
      const conflicts = await this.availability(tx, a, old.assignedUserId, old.startsAt, old.endsAt, id, input.allowConflict);
      const patch = { status: 'SCHEDULED', completedAt: null, canceledAt: null, outcomeNotes: null, nextSteps: null, cancellationReason: null };
      const [meeting] = await tx.update(crmMeetings).set({ ...patch, version: old.version + 1, scheduleRevision: old.scheduleRevision + 1, updatedAt: new Date() }).where(eq(crmMeetings.id, id)).returning();
      await this.reminders.refresh(tx, meeting);
      await this.record(tx, a, meeting, 'STATUS_CHANGED', 'MEETING_STATUS_CHANGED', { ...changedFields(old, patch), confirmedConflicts: conflicts });
      return meeting;
    });
  }
  async history(ctx: CrmContext, id: string, limit: number, offset: number) {
    const a = await this.access(ctx), db = this.database.db;
    await this.policy.meeting(a, id);
    const filter = and(eq(crmMeetingEvents.companyId, a.companyId), eq(crmMeetingEvents.meetingId, id));
    const [items, [total]] = await Promise.all([db.select().from(crmMeetingEvents).where(filter).orderBy(desc(crmMeetingEvents.occurredAt), desc(crmMeetingEvents.id)).limit(limit).offset(offset), db.select({ value: count() }).from(crmMeetingEvents).where(filter)]);
    // Eventos podem conter dados comerciais de participantes e notas; seguem a permissão da reunião.
    return { items, total: total.value, limit, offset };
  }
  async getSettings(ctx: CrmContext) { const a = await this.access(ctx); return this.settings(a, this.database.db); }
  async updateSettings(ctx: CrmContext, input: { expectedVersion: number; qualifyOpportunityOnMeeting?: boolean; defaultReminderMinutes?: number | null; conflictPolicy?: 'WARN' | 'ALLOW' }) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.access(ctx, tx); this.policy.requireManager(a);
      await tx.insert(crmSettings).values({ companyId: a.companyId }).onConflictDoNothing();
      const [old] = await tx.select().from(crmSettings).where(eq(crmSettings.companyId, a.companyId)).for('update').limit(1);
      expectVersion(old.version, input.expectedVersion);
      const { expectedVersion: _version, ...patch } = input;
      if (!Object.keys(changedFields(old, patch)).length) return old;
      const [row] = await tx.update(crmSettings).set({ ...patch, version: old.version + 1, updatedAt: new Date() }).where(eq(crmSettings.companyId, a.companyId)).returning();
      return row;
    });
  }
}
