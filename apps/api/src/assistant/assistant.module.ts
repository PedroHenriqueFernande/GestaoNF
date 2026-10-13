import { Module } from '@nestjs/common';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { NiloService } from './nilo.service.js';
import { CompanyRequestService } from './company-request.service.js';

@Module({ imports: [WhatsAppModule], providers: [NiloService, CompanyRequestService], exports: [NiloService] })
export class AssistantModule {}
