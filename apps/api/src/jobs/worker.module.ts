import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { WhatsAppWorkersService } from './whatsapp-workers.service.js';

@Module({
  imports: [DatabaseModule, WhatsAppModule, AssistantModule],
  providers: [OutboxDispatcherService, WhatsAppWorkersService],
})
export class WorkerModule {}

