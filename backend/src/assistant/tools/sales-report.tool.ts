// backend/src/assistant/tools/sales-report.tool.ts
import { BadRequestException } from '@nestjs/common';
import { sales } from '@gestaonf/database/schema';
import { and, count, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Db } from '../db-types.js';
import { rules } from '../nero-policy.js';
import { money } from '../nero-format.js';
import type { ReadTool } from './types.js';

const MAX_RANGE_DAYS = 366;
const CUSTOM_RANGE_MESSAGE = `Informe data inicial e final no formato AAAA-MM-DD, com no máximo ${MAX_RANGE_DAYS} dias`;

const argumentsSchema = z.object({
  period: z.enum(['THIS_MONTH', 'LAST_MONTH', 'CUSTOM']),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  scope: z.enum(['COMPANY', 'USER']),
});

/** Converte AAAA-MM-DD em UTC apenas se for uma data real de calendário. */
function parseIsoDate(value: string | null | undefined) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return time;
}

function parseArguments(raw: unknown) {
  const parsed = argumentsSchema.safeParse(raw);
  if (!parsed.success) throw new BadRequestException('Informe o período (este mês, mês passado ou datas) e o escopo (empresa ou usuário) do relatório');
  return parsed.data;
}

function rangeFor(args: z.infer<typeof argumentsSchema>, today: string) {
  if (args.period === 'CUSTOM') {
    const start = parseIsoDate(args.startDate);
    const end = parseIsoDate(args.endDate);
    if (start === null || end === null || start > end || (end - start) / 86_400_000 + 1 > MAX_RANGE_DAYS) throw new BadRequestException(CUSTOM_RANGE_MESSAGE);
    return { from: args.startDate as string, to: args.endDate as string };
  }
  const [year, month] = today.split('-').map(Number);
  const offset = args.period === 'LAST_MONTH' ? -1 : 0;
  const first = new Date(Date.UTC(year, month - 1 + offset, 1));
  const last = new Date(Date.UTC(year, month + offset, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function createSalesReportTool(db: Db): ReadTool {
  return {
    kind: 'READ',
    name: 'get_sales_report',
    description: 'Consulta vendas confirmadas da empresa atual e devolve total, quantidade e pedidos recentes.',
    parameters: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['THIS_MONTH', 'LAST_MONTH', 'CUSTOM'] },
        startDate: { type: ['string', 'null'], description: 'Data inicial no formato AAAA-MM-DD para CUSTOM; null nos períodos prontos.' },
        endDate: { type: ['string', 'null'], description: 'Data final no formato AAAA-MM-DD para CUSTOM (intervalo de no máximo 366 dias); null nos períodos prontos.' },
        scope: { type: 'string', enum: ['COMPANY', 'USER'], description: 'COMPANY para todas as vendas; USER para as vendas criadas pelo próprio usuário.' },
      },
      required: ['period', 'startDate', 'endDate', 'scope'],
      additionalProperties: false,
    },
    allowed: rules.anyMember,
    async run(ctx, raw) {
      const args = parseArguments(raw);
      const { from, to } = rangeFor(args, ctx.today);
      const conditions = [eq(sales.companyId, ctx.companyId), eq(sales.status, 'CONFIRMED'), gte(sales.soldOn, from), lte(sales.soldOn, to)];
      if (args.scope === 'USER') conditions.push(eq(sales.createdByUserId, ctx.userId));
      const where = and(...conditions);
      const [totals] = await db.select({ saleCount: count(), totalAmount: sql<string>`coalesce(sum(${sales.totalAmount}), '0')` }).from(sales).where(where);
      const recentSales = await db.select({ orderCode: sales.orderCode, customer: sales.customerNameSnapshot, soldOn: sales.soldOn, total: sales.totalAmount })
        .from(sales).where(where).orderBy(desc(sales.soldOn), desc(sales.createdAt)).limit(10);
      const total = Number(totals.totalAmount);
      return {
        output: { from, to, saleCount: totals.saleCount, totalAmount: total.toFixed(2), recentSales },
        memory: `Relatório de vendas de ${from} a ${to}: ${totals.saleCount} vendas, total ${money(total)}.`,
      };
    },
  };
}
