import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import { Worker } from 'bullmq';
import { NiloService } from '../assistant/nilo.service.js';
import { DatabaseService } from '../database/database.module.js';
import { WhatsAppSendService } from '../whatsapp/whatsapp-send.service.js';
import { WHATSAPP_INBOUND_QUEUE, WHATSAPP_OUTBOUND_QUEUE, redisConnection } from './queue.js';

@Injectable()
export class WhatsAppWorkersService {
  private readonly redis = redisConnection();
  private inbound?: Worker;
  private outbound?: Worker;

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(NiloService) private readonly nilo: NiloService,
    @Inject(WhatsAppSendService) private readonly sender: WhatsAppSendService,
  ) {}

  start() {
    this.inbound = new Worker(WHATSAPP_INBOUND_QUEUE, async (job) => {
      const outboxId = String(job.data.outboxId);
      try {
        await this.nilo.processInboxEvent(String(job.data.inboxEventId));
        await this.database.db.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(eq(integrationOutbox.id, outboxId));
      } catch (error) {
        if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
          await this.database.db.update(integrationOutbox).set({ state: 'FAILED', lastError: error instanceof Error ? error.message : String(error) }).where(eq(integrationOutbox.id, outboxId));
        }
        throw error;
      }
    }, { connection: this.redis as never, concurrency: Number(process.env.NILO_WORKER_CONCURRENCY ?? '4') });

    this.outbound = new Worker(WHATSAPP_OUTBOUND_QUEUE, async (job) => this.sender.process({
      outboundMessageId: String(job.data.outboundMessageId), outboxId: String(job.data.outboxId),
      attemptsMade: job.attemptsMade, maxAttempts: job.opts.attempts ?? 1,
    }), { connection: this.redis as never, concurrency: Number(process.env.WHATSAPP_SEND_CONCURRENCY ?? '8'), limiter: { max: 40, duration: 1_000 } });
  }

  async close() {
    await Promise.all([this.inbound?.close(), this.outbound?.close()]);
    this.redis.disconnect();
  }
}
