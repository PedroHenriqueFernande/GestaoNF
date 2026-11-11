// backend/src/assistant/actions/error-translator.ts
import { HttpException } from '@nestjs/common';
import { ZodError } from 'zod';

export type FailureKind = 'VALIDATION' | 'CONFLICT' | 'FORBIDDEN' | 'UNEXPECTED';
export type FailureCause = {
  kind: FailureKind;
  operationIndex: number | null;
  operation: string | null;
  message: string;
  fields: { path: string; message: string }[];
};

const PG_MESSAGES: Record<string, string> = {
  '22001': 'Um dos textos é maior que o permitido',
  '22021': 'Há um caractere que o sistema não aceita',
  '22P02': 'Um dos valores está em formato inválido',
  '23505': 'Já existe um cadastro com esses dados',
  '23514': 'Um dos valores não atende às regras do cadastro',
  '23502': 'Falta um dado obrigatório',
};

function pgCode(error: unknown): { code: string; column?: string } | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^2[23]/.test(code) ? { code, column: (error as { column_name?: string }).column_name } : null;
}

/** O Drizzle encapsula o erro do Postgres em DrizzleQueryError: o código fica em error.cause. */
function pgError(error: unknown): { code: string; column?: string } | null {
  if (!error || typeof error !== 'object') return null;
  return pgCode(error) ?? pgCode((error as { cause?: unknown }).cause);
}

export function translateError(error: unknown, operationIndex: number | null, operation: string | null): FailureCause {
  const base = { operationIndex, operation };
  if (error instanceof ZodError) {
    return { ...base, kind: 'VALIDATION', message: 'Alguns dados estão inválidos ou faltando', fields: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) };
  }
  if (error instanceof HttpException) {
    const status = error.getStatus();
    const response = error.getResponse();
    const raw = typeof response === 'string' ? response : (response as { message?: unknown }).message;
    const message = Array.isArray(raw) ? raw.join('; ') : String(raw ?? error.message);
    const kind: FailureKind = status === 409 ? 'CONFLICT' : status === 403 ? 'FORBIDDEN' : status >= 500 || status === 429 ? 'UNEXPECTED' : 'VALIDATION';
    return { ...base, kind, message, fields: [] };
  }
  const pg = pgError(error);
  if (pg) return { ...base, kind: 'VALIDATION', message: PG_MESSAGES[pg.code] ?? 'Um dos dados não foi aceito pelo sistema', fields: pg.column ? [{ path: pg.column, message: pg.code }] : [] };
  return { ...base, kind: 'UNEXPECTED', message: 'Falha inesperada ao gravar', fields: [] };
}

/** Texto curto da causa, para histórico e mensagens de reserva. */
export function describeCause(cause: FailureCause) {
  const fields = cause.fields.length ? ` (${cause.fields.map((field) => `${field.path}: ${field.message}`).join('; ')})` : '';
  const where = cause.operationIndex !== null ? `Operação ${cause.operationIndex + 1}: ` : '';
  return `${where}${cause.message}${fields}`;
}
