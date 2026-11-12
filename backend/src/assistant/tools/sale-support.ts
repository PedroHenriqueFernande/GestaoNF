// backend/src/assistant/tools/sale-support.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { receivableMovements, receivables, saleInstallments, sales } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cents } from '../../sales/sales-money.js';
import type { DbExecutor } from '../db-types.js';
import { brDate, money } from '../nero-format.js';

/** Formas de pagamento em português (modelo) → domínio. */
export const PAYMENT_METHODS = { PIX: 'PIX', DINHEIRO: 'CASH', CARTAO_CREDITO: 'CREDIT_CARD', CARTAO_DEBITO: 'DEBIT_CARD', BOLETO: 'BOLETO', TRANSFERENCIA: 'TRANSFER', OUTRO: 'OTHER' } as const;
export const PAYMENT_NAMES = Object.keys(PAYMENT_METHODS) as [keyof typeof PAYMENT_METHODS, ...(keyof typeof PAYMENT_METHODS)[]];
const PAYMENT_LABELS: Record<string, string> = { PIX: 'Pix', CASH: 'dinheiro', CREDIT_CARD: 'cartão de crédito', DEBIT_CARD: 'cartão de débito', BOLETO: 'boleto', TRANSFER: 'transferência', OTHER: 'outra forma' };
export const paymentLabel = (method: string) => PAYMENT_LABELS[method] ?? method;

/**
 * Só formatos sem ambiguidade: "5.000" (milhar), "1.234.567,89", "5000,5" (vírgula decimal), "5000.00" e "5000.5" (formato do sistema).
 * "R$ " no início é aceito. Qualquer outro formato ("5,000", "0,500", "1.5000", "5.000.00") é recusado.
 */
export function toMoney(value: string, field = 'valor') {
  const text = value.trim().replace(/^R\$\s*/i, '');
  let normalized: string | null = null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(text)) normalized = text.replace(/\./g, '').replace(',', '.');
  else if (/^\d+,\d{1,2}$/.test(text)) normalized = text.replace(',', '.');
  else if (/^\d+(\.\d{1,2})?$/.test(text)) normalized = text;
  if (!normalized || normalized.split('.')[0].length > 13) throw new BadRequestException(`O ${field} "${value}" é ambíguo ou inválido; envie no formato 5000.00`);
  const [integer, fraction = ''] = normalized.split('.');
  return `${BigInt(integer)}.${fraction.padEnd(2, '0')}`;
}

/** "1" → "1.0000"; ponto ou vírgula como decimal (nunca os dois), até 4 casas. */
export function toQuantity(value: string | null | undefined) {
  const raw = (value ?? '1').trim();
  if (raw.includes('.') && raw.includes(',')) throw new BadRequestException(`A quantidade "${value}" não é válida`);
  const text = raw.replace(',', '.');
  if (!/^\d{1,11}(?:\.\d{1,4})?$/.test(text) || Number(text) <= 0) throw new BadRequestException(`A quantidade "${value}" não é válida`);
  const [integer, fraction = ''] = text.split('.');
  return `${BigInt(integer)}.${fraction.padEnd(4, '0')}`;
}

export const isoDate = z.iso.date('use AAAA-MM-DD');
export const orderNumber = z.string().transform((value, ctx) => {
  const match = value.trim().match(/^(?:pedido\s*)?#?\s*(\d{5})$/i);
  if (!match) { ctx.addIssue({ code: 'custom', message: 'número do pedido deve ter 5 dígitos' }); return z.NEVER; }
  return match[1];
});

/** Pedido da empresa pelo número, lido na transação do lote. `lock` trava a linha (FOR UPDATE), como o domínio faz primeiro. */
export async function findSale(tx: DbExecutor, companyId: string, number: string, options: { lock?: boolean } = {}) {
  const query = tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.orderCode, number))).limit(1);
  const [sale] = await (options.lock ? query.for('update') : query);
  if (!sale) throw new NotFoundException(`Pedido ${number} não encontrado`);
  return sale;
}

/** Parcela N do pedido, com o recebível, os movimentos e o saldo (em centavos). `lock` trava o recebível; chame depois de `findSale` com lock (pedido, depois recebível). */
export async function findInstallment(tx: DbExecutor, companyId: string, sale: typeof sales.$inferSelect, number: number, options: { lock?: boolean } = {}) {
  const [part] = await tx.select().from(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, sale.id), eq(saleInstallments.number, number))).limit(1);
  if (!part) throw new NotFoundException(`O pedido ${sale.orderCode} não tem a parcela ${number}`);
  const receivableQuery = tx.select().from(receivables).where(and(eq(receivables.companyId, companyId), eq(receivables.saleInstallmentId, part.id))).limit(1);
  const [receivable] = await (options.lock ? receivableQuery.for('update') : receivableQuery);
  if (!receivable) throw new BadRequestException(`O pedido ${sale.orderCode} ainda não está confirmado`);
  const movements = await tx.select().from(receivableMovements).where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.receivableId, receivable.id))).orderBy(receivableMovements.recordedAt, receivableMovements.id);
  const paid = movements.reduce((sum, entry) => sum + (entry.kind === 'RECEIPT' ? cents(entry.amount) : -cents(entry.amount)), 0n);
  return { part, receivable, movements, remaining: cents(receivable.originalAmount) - paid };
}

export { brDate, money };
