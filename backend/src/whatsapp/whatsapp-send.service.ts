// backend/src/whatsapp/whatsapp-send.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { UnrecoverableError } from 'bullmq';
import { integrationOutbox, whatsappConnections, whatsappOutboundMessages, whatsappSendAttempts, whatsappSessions } from '@gestaonf/database/schema';
import { and, count, eq, inArray } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { MetaCloudClient } from './meta-cloud.client.js';
import { describeMetaError, isRetryableMetaError, type MetaSendError } from './meta-errors.js';
import { WhatsAppLinkService } from './whatsapp-link.service.js';

export type SendJob = { outboundMessageId: string; outboxId: string; attemptsMade: number; maxAttempts: number };

@Injectable()
export class WhatsAppSendService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetaCloudClient) private readonly meta: MetaCloudClient,
    @Inject(WhatsAppLinkService) private readonly links: WhatsAppLinkService,
  ) {}

  private async completeOutbox(outboxId: string) {
    await this.database.db.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, outboxId));
  }

  async process(job: SendJob) {
    const [message] = await this.database.db.select({
      id: whatsappOutboundMessages.id, status: whatsappOutboundMessages.status,
      recipientId: whatsappOutboundMessages.recipientId, body: whatsappOutboundMessages.body,
      connectionId: whatsappOutboundMessages.connectionId, linkId: whatsappOutboundMessages.linkId,
      companyId: whatsappOutboundMessages.companyId, companyLinkId: whatsappOutboundMessages.companyLinkId, requestId: whatsappOutboundMessages.requestId,
      messageType: whatsappOutboundMessages.messageType, interactive: whatsappOutboundMessages.interactive,
      conversationId: whatsappOutboundMessages.conversationId,
      phoneNumberId: whatsappConnections.phoneNumberId,
    }).from(whatsappOutboundMessages).innerJoin(whatsappConnections, eq(whatsappConnections.id, whatsappOutboundMessages.connectionId))
      .where(eq(whatsappOutboundMessages.id, job.outboundMessageId)).limit(1);
    if (!message) throw new Error('Mensagem de saída não encontrada');
    if (['SENT', 'DELIVERED', 'READ', 'CANCELED', 'FAILED'].includes(message.status)) { await this.completeOutbox(job.outboxId); return; }
    const cancel = async () => {
      await this.database.db.transaction(async (tx) => {
        await tx.update(whatsappOutboundMessages).set({ status: 'CANCELED', failureReason: 'Vínculo, acesso ou solicitação indisponível', updatedAt: new Date() }).where(eq(whatsappOutboundMessages.id, message.id));
        await tx.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, job.outboxId));
      });
    };
    if (!await this.links.canSend(message)) { await cancel(); return; }
    const [attemptRow] = await this.database.db.select({ count: count() }).from(whatsappSendAttempts).where(eq(whatsappSendAttempts.outboundMessageId, message.id));
    const attempt = attemptRow.count + 1;
    const [claimed] = await this.database.db.update(whatsappOutboundMessages).set({ status: 'SENDING', updatedAt: new Date() })
      .where(and(eq(whatsappOutboundMessages.id, message.id), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING']))).returning({ id: whatsappOutboundMessages.id });
    if (!claimed) { await this.completeOutbox(job.outboxId); return; }
    try {
      if (!await this.links.canSend(message)) { await cancel(); return; }
      const sent = message.messageType === 'INTERACTIVE' && message.interactive
        ? await this.meta.sendInteractive(message.phoneNumberId, message.recipientId, message.body, message.interactive.buttons)
        : await this.meta.sendText(message.phoneNumberId, message.recipientId, message.body);
      await this.database.db.transaction(async (tx) => {
        await tx.insert(whatsappSendAttempts).values({ outboundMessageId: message.id, attempt, httpStatus: 200 });
        await tx.update(whatsappOutboundMessages).set({ status: 'SENT', providerMessageId: sent.providerMessageId, sentAt: new Date(), updatedAt: new Date() })
          .where(eq(whatsappOutboundMessages.id, message.id));
        if (message.linkId) await tx.update(whatsappSessions).set({ lastOutboundAt: new Date(), updatedAt: new Date() }).where(eq(whatsappSessions.linkId, message.linkId));
        await tx.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, job.outboxId));
      });
    } catch (error) {
      const detail = error as MetaSendError;
      const retryable = isRetryableMetaError(detail);
      const final = !retryable || job.attemptsMade + 1 >= job.maxAttempts;
      const reason = describeMetaError(detail);
      await this.database.db.transaction(async (tx) => {
        await tx.insert(whatsappSendAttempts).values({
          outboundMessageId: message.id, attempt, httpStatus: detail.httpStatus,
          providerErrorCode: detail.providerCode !== undefined ? String(detail.providerCode) : null, errorMessage: detail.message,
        });
        await tx.update(whatsappOutboundMessages).set({ status: final ? 'FAILED' : 'QUEUED', failureReason: reason, failedAt: final ? new Date() : null, updatedAt: new Date() })
          .where(and(eq(whatsappOutboundMessages.id, message.id), eq(whatsappOutboundMessages.status, 'SENDING')));
        if (final) await tx.update(integrationOutbox).set({ state: 'FAILED', lastError: reason }).where(eq(integrationOutbox.id, job.outboxId));
      });
      if (!retryable) throw new UnrecoverableError(reason);
      throw error;
    }
  }
}
