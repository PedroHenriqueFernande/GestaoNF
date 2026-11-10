import { z } from 'zod';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import { reportsPdfMaxRows } from '../../reports/reports-pdf.service.js';
import { reportFiltersSchema, reportTypes, type ReportType } from '../../reports/reports.schemas.js';
import { downloadBlock, reportTitles } from '../support-blocks.js';
import { issues, type ToolSpec } from './tool-types.js';

type Args = { tipo: ReportType; de: string | null; ate: string | null };
const date = z.string().regex(/^(19|20)\d{2}-\d{2}-\d{2}$/);

export function reportPdfTool(reports: ReportsReadService): ToolSpec<Args> {
  return {
    definition: {
      type: 'function', name: 'gerar_relatorio_pdf', strict: true,
      description: `Gera o link de download do PDF de um relatório. Tipos: ${reportTypes.map((type) => `${type} (${reportTitles[type]})`).join(', ')}. ` +
        'Clientes e catálogo aceitam período nulo (todos os registros); os demais exigem de/ate em YYYY-MM-DD, até 366 dias.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: [...reportTypes] },
          de: { type: ['string', 'null'], description: 'Data inicial YYYY-MM-DD ou null' },
          ate: { type: ['string', 'null'], description: 'Data final YYYY-MM-DD ou null' },
        },
        required: ['tipo', 'de', 'ate'], additionalProperties: false,
      },
    },
    schema: z.strictObject({ tipo: z.enum(reportTypes), de: date.nullable(), ate: date.nullable() }),
    async run(ctx, { tipo, de, ate }) {
      const filters = reportFiltersSchema.safeParse({ ...(de && ate ? { from: de, to: ate } : {}), limit: 1 });
      if (!filters.success) return { output: { ok: false, erro: issues(filters.error).join('; ') }, blocks: [] };
      const crm = { companyId: ctx.companyId, userId: ctx.userId };
      const result = await reports.read(crm, tipo, filters.data);
      const maxRows = reportsPdfMaxRows();
      if (await reports.countPdfRows(crm, tipo, filters.data) > maxRows) {
        return { output: { ok: false, erro: `O PDF aceita até ${maxRows} linhas. Reduza o período ou refine os filtros.` }, blocks: [] };
      }
      return {
        output: { ok: true, relatorio: reportTitles[tipo], periodo: de && ate ? { de, ate } : null, resumo: result.summary },
        blocks: [downloadBlock(tipo, de && ate ? de : null, de && ate ? ate : null)],
      };
    },
  };
}
