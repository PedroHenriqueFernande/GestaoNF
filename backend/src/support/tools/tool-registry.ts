import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.module.js';
import { ReportsReadService } from '../../reports/reports-read.service.js';
import { SalesService } from '../../sales/sales.service.js';
import { SupportHelpCatalog } from '../help-catalog.js';
import { SupportActionsService } from '../support-actions.service.js';
import { isSafeBlock } from '../support-blocks.js';
import { httpMessage } from '../support-errors.js';
import { customerDraftTool } from './customer-draft.tool.js';
import { findSaleTool } from './find-sale.tool.js';
import { helpTool } from './help.tool.js';
import { navigateTool } from './navigate.tool.js';
import { reportPdfTool } from './report-pdf.tool.js';
import { serviceDraftTool } from './service-draft.tool.js';
import { issues, type ToolContext, type ToolResult, type ToolSpec } from './tool-types.js';

@Injectable()
export class SupportToolRegistry {
  private readonly tools: Map<string, ToolSpec<any>>;

  constructor(
    @Inject(SupportHelpCatalog) catalog: SupportHelpCatalog,
    @Inject(SupportActionsService) actions: SupportActionsService,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(SalesService) sales: SalesService,
    @Inject(ReportsReadService) reports: ReportsReadService,
  ) {
    const all: ToolSpec<any>[] = [helpTool(catalog), navigateTool(), reportPdfTool(reports), findSaleTool(sales), customerDraftTool(actions, database), serviceDraftTool(actions)];
    this.tools = new Map(all.map((tool) => [tool.definition.name, tool]));
  }

  definitions() { return [...this.tools.values()].map((tool) => tool.definition); }

  async run(ctx: ToolContext, name: string, rawArguments: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { output: { ok: false, erro: 'Ferramenta inexistente.' }, blocks: [] };
    let parsed: unknown;
    try { parsed = JSON.parse(rawArguments); } catch { return { output: { ok: false, erro: 'Argumentos em JSON inválido.' }, blocks: [] }; }
    const args = tool.schema.safeParse(parsed);
    if (!args.success) return { output: { ok: false, erro: 'Argumentos inválidos.', detalhes: issues(args.error) }, blocks: [] };
    try {
      const result = await tool.run(ctx, args.data);
      return { output: result.output, blocks: result.blocks.filter(isSafeBlock) };
    } catch (error) {
      if (error instanceof HttpException) return { output: { ok: false, erro: httpMessage(error) }, blocks: [] };
      throw error;
    }
  }
}
