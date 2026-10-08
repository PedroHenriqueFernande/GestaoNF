import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { receivables, saleInstallments, sales } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { FinanceReadService } from './finance-read.service.js';
import type { FinanceDateUpdateInput } from './finance.schemas.js';

@Injectable()
export class FinanceDatesService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(FinanceReadService) private readonly finance: FinanceReadService,
  ) {}

  async update(companyId: string, saleId: string, installmentId: string, input: FinanceDateUpdateInput) {
    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select({ status: sales.status, version: sales.version, soldOn: sales.soldOn })
        .from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, saleId))).for('update').limit(1);
      if (!sale || sale.status !== 'CONFIRMED') throw new NotFoundException('Venda confirmada não encontrada no Financeiro');
      if (sale.version !== input.expectedVersion) throw new ConflictException('Pedido alterado. Atualize os dados antes de salvar as datas.');

      const [installment] = await tx.select({ dueOn: saleInstallments.dueOn, initialReceivedOn: saleInstallments.initialReceivedOn })
        .from(saleInstallments).where(and(
          eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, saleId), eq(saleInstallments.id, installmentId),
        )).for('update').limit(1);
      const [receivable] = await tx.select({ id: receivables.id })
        .from(receivables).where(and(
          eq(receivables.companyId, companyId), eq(receivables.saleId, saleId), eq(receivables.saleInstallmentId, installmentId),
        )).for('update').limit(1);
      if (!installment || !receivable) throw new NotFoundException('Recebimento não encontrado neste pedido');
      if (installment.initialReceivedOn && input.dueOn !== null) {
        throw new BadRequestException('Recebimento já recebido na venda não possui vencimento');
      }
      if (!installment.initialReceivedOn && input.dueOn === null) {
        throw new BadRequestException('Informe o vencimento deste recebimento');
      }
      if (sale.soldOn === input.soldOn && installment.dueOn === input.dueOn) return;

      const updatedAt = new Date();
      await tx.update(sales).set({ soldOn: input.soldOn, version: sale.version + 1, updatedAt })
        .where(and(eq(sales.companyId, companyId), eq(sales.id, saleId)));
      if (installment.dueOn !== input.dueOn) {
        await tx.update(saleInstallments).set({ dueOn: input.dueOn, updatedAt })
          .where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, saleId), eq(saleInstallments.id, installmentId)));
        await tx.update(receivables).set({ dueOn: input.dueOn, updatedAt })
          .where(and(eq(receivables.companyId, companyId), eq(receivables.id, receivable.id)));
      }
    });
    return this.finance.detail(companyId, saleId);
  }
}
