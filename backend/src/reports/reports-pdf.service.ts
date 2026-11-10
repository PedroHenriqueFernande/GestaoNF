import { Inject, Injectable } from '@nestjs/common';
import { companies } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { CrmContext } from '../crm/crm.schemas.js';
import { ReportsReadService } from './reports-read.service.js';
import { reportFilename, reportPdfDefinitions, type PdfSummaryItem } from './report-pdf-definitions.js';
import { formatCell, renderReportPdf } from './reports-pdf.js';
import type { ReportInput, ReportType } from './reports.schemas.js';

export const reportsPdfMaxRows = () => Number(process.env.REPORTS_PDF_MAX_ROWS) || 5000;
type SummaryDefinition = { summary: PdfSummaryItem[] };

/** Indicadores do PDF: mesmos da tela; valor nulo é omitido (ex.: recebido/pendente com filtro de serviço), exceto onde há texto próprio. */
export function buildSummary(definition: SummaryDefinition, summary: Record<string, unknown>, timezone: string) {
  return definition.summary.flatMap((item) => {
    const value = summary[item.key];
    if (value === null || value === undefined) return item.empty ? [{ label: item.label, value: item.empty }] : [];
    return [{ label: item.label, value: formatCell(value, item.format, timezone) }];
  });
}

const brDate = (value: string) => value.split('-').reverse().join('/');

@Injectable()
export class ReportsPdfService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(ReportsReadService) private readonly reader: ReportsReadService) {}

  async create(ctx: CrmContext, type: ReportType, input: ReportInput) {
    const maxRows = reportsPdfMaxRows();
    const data = await this.reader.readAll(ctx, type, input, maxRows);
    const [company] = await this.database.db.select({ name: companies.name }).from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    const definition = reportPdfDefinitions[type];
    const buffer = await renderReportPdf({
      title: definition.title,
      companyName: company?.name ?? '',
      periodLabel: input.from && input.to ? `Período: ${brDate(input.from)} a ${brDate(input.to)}` : 'Todos os registros',
      generatedAt: new Date(),
      timezone: data.timezone,
      summary: buildSummary(definition, data.summary, data.timezone),
      columns: definition.columns,
      rows: data.rows,
    });
    return { buffer, filename: reportFilename(type, input.from, input.to) };
  }
}
