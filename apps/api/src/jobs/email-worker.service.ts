import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { EmailDispatchService } from '../emails/email-dispatch.service.js';

@Injectable()
export class EmailWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(EmailWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(EmailDispatchService) private readonly dispatcher: EmailDispatchService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 1000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.dispatcher.dispatchOne().catch(() => { this.logger.error({ event: 'email_worker_failed' }); }).finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
