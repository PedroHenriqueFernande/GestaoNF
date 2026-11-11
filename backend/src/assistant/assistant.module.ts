import { Module } from '@nestjs/common';
import { DatabaseService } from '../database/database.module.js';
import { WhatsAppModule } from '../whatsapp/whatsapp.module.js';
import { ActionService } from './actions/action.service.js';
import { AgentOrchestrator } from './agent-orchestrator.service.js';
import { ConversationService } from './conversation.service.js';
import { NERO_MODEL, OpenAINeroModel } from './model/nero-model.js';
import { NiloService } from './nilo.service.js';
import { createToolRegistry } from './tools/index.js';
import { ToolRegistry } from './tools/registry.js';

@Module({
  imports: [WhatsAppModule],
  providers: [
    { provide: ToolRegistry, useFactory: (database: DatabaseService) => createToolRegistry(database), inject: [DatabaseService] },
    { provide: NERO_MODEL, useFactory: () => new OpenAINeroModel() },
    ConversationService, ActionService, AgentOrchestrator, NiloService,
  ],
  exports: [NiloService, ConversationService],
})
export class AssistantModule {}
