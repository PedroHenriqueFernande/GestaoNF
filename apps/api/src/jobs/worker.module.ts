import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { WhatsAppWorkersService } from './whatsapp-workers.service.js';
import { CrmModule } from '../crm/crm.module.js';
import { MeetingReminderWorkerService } from './meeting-reminder-worker.service.js';

@Module({
  imports: [DatabaseModule, WhatsAppModule, AssistantModule, CrmModule],
  providers: [OutboxDispatcherService, WhatsAppWorkersService, MeetingReminderWorkerService],
})
export class WorkerModule {}

