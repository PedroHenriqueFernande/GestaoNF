const QUANTITY = /^(\d{1,11})(?:[.,](\d{1,4}))?$/;

/** Quantidade com até 4 casas, em décimos de milésimo (inteiro exato), ou null se inválida. */
const quantityUnits = (value: string): bigint | null => {
  const match = QUANTITY.exec(value.trim());
  return match ? BigInt(match[1] + (match[2] ?? '').padEnd(4, '0')) : null;
};

/**
 * Maior desconto em R$ (centavos) que o servidor aceita ao mudar a quantidade sem a chave de preço
 * (`exceedsDiscount`, backend/src/sales/sale-price-policy.ts): nunca passa do desconto de referência,
 * no total nem por unidade. A divisão inteira arredonda para baixo, como a comparação do servidor exige.
 * Devolve null se alguma quantidade for inválida ou a de referência for zero.
 */
export function followedDiscountCents(referenceCents: number, referenceQuantity: string, quantity: string): number | null {
  const units = quantityUnits(quantity), referenceUnits = quantityUnits(referenceQuantity);
  if (units === null || referenceUnits === null || units === 0n || referenceUnits === 0n) return null;
  const reference = BigInt(referenceCents);
  const scaled = reference * units / referenceUnits;
  return Number(scaled < reference ? scaled : reference);
}
