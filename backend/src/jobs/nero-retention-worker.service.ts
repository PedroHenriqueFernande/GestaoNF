import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ConversationService } from '../assistant/conversation.service.js';

/** Apaga o conteúdo das conversas do Nero com mais de 30 dias (spec, seção 5). */
@Injectable()
export class NeroRetentionWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NeroRetentionWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(ConversationService) private readonly conversations: ConversationService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 3_600_000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.conversations.purgeOlderThan(30).then((removed) => { if (removed) this.logger.log({ event: 'nero_retention', removed }); })
      .catch((error) => this.logger.error({ event: 'nero_retention_failed', errorType: error instanceof Error ? error.name : 'Unknown' })).finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
