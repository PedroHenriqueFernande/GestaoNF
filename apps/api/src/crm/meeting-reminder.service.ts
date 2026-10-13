import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyUsers, crmMeetingReminderOccurrences as occurrences, crmMeetingReminders as rules, crmMeetings, userNotifications, users } from '@gestaonf/database/schema';
import { and, asc, count, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService } from './crm-policy.service.js';
import type { CrmContext } from './crm.schemas.js';
import type { CrmDb, CrmTx } from './crm-normalization.js';

type Meeting = typeof crmMeetings.$inferSelect;
@Injectable()
export class MeetingReminderService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CrmPolicyService) private readonly policy: CrmPolicyService) {}

  async ruleMinutes(db: CrmDb, meeting: Meeting) {
    const rows = await db.select({ minutes: rules.minutesBefore }).from(rules).where(and(eq(rules.companyId, meeting.companyId), eq(rules.meetingId, meeting.id), eq(rules.active, true))).orderBy(asc(rules.minutesBefore));
    return rows.map((r) => r.minutes);
  }
  async cancel(tx: CrmTx, meeting: Meeting) {
    await tx.update(occurrences).set({ status: 'CANCELED' }).where(and(eq(occurrences.companyId, meeting.companyId), eq(occurrences.meetingId, meeting.id), eq(occurrences.status, 'PENDING')));
  }
  async setRules(tx: CrmTx, meeting: Meeting, minutes: number[]) {
    await tx.update(rules).set({ active: false }).where(and(eq(rules.companyId, meeting.companyId), eq(rules.meetingId, meeting.id), eq(rules.active, true)));
    if (minutes.length) await tx.insert(rules).values(minutes.map((minutesBefore) => ({ companyId: meeting.companyId, meetingId: meeting.id, minutesBefore })));
    await this.refresh(tx, meeting);
  }
  async refresh(tx: CrmTx, meeting: Meeting) {
    await this.cancel(tx, meeting);
    if (meeting.status !== 'SCHEDULED') return;
    const active = await tx.select().from(rules).where(and(eq(rules.companyId, meeting.companyId), eq(rules.meetingId, meeting.id), eq(rules.active, true)));
    if (active.length) await tx.insert(occurrences).values(active.map((rule) => ({ companyId: meeting.companyId, meetingId: meeting.id, ruleId: rule.id,
      recipientUserId: meeting.assignedUserId, scheduleRevision: meeting.scheduleRevision, remindAt: new Date(meeting.startsAt.getTime() - rule.minutesBefore * 60_000) }))).onConflictDoNothing();
  }

  async dispatchDue(now = new Date(), limit = 100) {
    const candidates = await this.database.db.select({ id: occurrences.id, meetingId: occurrences.meetingId, companyId: occurrences.companyId })
      .from(occurrences).where(and(eq(occurrences.status, 'PENDING'), lte(occurrences.remindAt, now))).orderBy(asc(occurrences.remindAt), asc(occurrences.id)).limit(limit);
    const stats = { delivered: 0, canceled: 0, expired: 0 };
    for (const candidate of candidates) {
      const result = await this.database.db.transaction(async (tx) => {
        // Mesma ordem de locks das mutações: reunião antes da ocorrência.
        const [meeting] = await tx.select().from(crmMeetings).where(and(eq(crmMeetings.companyId, candidate.companyId), eq(crmMeetings.id, candidate.meetingId))).for('update').limit(1);
        const [occurrence] = await tx.select().from(occurrences).where(eq(occurrences.id, candidate.id)).for('update').limit(1);
        if (!meeting || !occurrence || occurrence.status !== 'PENDING') return null;
        const [member] = await tx.select({ id: users.id }).from(companyUsers).innerJoin(users, eq(users.id, companyUsers.userId)).innerJoin(companies, eq(companies.id, companyUsers.companyId))
          .where(and(eq(companyUsers.companyId, meeting.companyId), eq(companyUsers.userId, occurrence.recipientUserId), eq(companyUsers.status, 'ACTIVE'), eq(users.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'))).for('share').limit(1);
        const [rule] = await tx.select({ active: rules.active, minutesBefore: rules.minutesBefore }).from(rules).where(eq(rules.id, occurrence.ruleId)).limit(1);
        let status: 'DELIVERED' | 'CANCELED' | 'EXPIRED' = 'DELIVERED';
        if (meeting.status !== 'SCHEDULED' || meeting.scheduleRevision !== occurrence.scheduleRevision || meeting.assignedUserId !== occurrence.recipientUserId || !member || !rule?.active) status = 'CANCELED';
        else if (now.getTime() >= meeting.startsAt.getTime() + (rule.minutesBefore === 0 ? 30_000 : 0)) status = 'EXPIRED';
        if (status === 'DELIVERED') {
          const when = new Intl.DateTimeFormat('pt-BR', { timeZone: meeting.timezone, dateStyle: 'short', timeStyle: 'short' }).format(meeting.startsAt);
          await tx.insert(userNotifications).values({ companyId: meeting.companyId, recipientUserId: occurrence.recipientUserId, meetingId: meeting.id, occurrenceId: occurrence.id,
            title: 'Reunião agendada', body: `${meeting.title} começa em ${when}.` }).onConflictDoNothing({ target: userNotifications.occurrenceId });
        }
        await tx.update(occurrences).set({ status, deliveredAt: status === 'DELIVERED' ? now : null }).where(eq(occurrences.id, occurrence.id));
        return status;
      });
      if (result === 'DELIVERED') stats.delivered++;
      if (result === 'CANCELED') stats.canceled++;
      if (result === 'EXPIRED') stats.expired++;
    }
    return stats;
  }
  async notifications(ctx: CrmContext, input: { limit: number; offset: number; unreadOnly: boolean }) {
    await this.policy.access(ctx);
    const filter = and(eq(userNotifications.companyId, ctx.companyId), eq(userNotifications.recipientUserId, ctx.userId), input.unreadOnly ? isNull(userNotifications.readAt) : sql`true`);
    const [items, [total]] = await Promise.all([
      this.database.db.select().from(userNotifications).where(filter).orderBy(desc(userNotifications.createdAt), desc(userNotifications.id)).limit(input.limit).offset(input.offset),
      this.database.db.select({ value: count() }).from(userNotifications).where(filter),
    ]);
    return { items, total: total.value, limit: input.limit, offset: input.offset };
  }
  async read(ctx: CrmContext, id: string) {
    await this.policy.access(ctx);
    const [row] = await this.database.db.update(userNotifications).set({ readAt: sql`coalesce(${userNotifications.readAt}, now())` })
      .where(and(eq(userNotifications.companyId, ctx.companyId), eq(userNotifications.recipientUserId, ctx.userId), eq(userNotifications.id, id))).returning();
    if (!row) throw new NotFoundException('Notificação não encontrada');
    return row;
  }
}
