import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, whatsappConnections, whatsappOutboundMessages, whatsappSendAttempts, whatsappSessions } from '@gestaonf/database/schema';
import { and, count, eq, inArray } from 'drizzle-orm';
import { Worker } from 'bullmq';
import { NiloService } from '../assistant/nilo.service.js';
import { DatabaseService } from '../database/database.module.js';
import { MetaCloudClient } from '../whatsapp/meta-cloud.client.js';
import { WhatsAppLinkService } from '../whatsapp/whatsapp-link.service.js';
import { WHATSAPP_INBOUND_QUEUE, WHATSAPP_OUTBOUND_QUEUE, redisConnection } from './queue.js';

@Injectable()
export class WhatsAppWorkersService {
  private readonly redis = redisConnection();
  private inbound?: Worker;
  private outbound?: Worker;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NiloService) private readonly nilo: NiloService,
    @Inject(MetaCloudClient) private readonly meta: MetaCloudClient,
    @Inject(WhatsAppLinkService) private readonly links: WhatsAppLinkService,
  ) {}

  start() {
    this.inbound = new Worker(WHATSAPP_INBOUND_QUEUE, async (job) => {
      await this.nilo.processInboxEvent(String(job.data.inboxEventId));
      await this.database.db.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, String(job.data.outboxId)));
    }, { connection: this.redis as never, concurrency: Number(process.env.NILO_WORKER_CONCURRENCY ?? '4') });

    this.outbound = new Worker(WHATSAPP_OUTBOUND_QUEUE, async (job) => {
      const messageId = String(job.data.outboundMessageId);
      const [message] = await this.database.db.select({
        id: whatsappOutboundMessages.id, status: whatsappOutboundMessages.status,
        recipientId: whatsappOutboundMessages.recipientId, body: whatsappOutboundMessages.body,
        connectionId: whatsappOutboundMessages.connectionId, linkId: whatsappOutboundMessages.linkId,
        companyId: whatsappOutboundMessages.companyId, companyLinkId: whatsappOutboundMessages.companyLinkId, requestId: whatsappOutboundMessages.requestId,
        phoneNumberId: whatsappConnections.phoneNumberId,
      }).from(whatsappOutboundMessages).innerJoin(whatsappConnections, eq(whatsappConnections.id, whatsappOutboundMessages.connectionId))
        .where(eq(whatsappOutboundMessages.id, messageId)).limit(1);
      if (!message) throw new Error('Mensagem de saída não encontrada');
      if (['SENT', 'DELIVERED', 'READ', 'CANCELED'].includes(message.status)) return;
      const cancel = async () => {
        await this.database.db.transaction(async (tx) => {
          await tx.update(whatsappOutboundMessages).set({ status: 'CANCELED', failureReason: 'Vínculo, acesso ou solicitação indisponível', updatedAt: new Date() }).where(eq(whatsappOutboundMessages.id, message.id));
          await tx.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, String(job.data.outboxId)));
        });
      };
      if (!await this.links.canSend(message)) {
        await cancel();
        return;
      }
      const [attemptRow] = await this.database.db.select({ count: count() }).from(whatsappSendAttempts)
        .where(eq(whatsappSendAttempts.outboundMessageId, message.id));
      const attempt = attemptRow.count + 1;
      const [claimed] = await this.database.db.update(whatsappOutboundMessages).set({ status: 'SENDING', updatedAt: new Date() })
        .where(and(eq(whatsappOutboundMessages.id, message.id), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING']))).returning({ id: whatsappOutboundMessages.id });
      if (!claimed) {
        await this.database.db.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, String(job.data.outboxId)));
        return;
      }
      try {
        if (!await this.links.canSend(message)) { await cancel(); return; }
        const sent = await this.meta.sendText(message.phoneNumberId, message.recipientId, message.body);
        await this.database.db.transaction(async (tx) => {
          await tx.insert(whatsappSendAttempts).values({ outboundMessageId: message.id, attempt, httpStatus: 200 });
          await tx.update(whatsappOutboundMessages).set({ status: 'SENT', providerMessageId: sent.providerMessageId, sentAt: new Date(), updatedAt: new Date() })
            .where(eq(whatsappOutboundMessages.id, message.id));
          if (message.linkId) await tx.update(whatsappSessions).set({ lastOutboundAt: new Date(), updatedAt: new Date() }).where(eq(whatsappSessions.linkId, message.linkId));
          await tx.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, String(job.data.outboxId)));
        });
      } catch (error) {
        const detail = error as Error & { providerCode?: number; httpStatus?: number };
        await this.database.db.transaction(async (tx) => {
          await tx.insert(whatsappSendAttempts).values({
            outboundMessageId: message.id, attempt, httpStatus: detail.httpStatus,
            providerErrorCode: detail.providerCode ? String(detail.providerCode) : null, errorMessage: detail.message,
          });
          await tx.update(whatsappOutboundMessages).set({ status: 'QUEUED', failureReason: detail.message, updatedAt: new Date() })
            .where(and(eq(whatsappOutboundMessages.id, message.id), eq(whatsappOutboundMessages.status, 'SENDING')));
        });
        throw error;
      }
    }, { connection: this.redis as never, concurrency: Number(process.env.WHATSAPP_SEND_CONCURRENCY ?? '8'), limiter: { max: 40, duration: 1_000 } });
  }

  async close() {
    await Promise.all([this.inbound?.close(), this.outbound?.close()]);
    this.redis.disconnect();
  }
}

