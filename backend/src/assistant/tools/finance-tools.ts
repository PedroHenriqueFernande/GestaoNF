// backend/src/assistant/tools/finance-tools.ts
import { z } from 'zod';
import type { FinanceReadService } from '../../finance/finance-read.service.js';
import { amount, cents } from '../../sales/sales-money.js';
import { money } from '../nero-format.js';
import { rules } from '../nero-policy.js';
import { compactList, label, optionalSearch, orderCodeFrom, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

const BASIS = { VENDA: 'SALE', VENCIMENTO: 'DUE', RECEBIMENTO: 'RECEIPT' } as const;
const SETTLEMENT = { TODAS: 'ALL', PENDENTES: 'PENDING', PARCIAIS: 'PARTIAL', PAGAS: 'PAID' } as const;
const OVERDUE = { TODAS: 'ALL', SO_VENCIDAS: 'ONLY', SEM_VENCIDAS: 'EXCLUDE' } as const;
const schema = z.object({
  periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(),
  base: z.enum(['VENDA', 'VENCIMENTO', 'RECEBIMENTO']), situacao: z.enum(['TODAS', 'PENDENTES', 'PARCIAIS', 'PAGAS']),
  vencidas: z.enum(['TODAS', 'SO_VENCIDAS', 'SEM_VENCIDAS']), busca: optionalSearch(100),
}).strict();

export function createReceivablesTool(finance: FinanceReadService): ReadTool {
  return {
    kind: 'READ', name: 'contas_a_receber', allowed: rules.anyMember,
    description: 'Contas a receber das vendas confirmadas: total original, recebido, a receber e vencido, e as vendas com parcelas. Para "o que vence este mês" use base VENCIMENTO; para "o que entrou" use base RECEBIMENTO; para atrasados use vencidas SO_VENCIDAS.',
    parameters: {
      type: 'object',
      properties: {
        ...periodProperties,
        base: { type: 'string', enum: ['VENDA', 'VENCIMENTO', 'RECEBIMENTO'] },
        situacao: { type: 'string', enum: ['TODAS', 'PENDENTES', 'PARCIAIS', 'PAGAS'] },
        vencidas: { type: 'string', enum: ['TODAS', 'SO_VENCIDAS', 'SEM_VENCIDAS'] },
        busca: { type: ['string', 'null'], description: 'Cliente ou número do pedido.' },
      },
      required: ['periodo', 'inicio', 'fim', 'base', 'situacao', 'vencidas', 'busca'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const range = resolvePeriod(args, ctx.today, { allowNone: true });
      const orderCode = args.busca ? orderCodeFrom(args.busca) : null;
      const filters = {
        dateBasis: BASIS[args.base], settlement: SETTLEMENT[args.situacao], overdue: OVERDUE[args.vencidas],
        ...(range ? { dateFrom: range.from, dateTo: range.to } : {}),
        ...(args.busca ? (orderCode ? { orderCode } : { search: args.busca }) : {}),
      };
      const [summary, page] = await Promise.all([finance.summary(ctx.companyId, filters), finance.list(ctx.companyId, { ...filters, limit: 10 })]);
      const rows = page.items.map((sale) => {
        const matching = sale.payments.filter((payment) => payment.matchesFilter);
        return {
          pedido: sale.orderCode, cliente: sale.customerName,
          totalDoPedido: sale.totalAmount, recebidoDoPedido: sale.paidAmount, restanteDoPedido: sale.remainingAmount,
          restanteNoFiltro: amount(matching.reduce((sum, payment) => sum + cents(payment.remainingAmount), 0n)),
          parcelas: matching.map((payment) => ({ numero: payment.number, forma: label(payment.paymentMethod), valor: payment.originalAmount, vencimento: payment.dueOn, restante: payment.remainingAmount, situacao: label(payment.settlement), vencida: payment.isOverdue })),
        };
      });
      const active = [
        ...(args.busca ? [orderCode ? `pedido ${orderCode}` : `cliente "${args.busca}"`] : []),
        ...(args.situacao !== 'TODAS' ? [args.situacao.toLowerCase()] : []),
        ...(args.vencidas === 'SO_VENCIDAS' ? ['só vencidas'] : args.vencidas === 'SEM_VENCIDAS' ? ['sem vencidas'] : []),
        ...(range || args.base !== 'VENDA' ? [`base ${args.base.toLowerCase()}${range ? ` de ${range.from} a ${range.to}` : ''}`] : []),
      ];
      return {
        output: { periodo: range ?? 'sem filtro de data', resumo: { vendas: summary.saleCount, parcelas: summary.paymentCount, original: summary.originalAmount, recebido: summary.paidAmount, aReceber: summary.remainingAmount, vencido: summary.overdueAmount }, items: compactList(rows).items, haMais: Boolean(page.nextCursor) },
        memory: `Contas a receber${active.length ? ` (${active.join('; ')})` : ''}: a receber ${money(summary.remainingAmount)}, vencido ${money(summary.overdueAmount)}, recebido ${money(summary.paidAmount)}.`,
      };
    },
  };
}
