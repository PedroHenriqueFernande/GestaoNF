import { requirePermission, type Actor } from '../permissions/actor.js';
import { cents, quantityUnits } from './sales-money.js';

export type PricedItem = Readonly<{ serviceId: string; quantity: string; unitPrice: string; discountAmount: string; discountKind?: 'AMOUNT' | 'PERCENT' }>;
type PriceKey = 'sales.change_price' | 'proposals.change_price';

/** Desconto maior que o da referência (D6): sempre pelo valor do termo; por unidade quando é em dinheiro (venda, ou proposta em R$). Percentual já é por unidade. */
export function exceedsDiscount(item: PricedItem, reference: PricedItem) {
  const discount = cents(item.discountAmount), referenceDiscount = cents(reference.discountAmount);
  if (discount > referenceDiscount) return true;
  return item.discountKind !== 'PERCENT' && discount * quantityUnits(reference.quantity) > referenceDiscount * quantityUnits(item.quantity);
}

/**
 * Regra única de preço e desconto (D6), na venda e na proposta.
 * Referência: o item original, ou o preço atual do catálogo com desconto zero.
 * Serviço sem preço no catálogo e sem item original tem preço livre.
 */
export function requireItemPrice(actor: Actor, item: PricedItem, original: PricedItem | undefined, catalogPrice: string | null, entry: string, key: PriceKey = 'sales.change_price') {
  if (!original && catalogPrice === null) return;
  const reference = original ?? { ...item, unitPrice: catalogPrice!, discountAmount: '0.00' };
  if (cents(item.unitPrice) !== cents(reference.unitPrice) || exceedsDiscount(item, reference)) requirePermission(actor, key, entry);
}

/** Sem id de item: consome o gravado do mesmo serviço, preço e tipo de desconto que cobre o novo; entre vários, o de menor desconto. */
export function takeKeptItem(pool: PricedItem[], item: PricedItem): PricedItem | undefined {
  let chosen = -1;
  for (const [index, kept] of pool.entries()) {
    if (kept.serviceId !== item.serviceId || kept.discountKind !== item.discountKind || cents(kept.unitPrice) !== cents(item.unitPrice) || exceedsDiscount(item, kept)) continue;
    if (chosen < 0 || exceedsDiscount(pool[chosen], kept)) chosen = index;
  }
  return chosen < 0 ? undefined : pool.splice(chosen, 1)[0];
}
