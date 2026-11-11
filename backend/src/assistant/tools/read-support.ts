// backend/src/assistant/tools/read-support.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const PERIOD_VALUES = ['HOJE', 'ULTIMOS_7_DIAS', 'ESTE_MES', 'MES_PASSADO', 'ESTE_ANO', 'PERSONALIZADO', 'SEM_PERIODO'] as const;
export type PeriodArgs = { periodo: typeof PERIOD_VALUES[number]; inicio: string | null; fim: string | null };

/** Propriedades de período para os JSON Schemas strict das ferramentas. */
export const periodProperties = {
  periodo: { type: 'string', enum: [...PERIOD_VALUES], description: 'Use PERSONALIZADO com inicio e fim; SEM_PERIODO só quando o usuário não limitar datas e a consulta permitir.' },
  inicio: { type: ['string', 'null'], description: 'Data inicial AAAA-MM-DD (só em PERSONALIZADO).' },
  fim: { type: ['string', 'null'], description: 'Data final AAAA-MM-DD (só em PERSONALIZADO; período de até 366 dias contando início e fim).' },
} as const;

const CUSTOM_MESSAGE = 'Informe data inicial e final no formato AAAA-MM-DD, com no máximo 366 dias contando início e fim';
const iso = (date: Date) => date.toISOString().slice(0, 10);

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function resolvePeriod(args: PeriodArgs, today: string, options: { allowNone?: boolean } = {}): { from: string; to: string } | null {
  const [year, month, day] = today.split('-').map(Number);
  switch (args.periodo) {
    case 'HOJE': return { from: today, to: today };
    case 'ULTIMOS_7_DIAS': return { from: iso(new Date(Date.UTC(year, month - 1, day - 6))), to: today };
    case 'ESTE_MES': return { from: iso(new Date(Date.UTC(year, month - 1, 1))), to: iso(new Date(Date.UTC(year, month, 0))) };
    case 'MES_PASSADO': return { from: iso(new Date(Date.UTC(year, month - 2, 1))), to: iso(new Date(Date.UTC(year, month - 1, 0))) };
    case 'ESTE_ANO': return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'SEM_PERIODO':
      if (options.allowNone) return null;
      throw new BadRequestException('Esta consulta precisa de um período');
    case 'PERSONALIZADO': {
      if (!validDate(args.inicio) || !validDate(args.fim)) throw new BadRequestException(CUSTOM_MESSAGE);
      const span = (Date.parse(args.fim) - Date.parse(args.inicio)) / 86_400_000;
      if (span < 0 || span >= 366) throw new BadRequestException(CUSTOM_MESSAGE);
      return { from: args.inicio, to: args.fim };
    }
    default: throw new BadRequestException('Período inválido');
  }
}

/** Valida os argumentos vindos do modelo; o strict da OpenAI garante tipos, não regras. */
export function parseToolArgs<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException(`Argumentos inválidos: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'argumentos'} ${issue.message}`).join('; ')}`);
  return result.data;
}

export const truncate = (value: string, max = 200) => (value.length > max ? `${value.slice(0, max)}…` : value);

const INTERNAL_KEYS = new Set(['companyId', 'idempotencyKey', 'requestHash', 'version', 'createdByUserId', 'updatedAt', 'createdAt']);

function clean(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncate(value);
  if (Array.isArray(value)) return depth > 3 ? `[${value.length} itens]` : value.slice(0, 10).map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => !key.startsWith('_') && !INTERNAL_KEYS.has(key) && item !== null && item !== undefined)
      .map(([key, item]) => [key, clean(item, depth + 1)]));
  }
  return value;
}

/** No máximo `limit` itens, sem campos internos e com textos truncados. */
export function compactList(rows: unknown[], limit = 10) {
  return { items: rows.slice(0, limit).map((row) => clean(row) as Record<string, unknown>), omitted: Math.max(0, rows.length - limit) };
}

export const compact = (value: unknown) => clean(value);

/** Busca opcional: texto vazio ou só com espaços vira null. */
export const optionalSearch = (max: number) => z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().trim().min(1).max(max).nullable(),
);

/** Aceita "12345", "#12345" e "pedido 12345" (qualquer caixa) e devolve os 5 dígitos; senão null. */
export function orderCodeFrom(value: string): string | null {
  return /^(?:pedido\s*)?#?\s*(\d{5})$/i.exec(value.trim())?.[1] ?? null;
}

const LABELS: Record<string, string> = {
  CONFIRMED: 'confirmada', DRAFT: 'rascunho', CANCELED: 'cancelada', ACTIVE: 'ativo', INACTIVE: 'inativo',
  PF: 'pessoa física', PJ: 'pessoa jurídica',
  PIX: 'Pix', CASH: 'dinheiro', CREDIT_CARD: 'cartão de crédito', DEBIT_CARD: 'cartão de débito', BOLETO: 'boleto', TRANSFER: 'transferência', OTHER: 'outra forma',
  PENDING: 'pendente', PARTIAL: 'parcial', PARTIALLY_PAID: 'parcialmente paga', PAID: 'paga', OVERDUE: 'vencida',
  SCHEDULED: 'agendada', COMPLETED: 'realizada', NO_SHOW: 'não compareceu', IN_PERSON: 'presencial', ONLINE: 'online',
  RECEIPT: 'recebimento', REVERSAL: 'estorno',
  NEW: 'novo', CONTACTING: 'em contato', QUALIFIED: 'qualificado', DISQUALIFIED: 'desqualificado', LOST: 'perdido', WON: 'ganho',
  MANUAL: 'manual', FORM: 'formulário', META_ADS: 'Meta Ads', GOOGLE_ADS: 'Google Ads', IMPORT: 'importação', NERO: 'Nero', API: 'integração',
};

/** Traduz valores internos (status, forma de pagamento, situação) para português; o que não é conhecido passa igual. */
export const label = <T>(value: T): T | string => (typeof value === 'string' ? (LABELS[value] ?? value) : value);
