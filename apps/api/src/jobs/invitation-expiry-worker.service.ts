import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { UsersService } from '../users/users.service.js';
import { DatabaseService } from '../database/database.module.js';
import { sql } from 'drizzle-orm';
@Injectable()
export class InvitationExpiryWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  private readonly logger = new Logger(InvitationExpiryWorkerService.name);
  constructor(@Inject(UsersService) private readonly users: UsersService, @Inject(DatabaseService) private readonly database: DatabaseService) {}
  onApplicationBootstrap() { this.tick(); this.timer = setInterval(() => this.tick(), 60_000); }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.users.expireDue().then(async () => { await this.database.db.execute(sql`delete from invitation_request_limits where started_at<now()-interval '1 day'`); }).catch(() => { this.logger.error({ event: 'invitation_expiry_failed' }); }).finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
