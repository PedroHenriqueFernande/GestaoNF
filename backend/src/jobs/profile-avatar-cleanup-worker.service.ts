import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { ProfileService } from '../profile/profile.service.js';

@Injectable()
export class ProfileAvatarCleanupWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ProfileAvatarCleanupWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(ProfileService) private readonly profile: ProfileService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 60_000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.profile.cleanup().then(stats => { if (stats.cleaned || stats.failed) this.logger.log({ event: 'avatar_cleanup', ...stats }); })
      .catch(error => this.logger.error({ event: 'avatar_cleanup_failed', errorType: error instanceof Error ? error.name : 'Unknown' }))
      .finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
