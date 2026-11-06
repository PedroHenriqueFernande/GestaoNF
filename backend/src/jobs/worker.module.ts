import { Module } from '@nestjs/common';
import { AssistantModule } from '../assistant/assistant.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { OutboxDispatcherService } from './outbox-dispatcher.service.js';
import { WhatsAppWorkersService } from './whatsapp-workers.service.js';
import { CrmModule } from '../crm/crm.module.js';
import { MeetingReminderWorkerService } from './meeting-reminder-worker.service.js';
import { FilesModule } from '../files/files.module.js';
import { FileCleanupWorkerService } from './file-cleanup-worker.service.js';
import { EmailsModule } from '../emails/emails.module.js';
import { EmailWorkerService } from './email-worker.service.js';
import { UsersModule } from '../users/users.module.js';
import { InvitationExpiryWorkerService } from './invitation-expiry-worker.service.js';
import { FiscalModule } from '../fiscal/fiscal.module.js';
import { NfseWorkerService } from './nfse-worker.service.js';

@Module({
  imports: [DatabaseModule, WhatsAppModule, AssistantModule, CrmModule, FilesModule, EmailsModule, UsersModule, FiscalModule],
  providers: [OutboxDispatcherService, WhatsAppWorkersService, MeetingReminderWorkerService, FileCleanupWorkerService, EmailWorkerService, InvitationExpiryWorkerService, NfseWorkerService],
})
export class WorkerModule {}

