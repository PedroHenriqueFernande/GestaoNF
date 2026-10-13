import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { companies, companyUsers, emailEvents, emailMessages } from '@gestaonf/database/schema';
import { and, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { parseInput } from '../common/validate.js';
import { allowedTestRecipient } from './emails.config.js';
import { emailKeySchema, emailWebhookSchema, sendEmailSchema } from './emails.schemas.js';
import { renderEmail } from './email-template.js';
import { ResendProviderService } from './resend-provider.service.js';

export type EmailContext = { companyId: string; userId: string };
export type EmailTransaction = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type EmailRow = typeof emailMessages.$inferSelect;
const managerRoles = ['OWNER', 'ADMIN', 'MANAGER'];
export const DELIVERY_PRIORITY: Record<string, number> = { PENDING: 0, SENT: 1, DELAYED: 2, FAILED: 3, SUPPRESSED: 4, DELIVERED: 5, BOUNCED: 6, COMPLAINED: 7 };
export const EVENT_STATUS: Record<string, string> = { 'email.sent': 'SENT', 'email.delivery_delayed': 'DELAYED', 'email.delivered': 'DELIVERED', 'email.failed': 'FAILED', 'email.suppressed': 'SUPPRESSED', 'email.bounced': 'BOUNCED', 'email.complained': 'COMPLAINED' };
export function publicEmail(row: EmailRow) {
  return { id: row.id, companyId: row.companyId, purpose: row.purpose, to: row.toAddress, subject: row.subject, testMode: row.testMode, sendStatus: row.sendStatus, deliveryStatus: row.deliveryStatus, attempts: row.attempts, lastErrorCode: row.lastErrorCode, createdAt: row.createdAt, acceptedAt: row.acceptedAt };
}

@Injectable()
export class EmailsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(ResendProviderService) readonly provider: ResendProviderService) {}
  async member(ctx: EmailContext, tx: Pick<DatabaseService['db'], 'select'> = this.database.db) {
    const [member] = await tx.select({ role: companyUsers.role, name: companies.name }).from(companyUsers).innerJoin(companies, eq(companies.id, companyUsers.companyId)).where(and(eq(companyUsers.companyId, ctx.companyId), eq(companyUsers.userId, ctx.userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'))).limit(1);
    if (!member) throw new ForbiddenException('Sem acesso à empresa');
    return member;
  }
  async capabilities(ctx: EmailContext) {
    const member = await this.member(ctx); const c = this.provider.config;
    return { enabled: c.enabled, testMode: c.testMode, webhookConfigured: !!c.webhookSecret, canSend: managerRoles.includes(member.role), sender: c.from, testRecipient: managerRoles.includes(member.role) ? c.testRecipient : null, dailyLimit: c.dailyLimit };
  }
  async send(ctx: EmailContext, input: z.output<typeof sendEmailSchema>, key: string) {
    const member = await this.member(ctx);
    if (!managerRoles.includes(member.role)) throw new ForbiddenException('Somente gestores podem enviar e-mails diretamente');
    return this.enqueue(ctx, input, key, 'MESSAGE');
  }
  async test(ctx: EmailContext, scenario: string, key: string) {
    const member = await this.member(ctx);
    if (!managerRoles.includes(member.role)) throw new ForbiddenException('Somente gestores podem testar o envio');
    const to = scenario === 'OWN' ? this.provider.config.testRecipient : `${scenario.toLowerCase()}@resend.dev`;
    if (!to) throw new ServiceUnavailableException('Configure RESEND_TEST_RECIPIENT');
    return this.enqueue(ctx, { to, subject: 'Teste de e-mail do GestãoNF', message: `O envio de e-mails de ${member.name} está conectado ao Resend.\n\nEste é um teste da infraestrutura de e-mails do sistema.` }, key, 'TEST');
  }
  async enqueue(ctx: EmailContext, input: z.output<typeof sendEmailSchema>, key: string, purpose: string) {
    return this.database.db.transaction(tx => this.enqueueInTx(tx, ctx, input, key, purpose));
  }
  // Future modules can call this inside the same transaction as their business change.
  async enqueueInTx(tx: EmailTransaction, ctx: EmailContext, rawInput: z.output<typeof sendEmailSchema>, rawKey: string, rawPurpose: string) {
    const input = parseInput(sendEmailSchema, rawInput), key = parseInput(emailKeySchema, rawKey);
    const purpose = parseInput(z.string().regex(/^[A-Z0-9_]{1,64}$/), rawPurpose);
    const member = await this.member(ctx, tx);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`emails-admission:${ctx.companyId}`},0))`);
    const hash = createHash('sha256').update(JSON.stringify({ ...input, purpose })).digest('hex');
    const [existing] = await tx.select().from(emailMessages).where(and(eq(emailMessages.companyId, ctx.companyId), eq(emailMessages.requestKey, key))).limit(1);
    if (existing) {
      if (existing.requestHash !== hash || existing.createdByUserId !== ctx.userId) throw new ConflictException('Chave de envio já usada em outra solicitação');
      return publicEmail(existing);
    }
    const c = this.provider.config;
    if (!c.enabled) throw new ServiceUnavailableException('Envio de e-mails ainda não ativado');
    if (c.testMode && !allowedTestRecipient(input.to, c)) throw new BadRequestException('Sem domínio próprio, envie ao e-mail da conta Resend ou aos destinatários de simulação');
    const [suppression] = await tx.select({ id: emailMessages.id }).from(emailMessages).where(and(eq(emailMessages.companyId, ctx.companyId), eq(emailMessages.toAddress, input.to), inArray(emailMessages.deliveryStatus, ['BOUNCED', 'COMPLAINED', 'SUPPRESSED']))).limit(1);
    if (suppression && !c.testMode) throw new ConflictException('Envio bloqueado: destinatário rejeitado ou marcado como spam');
    const dayStart = new Date(); dayStart.setUTCHours(0, 0, 0, 0);
    const [usage] = await tx.select({ value: count() }).from(emailMessages).where(and(eq(emailMessages.companyId, ctx.companyId), gte(emailMessages.createdAt, dayStart)));
    if (usage.value >= c.dailyLimit) throw new HttpException('Limite diário de e-mails desta empresa atingido', 429);
    const content = renderEmail(member.name, input.subject, input.message);
    const [row] = await tx.insert(emailMessages).values({ companyId: ctx.companyId, createdByUserId: ctx.userId, requestKey: key, requestHash: hash, purpose, fromAddress: c.from, toAddress: input.to, replyTo: c.replyTo, subject: input.subject, textBody: content.text, htmlBody: content.html, testMode: c.testMode }).returning();
    return publicEmail(row);
  }
  async list(ctx: EmailContext, input: { limit: number; offset: number }) {
    const member = await this.member(ctx);
    const filter = and(eq(emailMessages.companyId, ctx.companyId), managerRoles.includes(member.role) ? undefined : eq(emailMessages.createdByUserId, ctx.userId));
    const [rows, total] = await Promise.all([this.database.db.select().from(emailMessages).where(filter).orderBy(desc(emailMessages.createdAt), desc(emailMessages.id)).limit(input.limit).offset(input.offset), this.database.db.select({ value: count() }).from(emailMessages).where(filter)]);
    return { items: rows.map(publicEmail), total: total[0].value };
  }
  async get(ctx: EmailContext, id: string) {
    const member = await this.member(ctx);
    const [row] = await this.database.db.select().from(emailMessages).where(and(eq(emailMessages.id, id), eq(emailMessages.companyId, ctx.companyId), managerRoles.includes(member.role) ? undefined : eq(emailMessages.createdByUserId, ctx.userId))).limit(1);
    if (!row) throw new NotFoundException('E-mail não encontrado');
    const events = row.providerEmailId ? await this.database.db.select({ type: emailEvents.eventType, occurredAt: emailEvents.occurredAt }).from(emailEvents).where(eq(emailEvents.providerEmailId, row.providerEmailId)).orderBy(emailEvents.occurredAt) : [];
    return { ...publicEmail(row), events };
  }
  async webhook(rawBody: string, headers: { id: string; timestamp: string; signature: string }) {
    const verified = this.provider.verifyWebhook(rawBody, headers);
    // Ignore unrelated event families; email events always have an email_id.
    if (!EVENT_STATUS[verified.type]) return { received: true };
    const event = parseInput(emailWebhookSchema, verified);
    await this.database.db.transaction(async tx => {
      const [inserted] = await tx.insert(emailEvents).values({ providerEventId: headers.id, providerEmailId: event.data.email_id, eventType: event.type, occurredAt: new Date(event.created_at) }).onConflictDoNothing().returning();
      if (!inserted) return;
      const [row] = await tx.select().from(emailMessages).where(eq(emailMessages.providerEmailId, event.data.email_id)).for('update');
      if (row) await this.applyEvents(tx, row);
    });
    return { received: true };
  }
  async applyEvents(tx: EmailTransaction, row: EmailRow) {
    if (!row.providerEmailId) return;
    const events = await tx.select().from(emailEvents).where(eq(emailEvents.providerEmailId, row.providerEmailId));
    let status = row.deliveryStatus;
    for (const event of events) { const candidate = EVENT_STATUS[event.eventType]; if (candidate && DELIVERY_PRIORITY[candidate] > DELIVERY_PRIORITY[status]) status = candidate; }
    if (status !== row.deliveryStatus) await tx.update(emailMessages).set({ deliveryStatus: status, updatedAt: new Date() }).where(eq(emailMessages.id, row.id));
  }
}
