import { BadRequestException } from '@nestjs/common';

export function cents(value: string): bigint {
  const [whole, fractional] = value.split('.');
  if (!whole || !fractional || fractional.length !== 2) throw new BadRequestException('Valor monetário inválido');
  return BigInt(whole) * 100n + BigInt(fractional);
}

export function amount(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

export function itemAmounts(quantity: string, unitPrice: string, discountAmount: string) {
  const quantityScaled = BigInt(quantity.replace('.', ''));
  const gross = (quantityScaled * cents(unitPrice) + 5000n) / 10000n;
  const discount = cents(discountAmount);
  if (discount > gross) throw new BadRequestException('Desconto maior que o valor do item');
  return { grossAmount: amount(gross), totalAmount: amount(gross - discount) };
}
