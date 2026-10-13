import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EmailsController, ResendWebhookController } from './emails.controller.js';
import { EmailsService } from './emails.service.js';
import { ResendProviderService } from './resend-provider.service.js';
import { EmailDispatchService } from './email-dispatch.service.js';
import { EmailPayloadService } from './email-payload.service.js';

@Module({ imports: [AuthModule], controllers: [EmailsController, ResendWebhookController], providers: [EmailsService, ResendProviderService, EmailDispatchService, EmailPayloadService], exports: [EmailsService, EmailDispatchService, ResendProviderService, EmailPayloadService] })
export class EmailsModule {}
