import { Inject, Injectable, Logger, type OnModuleDestroy, type OnApplicationBootstrap } from '@nestjs/common';
import { MeetingReminderService } from '../crm/meeting-reminder.service.js';

@Injectable()
export class MeetingReminderWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MeetingReminderWorkerService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<void> | null = null;
  private stopping = false;
  constructor(@Inject(MeetingReminderService) private readonly reminders: MeetingReminderService) {}
  onApplicationBootstrap() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 15_000);
  }
  private tick() {
    if (this.running || this.stopping) return;
    this.running = this.reminders.dispatchDue().then((stats) => {
      if (stats.delivered || stats.canceled || stats.expired) this.logger.log({ event: 'meeting_reminders_batch', ...stats });
    }).catch((error: unknown) => this.logger.error({ event: 'meeting_reminders_failed', message: error instanceof Error ? error.message : String(error) }))
      .finally(() => { this.running = null; });
  }
  async onModuleDestroy() { this.stopping = true; if (this.timer) clearInterval(this.timer); await this.running; }
}
