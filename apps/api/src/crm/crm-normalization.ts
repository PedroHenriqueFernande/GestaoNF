import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { isValidCpf, isValidCnpj } from '../customers/tax-id.js';
import type { DatabaseService } from '../database/database.module.js';

export type CrmTx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
export type CrmDb = CrmTx | DatabaseService['db'];
export function phoneKey(phone: string | null | undefined) {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // A local number without DDD/country, extensions or letters is ambiguous.
  if (/[a-z]/i.test(phone)) return null;
  if (phone.trim().startsWith('+') && /^[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^55\d{10,11}$/.test(digits)) return digits;
  if (/^[1-9]\d{9,10}$/.test(digits)) return `55${digits}`;
  return null;
}
export function validateDocument(value: { taxId?: string | null; taxIdKind?: string | null }) {
  if (!value.taxId && !value.taxIdKind) return;
  if (!value.taxId || !value.taxIdKind || !(value.taxIdKind === 'PF' ? isValidCpf(value.taxId) : isValidCnpj(value.taxId))) {
    throw new BadRequestException('Informe CPF/CNPJ válido e seu tipo');
  }
}
export function escapeLike(value: string) { return `%${value.replace(/[\\%_]/g, '\\$&')}%`; }
function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
export function commandHash(value: unknown) { return createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'undefined').digest('hex'); }
export async function lockKeys(tx: CrmTx, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}
export function expectVersion(actual: number, expected: number) {
  if (actual !== expected) throw new ConflictException('Registro alterado. Atualize os dados antes de salvar.');
}
export function changedFields(before: Record<string, unknown>, patch: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined && commandHash(before[key]) !== commandHash(value)).map(([key, value]) => [key, { before: before[key] ?? null, after: value }]));
}
export const terminal = (status: string) => ['WON', 'LOST', 'DISQUALIFIED'].includes(status);

