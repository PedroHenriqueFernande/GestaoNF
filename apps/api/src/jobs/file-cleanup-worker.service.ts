import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { FilesService } from '../files/files.service.js';

@Injectable()
export class FileCleanupWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FileCleanupWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(FilesService) private readonly files: FilesService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 60_000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.files.cleanup().then(stats => { if (stats.cleaned || stats.failed) this.logger.log({ event: 'files_cleanup', ...stats }); })
      .catch(error => this.logger.error({ event: 'files_cleanup_failed', errorType: error instanceof Error ? error.name : 'Unknown' })).finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
