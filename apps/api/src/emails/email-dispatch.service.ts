import { Inject, Injectable, Logger } from '@nestjs/common';
import { companies, companyUsers, emailMessages } from '@gestaonf/database/schema';
import { and, asc, desc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../database/database.module.js';
import { allowedTestRecipient } from './emails.config.js';
import { EmailsService } from './emails.service.js';
import { EmailProviderError, ResendProviderService } from './resend-provider.service.js';

@Injectable()
export class EmailDispatchService {
  private readonly logger = new Logger(EmailDispatchService.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(ResendProviderService) private readonly provider: ResendProviderService, @Inject(EmailsService) private readonly emails: EmailsService) {}

  async dispatchOne() {
    if (!this.provider.config.enabled) return;
    const claimed = await this.database.db.transaction(async tx => {
      const lock = await tx.execute(sql`select pg_try_advisory_xact_lock(hashtextextended('resend-dispatch',0)) as acquired`);
      if (!lock[0]?.acquired) return null;
      const now = new Date();
      const [last] = await tx.select({ at: emailMessages.lastAttemptAt }).from(emailMessages).where(sql`${emailMessages.lastAttemptAt} is not null`).orderBy(desc(emailMessages.lastAttemptAt)).limit(1);
      if (last?.at && now.getTime() - last.at.getTime() < 1000) return null;
      const [row] = await tx.select().from(emailMessages).where(or(and(inArray(emailMessages.sendStatus, ['QUEUED', 'RETRYING']), lte(emailMessages.availableAt, now)), and(eq(emailMessages.sendStatus, 'SENDING'), lte(emailMessages.leaseUntil, now)))).orderBy(asc(emailMessages.availableAt), asc(emailMessages.createdAt)).limit(1).for('update', { skipLocked: true });
      if (!row) return null;
      const finish = async (code: string) => { await tx.update(emailMessages).set({ sendStatus: row.mayHaveSent ? 'UNKNOWN' : 'FAILED', lastErrorCode: code, leaseToken: null, leaseUntil: null, updatedAt: now }).where(eq(emailMessages.id, row.id)); return null; };
      if (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= 23 * 60 * 60_000) return finish('idempotency_window_expired');
      if (row.attempts >= 8) return finish('attempts_exhausted');
      const [member] = await tx.select({ id: companyUsers.userId, role: companyUsers.role }).from(companyUsers).innerJoin(companies, eq(companies.id, companyUsers.companyId)).where(and(eq(companyUsers.companyId, row.companyId), eq(companyUsers.userId, row.createdByUserId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'))).limit(1);
      if (!member) return finish('company_access_revoked');
      if (['MESSAGE', 'TEST'].includes(row.purpose) && !['OWNER', 'ADMIN', 'MANAGER'].includes(member.role)) return finish('send_permission_revoked');
      const config = this.provider.config;
      if (config.testMode && !allowedTestRecipient(row.toAddress, config)) return finish('test_recipient_restricted');
      // A row keeps its original test-mode and sender snapshot across configuration changes.
      if (row.testMode !== config.testMode || row.fromAddress !== config.from) return finish('configuration_changed');
      if (!config.testMode) {
        const [suppressed] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.companyId, row.companyId), eq(emailMessages.toAddress, row.toAddress), inArray(emailMessages.deliveryStatus, ['BOUNCED', 'COMPLAINED', 'SUPPRESSED']))).limit(1);
        if (suppressed) return finish('recipient_suppressed');
      }
      const [result] = await tx.update(emailMessages).set({ sendStatus: 'SENDING', attempts: row.attempts + 1, firstAttemptAt: row.firstAttemptAt ?? now, lastAttemptAt: now, leaseToken: randomUUID(), leaseUntil: new Date(now.getTime() + 60_000), mayHaveSent: true, updatedAt: now }).where(eq(emailMessages.id, row.id)).returning();
      return { row: result, previouslyUncertain: row.mayHaveSent };
    });
    if (!claimed) return;
    const { row, previouslyUncertain } = claimed;
    let providerId: string | null = null, failure: EmailProviderError | null = null;
    try { providerId = await this.provider.send({ from: row.fromAddress, to: row.toAddress, subject: row.subject, text: row.textBody, html: row.htmlBody, ...(row.replyTo ? { reply_to: row.replyTo } : {}) }, `gestaonf-email/${row.id}`); }
    catch (error) { failure = error instanceof EmailProviderError ? error : new EmailProviderError('network_error', true, true); }
    await this.database.db.transaction(async tx => {
      const [current] = await tx.select().from(emailMessages).where(and(eq(emailMessages.id, row.id), eq(emailMessages.leaseToken, row.leaseToken!))).for('update');
      if (!current) return;
      const now = new Date();
      if (providerId) {
        const [accepted] = await tx.update(emailMessages).set({ sendStatus: 'ACCEPTED', providerEmailId: providerId, acceptedAt: now, lastErrorCode: null, leaseToken: null, leaseUntil: null, updatedAt: now }).where(eq(emailMessages.id, row.id)).returning();
        await this.emails.applyEvents(tx, accepted);
      } else {
        const ambiguous = previouslyUncertain || failure!.ambiguous;
        const deadline = row.firstAttemptAt!.getTime() + 23 * 60 * 60_000;
        const next = new Date(now.getTime() + Math.max(Math.min(60 * 60_000, 5_000 * 2 ** row.attempts), failure!.retryAfterMs));
        const retry = failure!.retryable && row.attempts < 8 && next.getTime() < deadline;
        await tx.update(emailMessages).set({ sendStatus: retry ? 'RETRYING' : ambiguous ? 'UNKNOWN' : 'FAILED', mayHaveSent: ambiguous, availableAt: next, lastErrorCode: failure!.code, leaseToken: null, leaseUntil: null, updatedAt: now }).where(eq(emailMessages.id, row.id));
      }
    });
    this.logger.log({ event: 'email_dispatch', emailId: row.id, result: providerId ? 'ACCEPTED' : failure!.code });
  }
}
