import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { CompanyLogoService } from '../companies/company-logo.service.js';

@Injectable()
export class CompanyLogoCleanupWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CompanyLogoCleanupWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(CompanyLogoService) private readonly logos: CompanyLogoService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 60_000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.logos.cleanup().then(stats => { if (stats.cleaned || stats.failed) this.logger.log({ event: 'company_logo_cleanup', ...stats }); })
      .catch(error => this.logger.error({ event: 'company_logo_cleanup_failed', errorType: error instanceof Error ? error.name : 'Unknown' }))
      .finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
