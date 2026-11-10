import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { OpenAiSupportLlmClient } from './llm/openai-support-llm.client.js';
import { SUPPORT_LLM } from './llm/support-llm.client.js';
import { SupportActionsService } from './support-actions.service.js';
import { SupportChatService } from './support-chat.service.js';
import { SUPPORT_CONFIG, supportConfig, type SupportConfig } from './support-config.js';
import { SupportConversationsService } from './support-conversations.service.js';
import { SupportController } from './support.controller.js';
import { SupportToolRegistry } from './tools/tool-registry.js';

@Module({
  imports: [AuthModule, CustomersModule, ServicesModule, SalesModule, ReportsModule],
  controllers: [SupportController],
  providers: [
    { provide: SUPPORT_CONFIG, useFactory: () => supportConfig() },
    { provide: SUPPORT_LLM, inject: [SUPPORT_CONFIG], useFactory: (config: SupportConfig) => (config.enabled ? new OpenAiSupportLlmClient(config) : null) },
    { provide: SupportHelpCatalog, useFactory: () => SupportHelpCatalog.load() },
    SupportConversationsService, SupportActionsService, SupportToolRegistry, SupportChatService,
  ],
})
export class SupportModule {}
