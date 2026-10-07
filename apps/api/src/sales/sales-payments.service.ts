import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, receivableMovements, receivables, saleInstallments, sales } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { cents } from './sales-money.js';
import type { ReceiptInput } from './sales.schemas.js';
import { SalesService } from './sales.service.js';

@Injectable()
export class SalesPaymentsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SalesService) private readonly salesService: SalesService,
  ) {}

  async receipt(companyId: string, saleId: string, installmentId: string, userId: string, key: string, input: ReceiptInput) {
    const matchExisting = async () => {
      const [existing] = await this.database.db.select().from(receivableMovements)
        .where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.idempotencyKey, key))).limit(1);
      if (!existing) return null;
      const [target] = await this.database.db.select().from(receivables)
        .where(and(eq(receivables.companyId, companyId), eq(receivables.id, existing.receivableId))).limit(1);
      if (existing.kind !== 'RECEIPT' || target?.saleId !== saleId || target.saleInstallmentId !== installmentId ||
        existing.amount !== input.amount || existing.paymentMethod !== input.paymentMethod ||
        existing.effectiveOn !== input.receivedOn || (existing.reference ?? null) !== (input.reference ?? null)) {
        throw new ConflictException('Chave de recebimento já usada com dados diferentes');
      }
      return this.salesService.get(companyId, saleId);
    };
    const previous = await matchExisting();
    if (previous) return previous;
    try {
      await this.database.db.transaction(async (tx) => {
        const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, saleId))).for('update').limit(1);
        if (!sale) throw new NotFoundException('Pedido não encontrado');
        if (sale.status !== 'CONFIRMED') throw new ConflictException('Somente pedidos confirmados aceitam recebimentos');
        const [part] = await tx.select({ id: saleInstallments.id }).from(saleInstallments)
          .where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, saleId), eq(saleInstallments.id, installmentId))).limit(1);
        if (!part) throw new NotFoundException('Parcela não encontrada');
        const [receivable] = await tx.select().from(receivables)
          .where(and(eq(receivables.companyId, companyId), eq(receivables.saleId, saleId), eq(receivables.saleInstallmentId, installmentId))).for('update').limit(1);
        if (!receivable) throw new NotFoundException('Conta a receber não encontrada');
        const movements = await tx.select().from(receivableMovements)
          .where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.receivableId, receivable.id)));
        const paid = movements.reduce((sum, entry) => sum + (entry.kind === 'RECEIPT' ? cents(entry.amount) : -cents(entry.amount)), 0n);
        if (cents(input.amount) > cents(receivable.originalAmount) - paid) throw new BadRequestException('Valor maior que o saldo pendente');
        await tx.insert(receivableMovements).values({ companyId, receivableId: receivable.id, kind: 'RECEIPT',
          amount: input.amount, paymentMethod: input.paymentMethod, effectiveOn: input.receivedOn,
          reference: input.reference ?? null, idempotencyKey: key, createdByUserId: userId });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await matchExisting();
        if (existing) return existing;
      }
      throw error;
    }
    return this.salesService.get(companyId, saleId);
  }

  async reverse(companyId: string, saleId: string, movementId: string, userId: string, key: string, reason: string) {
    const matchExisting = async () => {
      const [existing] = await this.database.db.select().from(receivableMovements)
        .where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.idempotencyKey, key))).limit(1);
      if (!existing) return null;
      const [target] = await this.database.db.select().from(receivables)
        .where(and(eq(receivables.companyId, companyId), eq(receivables.id, existing.receivableId))).limit(1);
      if (existing.kind !== 'REVERSAL' || existing.reversesMovementId !== movementId || target?.saleId !== saleId || existing.reference !== reason) {
        throw new ConflictException('Chave de estorno já usada com dados diferentes');
      }
      return this.salesService.get(companyId, saleId);
    };
    const previous = await matchExisting();
    if (previous) return previous;
    try {
      await this.database.db.transaction(async (tx) => {
        const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, saleId))).for('update').limit(1);
        if (!sale) throw new NotFoundException('Pedido não encontrado');
        if (sale.status !== 'CONFIRMED') throw new ConflictException('Pedido não aceita estorno');
        const [original] = await tx.select().from(receivableMovements)
          .where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.id, movementId))).limit(1);
        if (!original || original.kind !== 'RECEIPT') throw new NotFoundException('Recebimento não encontrado');
        const [receivable] = await tx.select().from(receivables)
          .where(and(eq(receivables.companyId, companyId), eq(receivables.id, original.receivableId), eq(receivables.saleId, saleId))).for('update').limit(1);
        if (!receivable) throw new NotFoundException('Recebimento não encontrado neste pedido');
        const [alreadyReversed] = await tx.select({ id: receivableMovements.id }).from(receivableMovements)
          .where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.reversesMovementId, movementId))).limit(1);
        if (alreadyReversed) throw new ConflictException('Recebimento já estornado');
        const [company] = await tx.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId)).limit(1);
        const today = new Intl.DateTimeFormat('sv-SE', { timeZone: company?.timezone ?? 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        await tx.insert(receivableMovements).values({ companyId, receivableId: receivable.id, kind: 'REVERSAL', amount: original.amount,
          effectiveOn: today, paymentMethod: null, reference: reason, reversesMovementId: movementId, idempotencyKey: key, createdByUserId: userId });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await matchExisting();
        if (existing) return existing;
        throw new ConflictException('Recebimento já estornado');
      }
      throw error;
    }
    return this.salesService.get(companyId, saleId);
  }
}
