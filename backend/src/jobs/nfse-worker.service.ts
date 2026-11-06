import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { integrationOutbox, nfseDocumentEvents, nfseDps } from '@gestaonf/database/schema';
import { and, asc, eq, inArray, lt, lte, or, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { NfseProcessorService } from '../fiscal/nfse-processor.service.js';
import { NfseEventProcessorService } from '../fiscal/nfse-event-processor.service.js';

@Injectable()
export class NfseWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(NfseWorkerService.name);
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(NfseProcessorService) private readonly processor: NfseProcessorService, @Inject(NfseEventProcessorService) private readonly events: NfseEventProcessorService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 1000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.dispatchOne().catch(() => this.logger.error({ event: 'nfse_worker_failed' })).finally(() => { this.running = null; });
  }
  async dispatchOne() {
    const job = await this.database.db.transaction(async tx => {
      const [next] = await tx.select().from(integrationOutbox).where(and(inArray(integrationOutbox.topic, ['nfse.process', 'nfse.archive', 'nfse.event']), or(and(eq(integrationOutbox.state, 'PENDING'), lte(integrationOutbox.availableAt, new Date())), and(eq(integrationOutbox.state, 'PUBLISHED'), lt(integrationOutbox.publishedAt, new Date(Date.now() - 240000)))))).orderBy(asc(integrationOutbox.createdAt)).for('update', { skipLocked: true }).limit(1);
      if (!next) return null;
      const [claimed] = await tx.update(integrationOutbox).set({ state: 'PUBLISHED', attempts: next.attempts + 1, publishedAt: new Date(), lastError: null }).where(eq(integrationOutbox.id, next.id)).returning();
      return claimed;
    });
    if (!job) return;
    const companyId = String(job.payload.companyId ?? '');
    try {
      const result = job.topic === 'nfse.archive' ? (await this.processor.archive(companyId, String(job.payload.documentId ?? '')), 'DONE')
        : job.topic === 'nfse.event' ? await this.events.process(companyId, String(job.payload.eventId ?? ''))
        : await this.processor.process(companyId, String(job.payload.dpsId ?? ''));
      const retry = result === 'WAIT' || result === 'UNKNOWN' && job.attempts < 8;
      const delay = result === 'WAIT' ? 5000 : Math.min(900000, 15000 * 2 ** Math.min(job.attempts, 6));
      await this.database.db.update(integrationOutbox).set({ state: retry ? 'PENDING' : 'COMPLETED', availableAt: new Date(Date.now() + delay), completedAt: retry ? null : new Date() }).where(eq(integrationOutbox.id, job.id));
      if (result === 'UNKNOWN' && job.topic === 'nfse.event') await this.database.db.update(nfseDocumentEvents).set({ nextActionAt: retry ? new Date(Date.now() + delay) : null }).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.id, String(job.payload.eventId)), eq(nfseDocumentEvents.status, 'UNKNOWN')));
      else if (result === 'UNKNOWN') await this.database.db.update(nfseDps).set({ nextActionAt: retry ? new Date(Date.now() + delay) : null }).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.id, String(job.payload.dpsId)), eq(nfseDps.status, 'UNKNOWN')));
    } catch {
      await this.database.db.update(integrationOutbox).set({ state: job.attempts < 8 ? 'PENDING' : 'FAILED', availableAt: new Date(Date.now() + 60000), lastError: 'Processamento fiscal pendente. Consulte o recurso fiscal.' }).where(eq(integrationOutbox.id, job.id));
    }
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
