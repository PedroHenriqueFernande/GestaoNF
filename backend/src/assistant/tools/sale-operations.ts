// backend/src/assistant/tools/sale-operations.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { amount, cents, itemAmounts } from '../../sales/sales-money.js';
import type { CreateSaleInput } from '../../sales/sales.schemas.js';
import type { SalesService, SalesTx } from '../../sales/sales.service.js';
import { rules } from '../nero-policy.js';
import { brDate, isoDate, money, PAYMENT_METHODS, PAYMENT_NAMES, paymentLabel, toMoney, toQuantity } from './sale-support.js';
import type { WriteOperation } from './types.js';

const text = (max: number) => z.string().trim().min(1).max(max).nullish();
const argsSchema = z.object({
  cliente_id: z.uuid(),
  data: isoDate,
  itens: z.array(z.object({ servico_id: z.uuid(), quantidade: z.string().nullish(), valor_unitario: z.string(), desconto: z.string().nullish(), descricao: text(2000) }).strict()).min(1).max(20),
  parcelas: z.array(z.object({ forma: z.enum(PAYMENT_NAMES), valor: z.string(), vencimento: isoDate.nullish(), recebida_em: isoDate.nullish() }).strict()).min(1).max(12),
  os: text(40), observacoes: text(2000),
}).strict();
type Args = z.output<typeof argsSchema>;

function toDomain(args: Args): CreateSaleInput {
  const items = args.itens.map((item) => ({
    serviceId: item.servico_id, quantity: toQuantity(item.quantidade), unitPrice: toMoney(item.valor_unitario, 'valor unitário'),
    discountAmount: item.desconto ? toMoney(item.desconto, 'desconto') : '0.00', ...(item.descricao ? { description: item.descricao } : {}),
  }));
  const installments = args.parcelas.map((part, index) => {
    if (!!part.vencimento === !!part.recebida_em) throw new BadRequestException(`Na parcela ${index + 1}, informe o vencimento ou a data em que já foi recebida (só um dos dois)`);
    const base = { paymentMethod: PAYMENT_METHODS[part.forma], amount: toMoney(part.valor, `valor da parcela ${index + 1}`) };
    return part.recebida_em ? { ...base, receivedOn: part.recebida_em } : { ...base, dueOn: part.vencimento! };
  });
  const total = items.reduce((sum, item) => sum + cents(itemAmounts(item.quantity, item.unitPrice, item.discountAmount).totalAmount), 0n);
  const parts = installments.reduce((sum, part) => sum + cents(part.amount), 0n);
  if (total !== parts) {
    const difference = parts < total ? `faltam ${money(amount(total - parts))}` : `sobram ${money(amount(parts - total))}`;
    throw new BadRequestException(`As parcelas somam ${money(amount(parts))}, mas o total da venda é ${money(amount(total))} (${difference}). Ajuste as parcelas.`);
  }
  return { customerId: args.cliente_id, soldOn: args.data, items, installments, ...(args.os ? { workOrderNumber: args.os } : {}), ...(args.observacoes ? { notes: args.observacoes } : {}) };
}

/** Nomes curtos nas parcelas, para o resumo caber em 1024 caracteres mesmo com 12 parcelas. */
const installmentLabel = (method: string) => method === 'CREDIT_CARD' ? 'crédito' : method === 'DEBIT_CARD' ? 'débito' : paymentLabel(method);
const shorten = (value: string, max: number) => value.length > max ? `${value.slice(0, max - 1)}…` : value;
/** "1.0000" → "1"; "1.5000" → "1,5". */
const quantityText = (value: string) => Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 4 });

export function createSaleOperation(salesService: SalesService): WriteOperation<Args> {
  return {
    kind: 'WRITE', name: 'criar_venda', allowed: rules.anyMember,
    description: 'Lança uma venda já confirmada. dados: {"cliente_id": id de buscar_clientes ou {"$ref": n}, "data": "AAAA-MM-DD" (data da venda), "itens": [{"servico_id": id de buscar_servicos ou {"$ref": n}, "quantidade": "1", "valor_unitario": "5000.00", "desconto": null, "descricao": null}], "parcelas": [{"forma": PIX|DINHEIRO|CARTAO_CREDITO|CARTAO_DEBITO|BOLETO|TRANSFERENCIA|OUTRO, "valor": "2500.00", "recebida_em": "AAAA-MM-DD" se já foi pago, ou "vencimento": "AAAA-MM-DD" se vai vencer}], "os": null, "observacoes": null}. As parcelas devem somar o total.',
    schema: argsSchema,
    summarize: (args) => `Nova venda com ${Array.isArray(args.itens) ? args.itens.length : 0} item(ns) e ${Array.isArray(args.parcelas) ? args.parcelas.length : 0} parcela(s)`,
    async execute(tx, ctx, args, options) {
      const { sale, items, installments } = await salesService.createConfirmedInTx(tx as SalesTx, ctx.companyId, ctx.userId, options.idempotencyKey, toDomain(args));
      const itemText = items.map((item, index) => `${item.serviceNameSnapshot} ${quantityText(item.quantity)} × ${money(item.unitPrice)}${item.discountAmount !== '0.00' ? ` (desconto ${money(item.discountAmount)})` : ''}${args.itens[index]?.descricao ? ` — ${shorten(args.itens[index].descricao!, 80)}` : ''}`).join('; ');
      const partsText = installments.map((part) => `${part.number}) ${installmentLabel(part.paymentMethod)} ${money(part.amount)} ${part.initialReceivedOn ? `recebida em ${brDate(part.initialReceivedOn)}` : `vence em ${brDate(part.dueOn!)}`}`).join('; ');
      return {
        entityId: sale.id, label: `Venda ${sale.orderCode} — ${sale.customerNameSnapshot} — ${money(sale.totalAmount)}`,
        summary: `Venda para ${sale.customerNameSnapshot} em ${brDate(sale.soldOn!)}: ${itemText} · Total ${money(sale.totalAmount)} · Parcelas: ${partsText}${sale.workOrderNumber ? ` · OS ${sale.workOrderNumber}` : ''}${sale.notes ? ` · Obs.: ${shorten(sale.notes, 100)}` : ''}`,
      };
    },
  };
}
