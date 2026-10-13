import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox } from '@gestaonf/database/schema';
import { and, asc, eq, isNull, lt, lte, or } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.module.js';
import { WHATSAPP_INBOUND_QUEUE, WHATSAPP_OUTBOUND_QUEUE, redisConnection } from './queue.js';

@Injectable()
export class OutboxDispatcherService {
  private readonly redis = redisConnection();
  private readonly inbound = new Queue(WHATSAPP_INBOUND_QUEUE, { connection: this.redis as never });
  private readonly outbound = new Queue(WHATSAPP_OUTBOUND_QUEUE, { connection: this.redis as never });

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async dispatchBatch() {
    const stalePublication = new Date(Date.now() - 5 * 60_000);
    const candidates = await this.database.db.select().from(integrationOutbox)
      .where(or(
        and(eq(integrationOutbox.state, 'PENDING'), lte(integrationOutbox.availableAt, new Date())),
        and(eq(integrationOutbox.state, 'PUBLISHED'), isNull(integrationOutbox.completedAt), lt(integrationOutbox.publishedAt, stalePublication)),
      ))
      .orderBy(asc(integrationOutbox.createdAt)).limit(50);
    for (const candidate of candidates) {
      const [claimed] = await this.database.db.update(integrationOutbox)
        .set({ state: 'PUBLISHED', attempts: candidate.attempts + 1, publishedAt: new Date(), lastError: null })
        .where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.state, candidate.state))).returning();
      if (!claimed) continue;
      try {
        const queue = claimed.topic === 'whatsapp.inbound' ? this.inbound : claimed.topic === 'whatsapp.outbound' ? this.outbound : null;
        if (!queue) throw new Error(`Tópico sem consumidor: ${claimed.topic}`);
        await queue.add(claimed.topic, { outboxId: claimed.id, ...claimed.payload }, {
          jobId: claimed.id, attempts: 6, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 500, removeOnFail: 1_000,
        });
      } catch (error) {
        const delay = Math.min(60_000, 1_000 * 2 ** Math.min(claimed.attempts, 6));
        await this.database.db.update(integrationOutbox).set({
          state: claimed.attempts >= 10 ? 'FAILED' : 'PENDING',
          availableAt: new Date(Date.now() + delay), lastError: error instanceof Error ? error.message : String(error),
        }).where(eq(integrationOutbox.id, claimed.id));
      }
    }
  }

  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      await this.dispatchBatch();
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  }

  async close() {
    await Promise.all([this.inbound.close(), this.outbound.close()]);
    this.redis.disconnect();
  }
}
