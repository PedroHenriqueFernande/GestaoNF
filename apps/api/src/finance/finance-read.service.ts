import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { companies, receivableMovements, sales } from '@gestaonf/database/schema';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { amount, cents } from '../sales/sales-money.js';
import type { FinanceFilters, FinanceListInput } from './finance.schemas.js';

type Row = Record<string, unknown>;
type Payment = {
  receivableId: string;
  installmentId: string;
  number: number;
  paycode: string;
  paymentMethod: string;
  originalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  dueOn: string | null;
  initialReceivedOn: string | null;
  settlement: 'PENDING' | 'PARTIAL' | 'PAID';
  isOverdue: boolean;
  matchesFilter: boolean;
};
type Group = {
  saleId: string;
  version: number;
  orderCode: string;
  workOrderNumber: string | null;
  customerId: string;
  customerName: string;
  soldOn: string;
  confirmedAt: string;
  totalAmount: string;
  paidAmount: string;
  remainingAmount: string;
  payments: Payment[];
};

const cursorSchema = z.strictObject({ at: z.iso.datetime({ offset: true }), id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) });

function asText(value: unknown): string { return String(value); }
function asNullableText(value: unknown): string | null { return value == null ? null : String(value); }
function asTimestamp(value: unknown): string { return value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString(); }

@Injectable()
export class FinanceReadService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async today(companyId: string): Promise<string> {
    const [company] = await this.database.db.select({ timezone: companies.timezone }).from(companies)
      .where(eq(companies.id, companyId)).limit(1);
    return new Intl.DateTimeFormat('sv-SE', { timeZone: company?.timezone ?? 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  }

  // One company and confirmed sales only. Movements remain the source of truth after receipts and reversals.
  private balances(companyId: string): SQL {
    return sql`WITH balances AS (
      SELECT r.id AS receivable_id, r.sale_id, p.id AS installment_id, p.number,
        p.paycode, p.payment_method, r.original_amount, r.due_on, p.initial_received_on,
        movement.paid_amount, r.original_amount - movement.paid_amount AS remaining_amount
      FROM receivables r
      JOIN sale_installments p ON p.company_id = r.company_id AND p.sale_id = r.sale_id AND p.id = r.sale_installment_id
      JOIN sales confirmed_sale ON confirmed_sale.company_id = r.company_id AND confirmed_sale.id = r.sale_id
        AND confirmed_sale.status = 'CONFIRMED'
      CROSS JOIN LATERAL (
        SELECT COALESCE(SUM(CASE WHEN m.kind = 'RECEIPT' THEN m.amount ELSE -m.amount END), 0)::numeric(15,2) AS paid_amount
        FROM receivable_movements m WHERE m.company_id = r.company_id AND m.receivable_id = r.id
      ) movement
      WHERE r.company_id = ${companyId}::uuid
    )`;
  }

  private conditions(input: FinanceFilters, today: string): SQL {
    const parts: SQL[] = [];
    if (input.customerId) parts.push(sql`s.customer_id = ${input.customerId}::uuid`);
    if (input.search) parts.push(sql`position(lower(${input.search}) in lower(s.customer_name_snapshot)) > 0`);
    if (input.orderCode) parts.push(sql`s.order_code = ${input.orderCode}`);
    if (input.paycode) parts.push(sql`b.paycode = ${input.paycode}`);
    if (input.workOrderNumber) parts.push(sql`position(lower(${input.workOrderNumber}) in lower(coalesce(s.work_order_number, ''))) > 0`);
    if (input.paymentMethod) parts.push(sql`b.payment_method = ${input.paymentMethod}`);
    if (input.settlement === 'PENDING') parts.push(sql`b.paid_amount = 0`);
    if (input.settlement === 'PARTIAL') parts.push(sql`b.paid_amount > 0 AND b.remaining_amount > 0`);
    if (input.settlement === 'PAID') parts.push(sql`b.remaining_amount = 0`);
    const overdue = sql`b.remaining_amount > 0 AND b.due_on IS NOT NULL AND b.due_on < ${today}::date`;
    if (input.overdue === 'ONLY') parts.push(overdue);
    if (input.overdue === 'EXCLUDE') parts.push(sql`NOT (${overdue})`);
    if (input.dateBasis === 'SALE') {
      if (input.dateFrom) parts.push(sql`s.sold_on >= ${input.dateFrom}::date`);
      if (input.dateTo) parts.push(sql`s.sold_on <= ${input.dateTo}::date`);
    } else if (input.dateBasis === 'DUE') {
      if (input.dateFrom) parts.push(sql`b.due_on >= ${input.dateFrom}::date`);
      if (input.dateTo) parts.push(sql`b.due_on <= ${input.dateTo}::date`);
      if (!input.dateFrom && !input.dateTo) parts.push(sql`b.due_on IS NOT NULL`);
    } else {
      parts.push(sql`EXISTS (
        SELECT 1 FROM receivable_movements receipt
        WHERE receipt.company_id = s.company_id AND receipt.receivable_id = b.receivable_id
          AND receipt.kind = 'RECEIPT'
          AND NOT EXISTS (SELECT 1 FROM receivable_movements reversal
            WHERE reversal.company_id = receipt.company_id AND reversal.receivable_id = receipt.receivable_id
              AND reversal.reverses_movement_id = receipt.id)
          ${input.dateFrom ? sql`AND receipt.effective_on >= ${input.dateFrom}::date` : sql``}
          ${input.dateTo ? sql`AND receipt.effective_on <= ${input.dateTo}::date` : sql``}
      )`);
    }
    return parts.length ? sql.join(parts.map((part) => sql`(${part})`), sql` AND `) : sql`TRUE`;
  }

  private hash(companyId: string, input: FinanceFilters): string {
    return createHash('sha256').update(JSON.stringify({ companyId, input })).digest('hex');
  }

  private decodeCursor(value: string, hash: string): { at: string; id: string } {
    try {
      const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
      if (parsed.hash !== hash) throw new Error('Filtros alterados');
      return parsed;
    } catch {
      throw new BadRequestException('Cursor inválido para estes filtros');
    }
  }

  private async paymentRows(
    companyId: string, saleIds: string[], today: string, filters?: FinanceFilters,
    executor: Pick<DatabaseService['db'], 'execute'> = this.database.db,
  ): Promise<Row[]> {
    if (!saleIds.length) return [];
    const where = filters ? this.conditions(filters, today) : sql`TRUE`;
    const ids = sql.join(saleIds.map((id) => sql`${id}::uuid`), sql`, `);
    const rows = await executor.execute(sql`${this.balances(companyId)}
      SELECT b.*, s.order_code, s.work_order_number, s.customer_id, s.version,
        s.customer_name_snapshot, s.sold_on, s.confirmed_at, s.total_amount,
        (${where}) AS matches_filter
      FROM balances b JOIN sales s ON s.company_id = ${companyId}::uuid AND s.id = b.sale_id
      WHERE b.sale_id IN (${ids})
      ORDER BY s.confirmed_at DESC, s.id DESC, b.number ASC`);
    return rows as unknown as Row[];
  }

  private group(rows: Row[], today: string): Group[] {
    const groups = new Map<string, Group>();
    for (const row of rows) {
      const saleId = asText(row.sale_id);
      let group = groups.get(saleId);
      if (!group) {
        group = {
          saleId, version: Number(row.version), orderCode: asText(row.order_code), workOrderNumber: asNullableText(row.work_order_number),
          customerId: asText(row.customer_id), customerName: asText(row.customer_name_snapshot),
          soldOn: asText(row.sold_on), confirmedAt: asTimestamp(row.confirmed_at), totalAmount: asText(row.total_amount),
          paidAmount: '0.00', remainingAmount: '0.00', payments: [],
        };
        groups.set(saleId, group);
      }
      const paid = cents(asText(row.paid_amount));
      const remaining = cents(asText(row.remaining_amount));
      const dueOn = asNullableText(row.due_on);
      group.payments.push({
        receivableId: asText(row.receivable_id), installmentId: asText(row.installment_id), number: Number(row.number),
        paycode: asText(row.paycode), paymentMethod: asText(row.payment_method), originalAmount: asText(row.original_amount),
        paidAmount: amount(paid), remainingAmount: amount(remaining), dueOn,
        initialReceivedOn: asNullableText(row.initial_received_on),
        settlement: remaining === 0n ? 'PAID' : paid > 0n ? 'PARTIAL' : 'PENDING',
        isOverdue: remaining > 0n && dueOn !== null && dueOn < today,
        matchesFilter: Boolean(row.matches_filter),
      });
    }
    for (const group of groups.values()) {
      group.paidAmount = amount(group.payments.reduce((sum, payment) => sum + cents(payment.paidAmount), 0n));
      group.remainingAmount = amount(group.payments.reduce((sum, payment) => sum + cents(payment.remainingAmount), 0n));
    }
    return [...groups.values()];
  }

  async list(companyId: string, input: FinanceListInput) {
    const { cursor, limit, ...filters } = input;
    const today = await this.today(companyId);
    const where = this.conditions(filters, today);
    const hash = this.hash(companyId, filters);
    const position = cursor ? this.decodeCursor(cursor, hash) : null;
    const after = position ? sql`AND (s.confirmed_at, s.id) < (${position.at}::timestamptz, ${position.id}::uuid)` : sql``;
    return this.database.db.transaction(async (tx) => {
      const page = await tx.execute(sql`${this.balances(companyId)}
      SELECT s.id, to_char(s.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM sales s
      WHERE s.company_id = ${companyId}::uuid AND s.status = 'CONFIRMED' ${after}
        AND EXISTS (SELECT 1 FROM balances b WHERE b.sale_id = s.id AND ${where})
      ORDER BY s.confirmed_at DESC, s.id DESC
      LIMIT ${limit + 1}`) as unknown as Row[];
      const hasMore = page.length > limit;
      const selected = page.slice(0, limit);
      const rows = await this.paymentRows(companyId, selected.map((row) => asText(row.id)), today, filters, tx);
      const last = selected.at(-1);
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({
        at: asText(last.cursor_at), id: asText(last.id), hash,
      })).toString('base64url') : null;
      return { items: this.group(rows, today), nextCursor, limit };
    }, { isolationLevel: 'repeatable read' });
  }

  async summary(companyId: string, input: FinanceFilters) {
    const today = await this.today(companyId);
    const where = this.conditions(input, today);
    const [row] = await this.database.db.execute(sql`${this.balances(companyId)}
      SELECT count(*)::integer AS payment_count, count(DISTINCT b.sale_id)::integer AS sale_count,
        COALESCE(sum(b.original_amount), 0)::numeric(15,2) AS original_amount,
        COALESCE(sum(b.paid_amount), 0)::numeric(15,2) AS paid_amount,
        COALESCE(sum(b.remaining_amount), 0)::numeric(15,2) AS remaining_amount,
        COALESCE(sum(b.remaining_amount) FILTER (WHERE b.remaining_amount > 0 AND b.due_on < ${today}::date), 0)::numeric(15,2) AS overdue_amount
      FROM balances b JOIN sales s ON s.company_id = ${companyId}::uuid AND s.id = b.sale_id
      WHERE ${where}`) as unknown as Row[];
    return {
      paymentCount: Number(row.payment_count), saleCount: Number(row.sale_count),
      originalAmount: asText(row.original_amount), paidAmount: asText(row.paid_amount),
      remainingAmount: asText(row.remaining_amount), overdueAmount: asText(row.overdue_amount),
    };
  }

  async detail(companyId: string, saleId: string) {
    const [sale] = await this.database.db.select({ id: sales.id }).from(sales)
      .where(and(eq(sales.companyId, companyId), eq(sales.id, saleId), eq(sales.status, 'CONFIRMED'))).limit(1);
    if (!sale) throw new NotFoundException('Venda confirmada não encontrada no Financeiro');
    const today = await this.today(companyId);
    const [group] = this.group(await this.paymentRows(companyId, [saleId], today), today);
    if (!group) throw new NotFoundException('Recebimentos não encontrados');
    const movements = await this.database.db.select({
      id: receivableMovements.id, receivableId: receivableMovements.receivableId, kind: receivableMovements.kind,
      amount: receivableMovements.amount, effectiveOn: receivableMovements.effectiveOn,
      paymentMethod: receivableMovements.paymentMethod, reference: receivableMovements.reference,
      reversesMovementId: receivableMovements.reversesMovementId, recordedAt: receivableMovements.recordedAt,
    }).from(receivableMovements).where(and(
      eq(receivableMovements.companyId, companyId),
      inArray(receivableMovements.receivableId, group.payments.map((payment) => payment.receivableId)),
    )).orderBy(receivableMovements.recordedAt, receivableMovements.id);
    return { ...group, payments: group.payments.map((payment) => ({
      ...payment, movements: movements.filter((movement) => movement.receivableId === payment.receivableId),
    })) };
  }
}
