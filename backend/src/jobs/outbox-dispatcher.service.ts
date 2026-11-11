import { Inject, Injectable } from '@nestjs/common';
import { integrationOutbox, whatsappOutboundMessages } from '@gestaonf/database/schema';
import { and, asc, eq, inArray, isNull, lt, lte, or } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { DatabaseService } from '../database/database.module.js';
import { MAX_PUBLICATIONS, staleDecision } from './outbox-stale.js';
import { WHATSAPP_INBOUND_QUEUE, WHATSAPP_OUTBOUND_QUEUE, redisConnection } from './queue.js';

const burstDelay = () => Math.max(0, Number(process.env.NERO_BURST_MS ?? '2000'));

@Injectable()
export class OutboxDispatcherService {
  private readonly redis = redisConnection();
  private readonly inbound = new Queue(WHATSAPP_INBOUND_QUEUE, { connection: this.redis as never });
  private readonly outbound = new Queue(WHATSAPP_OUTBOUND_QUEUE, { connection: this.redis as never });

  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private queueFor(topic: string) {
    return topic === 'whatsapp.inbound' ? this.inbound : topic === 'whatsapp.outbound' ? this.outbound : null;
  }

  /** Fecha como FAILED a mensagem de saída ligada a um registro de outbox encerrado. */
  private async failOutbound(executor: Pick<DatabaseService['db'], 'update'>, topic: string, payload: unknown, reason: string) {
    const outboundMessageId = (payload as { outboundMessageId?: string } | null)?.outboundMessageId;
    if (topic !== 'whatsapp.outbound' || !outboundMessageId) return;
    await executor.update(whatsappOutboundMessages).set({ status: 'FAILED', failedAt: new Date(), failureReason: reason, updatedAt: new Date() })
      .where(and(eq(whatsappOutboundMessages.id, outboundMessageId), inArray(whatsappOutboundMessages.status, ['QUEUED', 'SENDING'])));
  }

  /** Trata um registro PUBLISHED vencido. Retorna true quando ele deve ser republicado. */
  private async settleStale(candidate: typeof integrationOutbox.$inferSelect) {
    const queue = this.queueFor(candidate.topic);
    if (!queue) return true;
    const decision = staleDecision(await queue.getJobState(candidate.id), candidate.attempts);
    if (decision === 'REPUBLISH') return true;
    if (decision === 'WAIT') {
      await this.database.db.update(integrationOutbox).set({ publishedAt: new Date() }).where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.state, 'PUBLISHED')));
    } else if (decision === 'COMPLETE') {
      await this.database.db.update(integrationOutbox).set({ state: 'COMPLETED', completedAt: new Date() }).where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.state, 'PUBLISHED')));
    } else {
      const reason = candidate.attempts >= MAX_PUBLICATIONS ? 'Limite de republicações atingido' : 'Job esgotou as tentativas na fila';
      await this.database.db.transaction(async (tx) => {
        await tx.update(integrationOutbox).set({ state: 'FAILED', lastError: reason }).where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.state, 'PUBLISHED')));
        await this.failOutbound(tx, candidate.topic, candidate.payload, reason);
      });
    }
    return false;
  }

  private async dispatchBatch() {
    const stalePublication = new Date(Date.now() - 5 * 60_000);
    const candidates = await this.database.db.select().from(integrationOutbox)
      .where(and(inArray(integrationOutbox.topic, ['whatsapp.inbound', 'whatsapp.outbound']), or(
        and(eq(integrationOutbox.state, 'PENDING'), lte(integrationOutbox.availableAt, new Date())),
        and(eq(integrationOutbox.state, 'PUBLISHED'), isNull(integrationOutbox.completedAt), lt(integrationOutbox.publishedAt, stalePublication)),
      )))
      .orderBy(asc(integrationOutbox.createdAt)).limit(50);
    for (const candidate of candidates) {
      if (candidate.state === 'PUBLISHED' && !(await this.settleStale(candidate))) continue;
      const [claimed] = await this.database.db.update(integrationOutbox)
        .set({ state: 'PUBLISHED', attempts: candidate.attempts + 1, publishedAt: new Date(), lastError: null })
        .where(and(eq(integrationOutbox.id, candidate.id), eq(integrationOutbox.state, candidate.state))).returning();
      if (!claimed) continue;
      try {
        const queue = this.queueFor(claimed.topic);
        if (!queue) throw new Error(`Tópico sem consumidor: ${claimed.topic}`);
        await queue.add(claimed.topic, { outboxId: claimed.id, ...claimed.payload }, {
          jobId: claimed.id, attempts: 6, backoff: { type: 'exponential', delay: 1_000 }, removeOnComplete: 500, removeOnFail: 1_000,
          delay: claimed.topic === 'whatsapp.inbound' ? burstDelay() : 0,
        });
      } catch (error) {
        const delay = Math.min(60_000, 1_000 * 2 ** Math.min(claimed.attempts, 6));
        const message = error instanceof Error ? error.message : String(error);
        const final = claimed.attempts >= MAX_PUBLICATIONS;
        await this.database.db.transaction(async (tx) => {
          await tx.update(integrationOutbox).set({
            state: final ? 'FAILED' : 'PENDING', availableAt: new Date(Date.now() + delay), lastError: message,
          }).where(eq(integrationOutbox.id, claimed.id));
          if (final) await this.failOutbound(tx, claimed.topic, claimed.payload, 'Limite de republicações atingido');
        });
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
