import { randomInt } from 'node:crypto';

export function orderCode(): string { return randomInt(100_000).toString().padStart(5, '0'); }
export function installmentCodes(count: number): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomInt(10_000).toString().padStart(4, '0'));
  return [...codes];
}
