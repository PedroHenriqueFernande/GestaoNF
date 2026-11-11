// backend/src/assistant/tools/index.ts
import type { DatabaseService } from '../../database/database.module.js';
import { ToolRegistry } from './registry.js';
import { createSalesReportTool } from './sales-report.tool.js';
import { newTopicTool, switchCompanyTool } from './session-tools.js';

/** Registro padrão da Fase 0. Fases seguintes acrescentam ferramentas aqui. */
export function createToolRegistry(database: DatabaseService) {
  return new ToolRegistry()
    .registerRead(createSalesReportTool(database.db))
    .registerRead(switchCompanyTool)
    .registerRead(newTopicTool);
}
