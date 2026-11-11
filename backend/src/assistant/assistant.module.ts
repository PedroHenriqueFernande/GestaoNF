import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { CustomersService } from '../customers/customers.service.js';
import { DatabaseService } from '../database/database.module.js';
import { FinanceModule } from '../finance/finance.module.js';
import { FinanceReadService } from '../finance/finance-read.service.js';
import { ReportsModule } from '../reports/reports.module.js';
import { ReportsReadService } from '../reports/reports-read.service.js';
import { SalesModule } from '../sales/sales.module.js';
import { SalesService } from '../sales/sales.service.js';
import { ServicesModule } from '../services/services.module.js';
import { ServicesService } from '../services/services.service.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { ActionService } from './actions/action.service.js';
import { AgentOrchestrator } from './agent-orchestrator.service.js';
import { AudioTranscriptionService } from './audio/audio-transcription.service.js';
import { NERO_TRANSCRIBER, OpenAITranscriber } from './audio/transcriber.js';
import { ConversationService } from './conversation.service.js';
import { NERO_MODEL, OpenAINeroModel } from './model/nero-model.js';
import { NiloService } from './nilo.service.js';
import { createToolRegistry } from './tools/index.js';
import { ToolRegistry } from './tools/registry.js';

@Module({
  imports: [WhatsAppModule, CustomersModule, ServicesModule, SalesModule, FinanceModule, ReportsModule],
  providers: [
    {
      provide: ToolRegistry,
      useFactory: (database: DatabaseService, customers: CustomersService, services: ServicesService, sales: SalesService, finance: FinanceReadService, reports: ReportsReadService) =>
        createToolRegistry(database, { customers, services, sales, finance, reports }),
      inject: [DatabaseService, CustomersService, ServicesService, SalesService, FinanceReadService, ReportsReadService],
    },
    { provide: NERO_MODEL, useFactory: () => new OpenAINeroModel() },
    { provide: NERO_TRANSCRIBER, useFactory: () => new OpenAITranscriber() },
    AudioTranscriptionService,
    ConversationService, ActionService, AgentOrchestrator, NiloService,
  ],
  exports: [NiloService, ConversationService],
})
export class AssistantModule {}
