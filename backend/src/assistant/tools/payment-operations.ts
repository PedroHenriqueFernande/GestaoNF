// backend/src/assistant/tools/payment-operations.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { amount, cents } from '../../sales/sales-money.js';
import { receiptSchema } from '../../sales/sales.schemas.js';
import type { SalesPaymentsService } from '../../sales/sales-payments.service.js';
import type { SalesService, SalesTx } from '../../sales/sales.service.js';
import { rules } from '../nero-policy.js';
import { brDate, findInstallment, findSale, isoDate, money, orderNumber, PAYMENT_METHODS, PAYMENT_NAMES, paymentLabel, toMoney } from './sale-support.js';
import type { WriteOperation } from './types.js';
import { VERSION_CONFLICT_MESSAGE } from './write-support.js';

/** Pedido e recebível são travados (nessa ordem, como o domínio) antes de ler a versão, para nenhuma baixa pela web passar entre a leitura e o `InTx`.
 *
 * Versão da parcela: recebível, quantidade de movimentos (todo recebimento ou estorno cria um), valor original e versão do pedido.
 * A edição da venda pela web muda o valor da parcela sem criar movimento e incrementa `sales.version`; recebimento e estorno não incrementam. */
const installmentVersion = (receivable: { id: string; originalAmount: string }, movementCount: number, saleVersion: number) => `${receivable.id}:${movementCount}:${receivable.originalAmount}:${saleVersion}`;
const assertVersion = (actual: string, expected: string | undefined) => { if (expected !== undefined && actual !== expected) throw new ConflictException(VERSION_CONFLICT_MESSAGE); };

const receiptArgs = z.object({ numero_pedido: orderNumber, parcela: z.number().int().positive(), valor: z.string().trim().min(1).nullish(), forma: z.enum(PAYMENT_NAMES), recebido_em: isoDate.nullish(), referencia: z.string().trim().min(1).max(100).nullish() }).strict();

export function receiptOperation(payments: SalesPaymentsService): WriteOperation<z.output<typeof receiptArgs>> {
  return {
    kind: 'WRITE', name: 'baixar_recebimento', allowed: rules.anyMember, versionScope: 'receivable', requiresVersion: true,
    versionKey: (args) => `${args.numero_pedido}:${args.parcela}`,
    description: 'Dá baixa (registra pagamento) numa parcela de um pedido confirmado. dados: {"numero_pedido": "12345", "parcela": 2, "valor": null para o saldo inteiro ou "1000.00", "forma": PIX|DINHEIRO|CARTAO_CREDITO|CARTAO_DEBITO|BOLETO|TRANSFERENCIA|OUTRO, "recebido_em": null para hoje ou "AAAA-MM-DD", "referencia": null}. Consulte o pedido com consultar_venda antes se tiver dúvida sobre a parcela.',
    schema: receiptArgs,
    summarize: (args) => `Baixa no pedido ${String(args.numero_pedido)}, parcela ${String(args.parcela)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido, { lock: true });
      const { part, receivable, movements, remaining } = await findInstallment(tx, ctx.companyId, sale, args.parcela, { lock: true });
      const version = installmentVersion(receivable, movements.length, sale.version);
      assertVersion(version, options.expectedVersion);
      if (remaining <= 0n) throw new BadRequestException(`A parcela ${args.parcela} do pedido ${sale.orderCode} já está quitada`);
      const value = args.valor ? toMoney(args.valor) : amount(remaining);
      const receivedOn = args.recebido_em ?? ctx.today;
      const method = PAYMENT_METHODS[args.forma];
      const input = receiptSchema.parse({ amount: value, paymentMethod: method, receivedOn, ...(args.referencia ? { reference: args.referencia } : {}) });
      await payments.receiptInTx(tx as SalesTx, ctx.companyId, sale.id, part.id, ctx.userId, options.idempotencyKey, input);
      return {
        entityId: receivable.id, label: `Baixa de ${money(value)} no pedido ${sale.orderCode}`, version, versionKey: `${sale.orderCode}:${args.parcela}`,
        summary: `Baixa no pedido ${sale.orderCode} (${sale.customerNameSnapshot}), parcela ${args.parcela}: ${money(value)} via ${paymentLabel(method)} em ${brDate(receivedOn)} — saldo da parcela ${money(amount(remaining))} → ${money(amount(remaining - cents(value)))}`,
      };
    },
  };
}

const reverseArgs = z.object({ numero_pedido: orderNumber, parcela: z.number().int().positive(), valor: z.string().nullish(), data: isoDate.nullish(), motivo: z.string().trim().min(3).max(100) }).strict();

export function reverseOperation(payments: SalesPaymentsService): WriteOperation<z.output<typeof reverseArgs>> {
  return {
    kind: 'WRITE', name: 'estornar_recebimento', allowed: rules.anyMember, versionScope: 'receivable', requiresVersion: true,
    versionKey: (args) => `${args.numero_pedido}:${args.parcela}`,
    description: 'Estorna um recebimento de uma parcela. dados: {"numero_pedido": "12345", "parcela": 1, "valor": null ou "2500.00", "data": null ou "AAAA-MM-DD" (para escolher qual recebimento, se houver mais de um), "motivo": texto curto obrigatório}.',
    schema: reverseArgs,
    summarize: (args) => `Estorno no pedido ${String(args.numero_pedido)}, parcela ${String(args.parcela)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido, { lock: true });
      const { receivable, movements } = await findInstallment(tx, ctx.companyId, sale, args.parcela, { lock: true });
      const version = installmentVersion(receivable, movements.length, sale.version);
      assertVersion(version, options.expectedVersion);
      const reversed = new Set(movements.filter((entry) => entry.reversesMovementId).map((entry) => entry.reversesMovementId));
      const value = args.valor ? toMoney(args.valor) : null;
      const candidates = movements.filter((entry) => entry.kind === 'RECEIPT' && !reversed.has(entry.id) && (!value || entry.amount === value) && (!args.data || entry.effectiveOn === args.data));
      if (!candidates.length) throw new BadRequestException(`Não há recebimento a estornar na parcela ${args.parcela} do pedido ${sale.orderCode}${value || args.data ? ' com esses dados' : ''}`);
      // Recebimentos equivalentes (mesmo valor e mesma data): estorna o mais recente.
      const equivalent = candidates.every((entry) => entry.amount === candidates[0].amount && entry.effectiveOn === candidates[0].effectiveOn);
      if (candidates.length > 1 && !equivalent) throw new BadRequestException(`Há ${candidates.length} recebimentos nessa parcela: ${candidates.map((entry) => `${money(entry.amount)} em ${brDate(entry.effectiveOn)}`).join('; ')}. Diga qual estornar (valor ou data).`);
      const target = candidates[candidates.length - 1];
      await payments.reverseInTx(tx as SalesTx, ctx.companyId, sale.id, target.id, ctx.userId, options.idempotencyKey, args.motivo);
      return {
        entityId: receivable.id, label: `Estorno de ${money(target.amount)} no pedido ${sale.orderCode}`, version, versionKey: `${sale.orderCode}:${args.parcela}`,
        summary: `Estorno no pedido ${sale.orderCode} (${sale.customerNameSnapshot}), parcela ${args.parcela}: ${money(target.amount)} recebido em ${brDate(target.effectiveOn)} — motivo: ${args.motivo}`,
      };
    },
  };
}

const cancelArgs = z.object({ numero_pedido: orderNumber, motivo: z.string().trim().min(3).max(500) }).strict();

export function cancelSaleOperation(salesService: SalesService): WriteOperation<z.output<typeof cancelArgs>> {
  return {
    kind: 'WRITE', name: 'cancelar_venda', allowed: rules.anyMember, versionScope: 'sale', requiresVersion: true,
    versionKey: (args) => args.numero_pedido,
    description: 'Cancela um pedido. dados: {"numero_pedido": "12345", "motivo": texto obrigatório}. Pedido com valor recebido precisa de estorno antes: proponha estornar_recebimento e cancelar_venda na mesma proposta, nessa ordem. Pedido com nota fiscal emitida não pode ser cancelado pelo Nero.',
    schema: cancelArgs,
    summarize: (args) => `Cancelar pedido ${String(args.numero_pedido)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido, { lock: true });
      const version = String(sale.version);
      assertVersion(version, options.expectedVersion);
      await salesService.cancelInTx(tx as SalesTx, ctx.companyId, sale.id, ctx.userId, sale.version, args.motivo);
      return {
        entityId: sale.id, label: `Pedido ${sale.orderCode} cancelado`, version, versionKey: sale.orderCode,
        summary: `Cancelar pedido ${sale.orderCode} (${sale.customerNameSnapshot}, ${money(sale.totalAmount)}) — motivo: ${args.motivo}`,
      };
    },
  };
}
