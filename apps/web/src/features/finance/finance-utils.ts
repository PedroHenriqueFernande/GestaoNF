import type { PaymentMethod } from '../../api/client';

const currencyFormatter = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function currency(value: string): string { return currencyFormatter.format(Number(value)); }

export function shortDate(value: string | null): string {
  if (!value) return 'Sem data';
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function today(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export const methodOptions: { value: PaymentMethod; label: string }[] = [
  { value: 'PIX', label: 'PIX' }, { value: 'CASH', label: 'Dinheiro' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' }, { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'BOLETO', label: 'Boleto' }, { value: 'TRANSFER', label: 'Transferência' },
  { value: 'OTHER', label: 'Outra forma' },
];

export function methodName(value: PaymentMethod): string {
  return methodOptions.find((item) => item.value === value)?.label ?? value;
}

export function normalizeMoney(value: string): string | null {
  const clean = value.trim().replace(/\s/g, '');
  const normalized = clean.includes(',')
    ? clean.replace(/\./g, '').replace(',', '.')
    : /^\d{1,3}(?:\.\d{3})+$/.test(clean) ? clean.replace(/\./g, '') : clean;
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  return `${BigInt(whole).toString()}.${fraction.padEnd(2, '0')}`;
}

export function moneyCents(value: string): bigint {
  const [whole, fraction] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction);
}
