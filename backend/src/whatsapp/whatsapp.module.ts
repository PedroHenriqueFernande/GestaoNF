import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MetaCloudClient } from './meta-cloud.client.js';
import { MetaSignatureService } from './meta-signature.service.js';
import { MetaWebhookController } from './meta-webhook.controller.js';
import { WhatsAppIngressService } from './whatsapp-ingress.service.js';
import { WhatsAppLinkController } from './whatsapp-link.controller.js';
import { WhatsAppLinkService } from './whatsapp-link.service.js';
import { WhatsAppOutboundService } from './whatsapp-outbound.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MetaWebhookController, WhatsAppLinkController],
  providers: [MetaCloudClient, MetaSignatureService, WhatsAppIngressService, WhatsAppLinkService, WhatsAppOutboundService],
  exports: [MetaCloudClient, WhatsAppLinkService, WhatsAppOutboundService],
})
export class WhatsAppModule {}
