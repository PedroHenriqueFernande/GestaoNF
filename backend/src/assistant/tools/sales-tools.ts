// backend/src/assistant/tools/sales-tools.ts
import { NotFoundException } from '@nestjs/common';
import { sales } from '@gestaonf/database/schema';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SalesService } from '../../sales/sales.service.js';
import type { Db } from '../db-types.js';
import { money } from '../nero-format.js';
import { rules } from '../nero-policy.js';
import { compact, compactList, label, optionalSearch, orderCodeFrom, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

const SALE_STATUS = { CONFIRMADAS: 'CONFIRMED', RASCUNHOS: 'DRAFT', CANCELADAS: 'CANCELED', TODAS: 'ALL' } as const;
const SITUATION_TEXT = { CONFIRMADAS: 'confirmadas', RASCUNHOS: 'rascunhos', CANCELADAS: 'canceladas', TODAS: 'todas as situações' } as const;
const RESULT_LIMIT = 10;
const listSchema = z.object({
  periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(),
  situacao: z.enum(['CONFIRMADAS', 'RASCUNHOS', 'CANCELADAS', 'TODAS']), busca: optionalSearch(100), escopo: z.enum(['EMPRESA', 'MINHAS']),
}).strict();

export function createSalesListTool(db: Db, salesService: SalesService): ReadTool {
  return {
    kind: 'READ', name: 'consultar_vendas', allowed: rules.anyMember,
    description: 'Consulta vendas da empresa atual: o bloco "confirmadas" traz sempre a quantidade e o total das vendas CONFIRMADAS do período (independente da situação pedida), e "encontrados" traz a quantidade da situação pedida, com os pedidos mais recentes. Rascunhos podem não ter data de venda: para listá-los use SEM_PERIODO, salvo se o usuário der datas. "busca" filtra por cliente, número do pedido ou ordem de serviço. Use escopo MINHAS quando o usuário falar das vendas que ele mesmo lançou.',
    parameters: {
      type: 'object',
      properties: {
        ...periodProperties,
        situacao: { type: 'string', enum: ['CONFIRMADAS', 'RASCUNHOS', 'CANCELADAS', 'TODAS'] },
        busca: { type: ['string', 'null'], description: 'Cliente, número do pedido ou ordem de serviço.' },
        escopo: { type: 'string', enum: ['EMPRESA', 'MINHAS'] },
      },
      required: ['periodo', 'inicio', 'fim', 'situacao', 'busca', 'escopo'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(listSchema, raw);
      const range = resolvePeriod(args, ctx.today, { allowNone: true });
      const search = args.busca ? (orderCodeFrom(args.busca) ?? args.busca) : null;
      const conditions = [eq(sales.companyId, ctx.companyId), eq(sales.status, 'CONFIRMED')];
      if (range) conditions.push(gte(sales.soldOn, range.from), lte(sales.soldOn, range.to));
      if (args.escopo === 'MINHAS') conditions.push(eq(sales.createdByUserId, ctx.userId));
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        conditions.push(sql`(${sales.orderCode} = ${search} OR ${sales.customerNameSnapshot} ILIKE ${pattern} OR ${sales.workOrderNumber} ILIKE ${pattern})`);
      }
      const [totals] = await db.select({ quantity: count(), total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)::numeric(15,2)::text` }).from(sales).where(and(...conditions));

      const result = await salesService.list(
        ctx.companyId,
        { limit: RESULT_LIMIT, offset: 0, status: SALE_STATUS[args.situacao], search: search ?? undefined, from: range?.from, to: range?.to },
        args.escopo === 'MINHAS' ? { createdByUserId: ctx.userId } : undefined,
      );
      const rows = result.items.map((item) => ({ pedido: item.orderCode, cliente: item.customerNameSnapshot, data: item.soldOn, total: item.totalAmount, situacao: label(item.status), os: item.workOrderNumber, lancadoPor: item.createdByUserName }));
      const listed = compactList(rows, RESULT_LIMIT);
      return {
        output: {
          periodo: range ?? 'sem filtro de data',
          confirmadas: { quantidade: totals.quantity, total: totals.total },
          encontrados: { situacao: args.situacao, quantidade: result.total },
          items: listed.items, omitted: Math.max(0, result.total - listed.items.length),
        },
        memory: `Vendas${range ? ` de ${range.from} a ${range.to}` : ''}${args.escopo === 'MINHAS' ? ' (do usuário)' : ''}: ${totals.quantity} confirmadas, total ${money(totals.total)}.${args.situacao === 'CONFIRMADAS' ? '' : ` Encontradas (${SITUATION_TEXT[args.situacao]}): ${result.total}.`}`,
      };
    },
  };
}

export function createSaleDetailTool(db: Db, salesService: SalesService): ReadTool {
  const schema = z.object({
    numero_pedido: z.preprocess((value) => (typeof value === 'string' ? (orderCodeFrom(value) ?? value) : value), z.string().regex(/^\d{5}$/, 'deve ter 5 dígitos')),
  }).strict();
  return {
    kind: 'READ', name: 'consultar_venda', allowed: rules.anyMember,
    description: 'Mostra um pedido pelo número de 5 dígitos (aceita "#12345" ou "pedido 12345"): cliente, itens, parcelas, o que já foi recebido e o que falta.',
    parameters: { type: 'object', properties: { numero_pedido: { type: 'string', description: 'Número do pedido com 5 dígitos.' } }, required: ['numero_pedido'], additionalProperties: false },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const [match] = await db.select({ id: sales.id }).from(sales).where(and(eq(sales.companyId, ctx.companyId), eq(sales.orderCode, args.numero_pedido))).limit(1);
      if (!match) throw new NotFoundException('Pedido não encontrado');
      const sale = await salesService.get(ctx.companyId, match.id);
      const output = compact({
        pedido: sale.orderCode, situacao: label(sale.status), cliente: sale.customerNameSnapshot, data: sale.soldOn, os: sale.workOrderNumber, total: sale.totalAmount,
        quantidadeItens: sale.items.length, quantidadeParcelas: sale.installments.length,
        itens: sale.items.map((item) => ({ servico: item.serviceNameSnapshot, descricao: item.descriptionSnapshot, quantidade: item.quantity, total: item.totalAmount })),
        parcelas: sale.installments.map((part) => ({ numero: part.number, forma: label(part.paymentMethod), valor: part.amount, vencimento: part.dueOn, recebidaEm: part.initialReceivedOn, recebido: part.paidAmount, restante: part.remainingAmount, situacao: label(part.paymentStatus) })),
      }) as Record<string, unknown>;
      return { output, memory: `Pedido ${sale.orderCode}: ${sale.customerNameSnapshot}, ${money(sale.totalAmount)}, ${label(sale.status)}.` };
    },
  };
}
