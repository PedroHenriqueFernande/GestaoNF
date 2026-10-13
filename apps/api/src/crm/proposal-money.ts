import { UnprocessableEntityException } from '@nestjs/common';
import { amount, cents, itemAmounts } from '../sales/sales-money.js';
import type { ProposalItemInput } from './proposal.schemas.js';

export function proposalAmounts(item: ProposalItemInput) {
  const gross = itemAmounts(item.quantity, item.unitPrice, '0.00').grossAmount;
  const discount = item.discountType === 'PERCENT' ? amount((cents(gross) * cents(item.discountInput) + 5000n) / 10000n) : item.discountInput;
  if (cents(discount) > cents(gross)) throw new UnprocessableEntityException({ code: 'PROPOSAL_DISCOUNT_INVALID', message: 'Desconto maior que o valor do item' });
  const totals = itemAmounts(item.quantity, item.unitPrice, discount);
  if (cents(totals.grossAmount) >= 10n ** 15n) throw new UnprocessableEntityException({ code: 'PROPOSAL_AMOUNT_OVERFLOW', message: 'Valor excede o limite do sistema' });
  return { ...totals, discountAmount: discount };
}
export function proposalTotals(items: { grossAmount: string; discountAmount: string }[]) {
  const gross = items.reduce((v, i) => v + cents(i.grossAmount), 0n), discount = items.reduce((v, i) => v + cents(i.discountAmount), 0n);
  if (gross >= 10n ** 15n) throw new UnprocessableEntityException({ code: 'PROPOSAL_AMOUNT_OVERFLOW', message: 'Total excede o limite do sistema' });
  return { subtotalAmount: amount(gross), discountAmount: amount(discount), totalAmount: amount(gross - discount) };
}
export const proposalCode = (n: number) => `P-${String(n).padStart(6, '0')}`;
export function proposalToday(timezone: string, now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function effectiveProposalStatus(p: { status: string; validUntil: string | null }, timezone: string, now = new Date()) {
  return p.status === 'SENT' && p.validUntil && p.validUntil < proposalToday(timezone, now) ? 'EXPIRED' : p.status;
}
