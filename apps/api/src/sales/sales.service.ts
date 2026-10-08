import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { companies, companyUsers, customers, receivableMovements, receivables, saleInstallments, saleItems, saleReferenceHistory, sales, saleStatusHistory, services } from '@gestaonf/database/schema';
import { and, count, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { amount, cents, itemAmounts } from './sales-money.js';
import { orderCode, paycodes } from './sales-codes.js';
import type { ConfirmSaleInput, CreateSaleInput, ListSalesInput, UpdateConfirmedSaleInput, UpdateSaleInput } from './sales.schemas.js';

function constraintName(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  if ('constraint_name' in error && typeof error.constraint_name === 'string') return error.constraint_name;
  if ('constraint' in error && typeof error.constraint === 'string') return error.constraint;
  return 'cause' in error ? constraintName(error.cause) : null;
}

@Injectable()
export class SalesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private async prepare(companyId: string, input: CreateSaleInput | UpdateConfirmedSaleInput, existing?: { customerId: string; serviceIds: Set<string>; itemSnapshots?: Map<string, typeof saleItems.$inferSelect> }) {
    const [customer] = await this.database.db.select().from(customers)
      .where(and(eq(customers.companyId, companyId), eq(customers.id, input.customerId))).limit(1);
    if (!customer || (customer.status !== 'ACTIVE' && customer.id !== existing?.customerId)) throw new BadRequestException('Selecione um cliente ativo desta empresa');
    const itemRows = [];
    for (const [index, item] of input.items.entries()) {
      const [service] = await this.database.db.select().from(services)
        .where(and(eq(services.companyId, companyId), eq(services.id, item.serviceId))).limit(1);
      if (!service || (service.status !== 'ACTIVE' && !existing?.serviceIds.has(service.id))) throw new BadRequestException('Selecione apenas serviços ativos desta empresa');
      const calculated = itemAmounts(item.quantity, item.unitPrice, item.discountAmount);
      const original = 'id' in item && typeof item.id === 'string' ? existing?.itemSnapshots?.get(item.id) : undefined;
      if (original && original.serviceId !== item.serviceId) throw new BadRequestException('Serviço original do item não corresponde ao cadastro');
      itemRows.push({
        companyId, serviceId: service.id, position: index + 1,
        serviceNameSnapshot: original?.serviceNameSnapshot ?? service.name,
        descriptionSnapshot: item.description === undefined ? original?.descriptionSnapshot ?? service.description : item.description,
        unitLabelSnapshot: original?.unitLabelSnapshot ?? service.unitLabel,
        nationalTaxCodeSnapshot: original ? original.nationalTaxCodeSnapshot : service.nationalTaxCode,
        nbsCodeSnapshot: original ? original.nbsCodeSnapshot : service.nbsCode,
        quantity: item.quantity, unitPrice: item.unitPrice, grossAmount: calculated.grossAmount,
        discountAmount: item.discountAmount, totalAmount: calculated.totalAmount,
        performedOn: item.performedOn === undefined ? original?.performedOn ?? null : item.performedOn,
      });
    }
    const subtotal = itemRows.reduce((sum, row) => sum + cents(row.grossAmount), 0n);
    const discount = itemRows.reduce((sum, row) => sum + cents(row.discountAmount), 0n);
    return {
      customer,
      itemRows,
      totals: { subtotalAmount: amount(subtotal), discountAmount: amount(discount), totalAmount: amount(subtotal - discount) },
      installmentRows: input.installments.map((part, index) => ({
        companyId, number: index + 1, paymentMethod: part.paymentMethod, amount: part.amount,
        dueOn: 'dueOn' in part ? part.dueOn : null,
        initialReceivedOn: 'receivedOn' in part ? part.receivedOn : null,
      })),
    };
  }

  async create(companyId: string, userId: string, key: string, input: CreateSaleInput) {
    const hash = createHash('sha256').update(JSON.stringify({ userId, input })).digest('hex');
    const previous = await this.database.db.select({ id: sales.id, requestHash: sales.requestHash }).from(sales)
      .where(and(eq(sales.companyId, companyId), eq(sales.idempotencyKey, key))).limit(1);
    if (previous[0]) {
      if (previous[0].requestHash !== hash) throw new ConflictException('Chave de criação já usada com dados diferentes');
      return this.get(companyId, previous[0].id);
    }
    const prepared = await this.prepare(companyId, input);
    for (let attempt = 0; attempt < 128; attempt++) {
      try {
        const id = await this.database.db.transaction(async (tx) => {
          const [sale] = await tx.insert(sales).values({
            companyId, orderCode: orderCode(), customerId: prepared.customer.id,
            customerKindSnapshot: prepared.customer.kind, customerNameSnapshot: prepared.customer.name,
            customerTaxIdSnapshot: prepared.customer.taxId, workOrderNumber: input.workOrderNumber ?? null,
            soldOn: input.soldOn ?? null, notes: input.notes ?? null, ...prepared.totals,
            createdByUserId: userId, idempotencyKey: key, requestHash: hash,
          }).returning({ id: sales.id });
          if (prepared.itemRows.length) await tx.insert(saleItems).values(prepared.itemRows.map((row) => ({ ...row, saleId: sale.id })));
          if (prepared.installmentRows.length) await tx.insert(saleInstallments).values(prepared.installmentRows.map((row) => ({ ...row, saleId: sale.id })));
          await tx.insert(saleStatusHistory).values({ companyId, saleId: sale.id, fromStatus: null, toStatus: 'DRAFT', actorUserId: userId });
          if (input.workOrderNumber) await tx.insert(saleReferenceHistory).values({ companyId, saleId: sale.id, oldWorkOrderNumber: null, newWorkOrderNumber: input.workOrderNumber, actorUserId: userId });
          return sale.id;
        });
        return this.get(companyId, id);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        const [existing] = await this.database.db.select({ id: sales.id, requestHash: sales.requestHash }).from(sales)
          .where(and(eq(sales.companyId, companyId), eq(sales.idempotencyKey, key))).limit(1);
        if (existing) {
          if (existing.requestHash !== hash) throw new ConflictException('Chave de criação já usada com dados diferentes');
          return this.get(companyId, existing.id);
        }
        if (constraintName(error) !== 'sales_company_order_code_uq') throw new ConflictException('Conflito ao registrar pedido');
      }
    }
    throw new ConflictException('Não foi possível reservar um código de pedido; tente novamente');
  }

  async list(companyId: string, input: ListSalesInput) {
    const conditions: SQL[] = [eq(sales.companyId, companyId)];
    if (input.status !== 'ALL') conditions.push(eq(sales.status, input.status));
    if (input.customerId) conditions.push(eq(sales.customerId, input.customerId));
    if (input.from) conditions.push(gte(sales.soldOn, input.from));
    if (input.to) conditions.push(lte(sales.soldOn, input.to));
    if (input.search) {
      const escaped = input.search.replace(/[\\%_]/g, '\\$&');
      conditions.push(or(eq(sales.orderCode, input.search), ilike(sales.workOrderNumber, `%${escaped}%`), ilike(sales.customerNameSnapshot, `%${escaped}%`))!);
    }
    const where = and(...conditions);
    const [items, [total]] = await Promise.all([
      this.database.db.select().from(sales).where(where).orderBy(desc(sales.createdAt), desc(sales.id)).limit(input.limit).offset(input.offset),
      this.database.db.select({ count: count() }).from(sales).where(where),
    ]);
    return { items: items.map(({ idempotencyKey: _key, requestHash: _hash, ...sale }) => sale), total: total.count, limit: input.limit, offset: input.offset };
  }

  async get(companyId: string, id: string) {
    const [sale] = await this.database.db.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).limit(1);
    if (!sale) throw new NotFoundException('Pedido não encontrado');
    const [items, installments, openReceivables, [company]] = await Promise.all([
      this.database.db.select().from(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, id))).orderBy(saleItems.position),
      this.database.db.select().from(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, id))).orderBy(saleInstallments.number),
      this.database.db.select().from(receivables).where(and(eq(receivables.companyId, companyId), eq(receivables.saleId, id))),
      this.database.db.select({ timezone: companies.timezone }).from(companies).where(eq(companies.id, companyId)).limit(1),
    ]);
    const movements = openReceivables.length ? await this.database.db.select().from(receivableMovements)
      .where(and(eq(receivableMovements.companyId, companyId), inArray(receivableMovements.receivableId, openReceivables.map((entry) => entry.id))))
      .orderBy(receivableMovements.recordedAt) : [];
    const today = new Intl.DateTimeFormat('sv-SE', { timeZone: company?.timezone ?? 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    const { idempotencyKey: _key, requestHash: _hash, ...publicSale } = sale;
    return {
      ...publicSale, items,
      installments: installments.map((part) => {
        const receivable = openReceivables.find((entry) => entry.saleInstallmentId === part.id);
        const partMovements = receivable ? movements.filter((entry) => entry.receivableId === receivable.id) : [];
        const paid = partMovements.reduce((sum, entry) => sum + (entry.kind === 'RECEIPT' ? cents(entry.amount) : -cents(entry.amount)), 0n);
        const remaining = cents(part.amount) - paid;
        return {
          ...part, receivableId: receivable?.id ?? null, paidAmount: amount(paid), remainingAmount: amount(remaining),
          paymentStatus: !receivable ? 'DRAFT' : remaining === 0n ? 'PAID' : paid > 0n ? 'PARTIALLY_PAID' : part.dueOn && part.dueOn < today ? 'OVERDUE' : 'PENDING',
          movements: partMovements,
        };
      }),
    };
  }

  async update(companyId: string, id: string, userId: string, input: UpdateSaleInput) {
    const prepared = await this.prepare(companyId, input);
    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).for('update').limit(1);
      if (!sale) throw new NotFoundException('Pedido não encontrado');
      if (sale.status !== 'DRAFT' || sale.version !== input.expectedVersion) throw new ConflictException('Rascunho alterado ou já confirmado');
      await tx.delete(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, id)));
      await tx.delete(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, id)));
      if (prepared.itemRows.length) await tx.insert(saleItems).values(prepared.itemRows.map((row) => ({ ...row, saleId: id })));
      if (prepared.installmentRows.length) await tx.insert(saleInstallments).values(prepared.installmentRows.map((row) => ({ ...row, saleId: id })));
      await tx.update(sales).set({
        customerId: prepared.customer.id, customerKindSnapshot: prepared.customer.kind, customerNameSnapshot: prepared.customer.name,
        customerTaxIdSnapshot: prepared.customer.taxId, workOrderNumber: input.workOrderNumber ?? null,
        soldOn: input.soldOn ?? null, notes: input.notes ?? null, ...prepared.totals, version: sale.version + 1, updatedAt: new Date(),
      }).where(and(eq(sales.companyId, companyId), eq(sales.id, id)));
      if (sale.workOrderNumber !== (input.workOrderNumber ?? null)) await tx.insert(saleReferenceHistory).values({
        companyId, saleId: id, oldWorkOrderNumber: sale.workOrderNumber, newWorkOrderNumber: input.workOrderNumber ?? null, actorUserId: userId,
      });
    });
    return this.get(companyId, id);
  }

  async updateConfirmed(companyId: string, id: string, userId: string, input: UpdateConfirmedSaleInput) {
    const current = await this.get(companyId, id);
    if (current.status !== 'CONFIRMED') throw new ConflictException('Somente vendas confirmadas podem ser editadas aqui');
    const itemIds = input.items.flatMap((item) => item.id ? [item.id] : []);
    if (new Set(itemIds).size !== itemIds.length || itemIds.some((itemId) => !current.items.some((item) => item.id === itemId))) {
      throw new BadRequestException('Item original inválido nesta venda');
    }
    const prepared = await this.prepare(companyId, input, {
      customerId: current.customerId,
      serviceIds: new Set(current.items.map((item) => item.serviceId)),
      itemSnapshots: new Map(current.items.map((item) => [item.id, item])),
    });
    if (cents(prepared.totals.totalAmount) <= 0n ||
      prepared.installmentRows.reduce((sum, part) => sum + cents(part.amount), 0n) !== cents(prepared.totals.totalAmount)) {
      throw new BadRequestException('A soma dos recebimentos deve corresponder ao total da venda');
    }
    const ids = input.installments.flatMap((part) => part.id ? [part.id] : []);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Recebimento duplicado na edição');

    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).for('update').limit(1);
      if (!sale) throw new NotFoundException('Pedido não encontrado');
      if (sale.status !== 'CONFIRMED' || sale.version !== input.expectedVersion) throw new ConflictException('Esta venda foi alterada. Reabra o pedido antes de salvar.');
      const existing = await tx.select().from(saleInstallments)
        .where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, id))).orderBy(saleInstallments.number);
      if (ids.some((partId) => !existing.some((part) => part.id === partId))) throw new BadRequestException('Recebimento não pertence a esta venda');
      const open = await tx.select().from(receivables)
        .where(and(eq(receivables.companyId, companyId), eq(receivables.saleId, id))).for('update');
      if (open.length !== existing.length) throw new ConflictException('Os recebimentos desta venda estão inconsistentes');
      const movements = open.length ? await tx.select().from(receivableMovements)
        .where(and(eq(receivableMovements.companyId, companyId), inArray(receivableMovements.receivableId, open.map((row) => row.id)))) : [];
      const historyByPart = new Map(existing.map((part) => {
        const receivable = open.find((row) => row.saleInstallmentId === part.id);
        const history = movements.filter((movement) => movement.receivableId === receivable?.id);
        const paid = history.reduce((sum, movement) => sum + (movement.kind === 'RECEIPT' ? cents(movement.amount) : -cents(movement.amount)), 0n);
        return [part.id, { receivable, history, paid }] as const;
      }));

      for (const part of existing) {
        const next = input.installments.find((entry) => entry.id === part.id);
        const state = historyByPart.get(part.id)!;
        if (!next) {
          if (state.history.length) throw new ConflictException(`O pagamento ${part.paycode} tem histórico de baixas e não pode ser removido`);
          await tx.delete(receivables).where(eq(receivables.id, state.receivable!.id));
          await tx.delete(saleInstallments).where(eq(saleInstallments.id, part.id));
          continue;
        }
        if (cents(next.amount) < state.paid) throw new ConflictException(`O pagamento ${part.paycode} não pode ficar abaixo do valor já baixado`);
        const receivedOn = 'receivedOn' in next ? next.receivedOn ?? null : null;
        if (state.history.length && (part.initialReceivedOn !== receivedOn ||
          (part.initialReceivedOn && (next.amount !== part.amount || next.paymentMethod !== part.paymentMethod)))) {
          throw new ConflictException(`O pagamento ${part.paycode} já tem baixas; data, forma e valor do recebimento inicial devem ser preservados`);
        }
        await tx.update(saleInstallments).set({ number: part.number + 1000 }).where(eq(saleInstallments.id, part.id));
      }

      const reservedCodes = new Set(existing.map((part) => part.paycode).filter((code): code is string => !!code));
      for (const [index, part] of input.installments.entries()) {
        const dueOn = 'dueOn' in part ? part.dueOn ?? null : null;
        const initialReceivedOn = 'receivedOn' in part ? part.receivedOn ?? null : null;
        if (part.id) {
          const old = existing.find((entry) => entry.id === part.id)!;
          const state = historyByPart.get(old.id)!;
          await tx.update(saleInstallments).set({
            number: index + 1, paymentMethod: part.paymentMethod, amount: part.amount, dueOn, initialReceivedOn, updatedAt: new Date(),
          }).where(eq(saleInstallments.id, old.id));
          await tx.update(receivables).set({ originalAmount: part.amount, dueOn, updatedAt: new Date() })
            .where(eq(receivables.id, state.receivable!.id));
          if (initialReceivedOn && !state.history.length) {
            await tx.insert(receivableMovements).values({ companyId, receivableId: state.receivable!.id, kind: 'RECEIPT',
              amount: part.amount, paymentMethod: part.paymentMethod, effectiveOn: initialReceivedOn, createdByUserId: userId });
          }
        } else {
          let code = paycodes(1)[0];
          while (reservedCodes.has(code)) code = paycodes(1)[0];
          reservedCodes.add(code);
          const [inserted] = await tx.insert(saleInstallments).values({ companyId, saleId: id, number: index + 1,
            paycode: code, paymentMethod: part.paymentMethod, amount: part.amount, dueOn, initialReceivedOn })
            .returning({ id: saleInstallments.id });
          const [receivable] = await tx.insert(receivables).values({ companyId, saleId: id, saleInstallmentId: inserted.id,
            originalAmount: part.amount, dueOn }).returning({ id: receivables.id });
          if (initialReceivedOn) await tx.insert(receivableMovements).values({ companyId, receivableId: receivable.id,
            kind: 'RECEIPT', amount: part.amount, paymentMethod: part.paymentMethod,
            effectiveOn: initialReceivedOn, createdByUserId: userId });
        }
      }

      await tx.delete(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, id)));
      await tx.insert(saleItems).values(prepared.itemRows.map((row) => ({ ...row, saleId: id })));
      await tx.update(sales).set({
        customerId: prepared.customer.id, customerKindSnapshot: prepared.customer.kind,
        customerNameSnapshot: prepared.customer.name, customerTaxIdSnapshot: prepared.customer.taxId,
        workOrderNumber: input.workOrderNumber ?? null, soldOn: input.soldOn,
        notes: input.notes ?? null, ...prepared.totals, version: sale.version + 1, updatedAt: new Date(),
      }).where(eq(sales.id, id));
      if (sale.workOrderNumber !== (input.workOrderNumber ?? null)) await tx.insert(saleReferenceHistory).values({
        companyId, saleId: id, oldWorkOrderNumber: sale.workOrderNumber,
        newWorkOrderNumber: input.workOrderNumber ?? null, actorUserId: userId,
      });
    });
    return this.get(companyId, id);
  }

  async confirm(companyId: string, id: string, userId: string, input: ConfirmSaleInput) {
    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).for('update').limit(1);
      if (!sale) throw new NotFoundException('Pedido não encontrado');
      if (sale.status !== 'DRAFT' || sale.version !== input.expectedVersion) throw new ConflictException('Pedido já confirmado ou versão desatualizada');
      const [membership] = await tx.select({ id: companyUsers.userId }).from(companyUsers).innerJoin(companies, eq(companies.id, companyUsers.companyId))
        .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'))).limit(1);
      if (!membership) throw new ForbiddenException('Sem acesso à empresa');
      const [customer] = await tx.select().from(customers).where(and(eq(customers.companyId, companyId), eq(customers.id, sale.customerId))).limit(1);
      if (!customer || customer.status !== 'ACTIVE') throw new BadRequestException('Cliente inativo ou indisponível');
      const items = await tx.select().from(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, id)));
      const installments = await tx.select().from(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, id))).orderBy(saleInstallments.number);
      if (!sale.soldOn || !items.length || !installments.length || cents(sale.totalAmount) <= 0n) throw new BadRequestException('Informe data, serviços e parcelas para confirmar');
      for (const item of items) {
        const [catalog] = await tx.select({ status: services.status }).from(services).where(and(eq(services.companyId, companyId), eq(services.id, item.serviceId))).limit(1);
        if (catalog?.status !== 'ACTIVE') throw new BadRequestException('Há serviço inativo neste pedido');
        const calculated = itemAmounts(item.quantity, item.unitPrice, item.discountAmount);
        if (item.grossAmount !== calculated.grossAmount || item.totalAmount !== calculated.totalAmount) throw new BadRequestException('Valor de item inconsistente');
      }
      const subtotal = items.reduce((sum, item) => sum + cents(item.grossAmount), 0n);
      const discount = items.reduce((sum, item) => sum + cents(item.discountAmount), 0n);
      const installmentTotal = installments.reduce((sum, part) => sum + cents(part.amount), 0n);
      if (amount(subtotal) !== sale.subtotalAmount || amount(discount) !== sale.discountAmount || amount(subtotal - discount) !== sale.totalAmount || installmentTotal !== cents(sale.totalAmount)) throw new BadRequestException('A soma dos itens e parcelas deve corresponder ao total do pedido');
      const received = new Set<string>();
      for (const receipt of input.initialReceipts) {
        const part = installments.find((entry) => entry.id === receipt.installmentId);
        if (!part || received.has(part.id) || receipt.amount !== part.amount || !part.initialReceivedOn || receipt.receivedOn !== part.initialReceivedOn) throw new BadRequestException('Recebimento inicial inválido para uma das parcelas');
        received.add(part.id);
      }
      if (installments.some((part) => part.initialReceivedOn && !received.has(part.id))) throw new BadRequestException('Informe o recebimento de cada parcela já recebida');
      const codes = paycodes(installments.length);
      for (const [index, part] of installments.entries()) {
        await tx.update(saleInstallments).set({ paycode: codes[index], updatedAt: new Date() }).where(eq(saleInstallments.id, part.id));
        const [receivable] = await tx.insert(receivables).values({ companyId, saleId: id, saleInstallmentId: part.id, originalAmount: part.amount, dueOn: part.dueOn }).returning({ id: receivables.id });
        const initial = input.initialReceipts.find((entry) => entry.installmentId === part.id);
        if (initial) await tx.insert(receivableMovements).values({ companyId, receivableId: receivable.id, kind: 'RECEIPT', amount: initial.amount, paymentMethod: initial.paymentMethod, effectiveOn: initial.receivedOn, createdByUserId: userId });
      }
      await tx.update(sales).set({ status: 'CONFIRMED', customerKindSnapshot: customer.kind, customerNameSnapshot: customer.name,
        customerTaxIdSnapshot: customer.taxId, confirmedAt: new Date(), version: sale.version + 1, updatedAt: new Date(),
      }).where(and(eq(sales.companyId, companyId), eq(sales.id, id)));
      await tx.insert(saleStatusHistory).values({ companyId, saleId: id, fromStatus: 'DRAFT', toStatus: 'CONFIRMED', actorUserId: userId });
    });
    return this.get(companyId, id);
  }

  async updateWorkOrder(companyId: string, id: string, userId: string, expectedVersion: number, workOrderNumber: string | null) {
    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).for('update').limit(1);
      if (!sale) throw new NotFoundException('Pedido não encontrado');
      if (sale.status === 'CANCELED' || sale.version !== expectedVersion) throw new ConflictException('Pedido não pode ser alterado nesta versão');
      if (sale.workOrderNumber === workOrderNumber) return;
      await tx.update(sales).set({ workOrderNumber, version: sale.version + 1, updatedAt: new Date() }).where(eq(sales.id, id));
      await tx.insert(saleReferenceHistory).values({ companyId, saleId: id, oldWorkOrderNumber: sale.workOrderNumber, newWorkOrderNumber: workOrderNumber, actorUserId: userId });
    });
    return this.get(companyId, id);
  }

  async cancel(companyId: string, id: string, userId: string, expectedVersion: number, reason: string) {
    await this.database.db.transaction(async (tx) => {
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, id))).for('update').limit(1);
      if (!sale) throw new NotFoundException('Pedido não encontrado');
      if (sale.status === 'CANCELED' || sale.version !== expectedVersion) throw new ConflictException('Pedido não pode ser cancelado nesta versão');
      const entries = await tx.select({ id: receivables.id }).from(receivables).where(and(eq(receivables.companyId, companyId), eq(receivables.saleId, id)));
      if (entries.length) {
        const movements = await tx.select().from(receivableMovements).where(and(eq(receivableMovements.companyId, companyId), inArray(receivableMovements.receivableId, entries.map((entry) => entry.id))));
        const paid = movements.reduce((sum, entry) => sum + (entry.kind === 'RECEIPT' ? cents(entry.amount) : -cents(entry.amount)), 0n);
        if (paid > 0n) throw new ConflictException('Existem valores recebidos; regularize o financeiro antes de cancelar');
      }
      await tx.update(sales).set({ status: 'CANCELED', canceledAt: new Date(), version: sale.version + 1, updatedAt: new Date() }).where(eq(sales.id, id));
      await tx.insert(saleStatusHistory).values({ companyId, saleId: id, fromStatus: sale.status, toStatus: 'CANCELED', reason, actorUserId: userId });
    });
    return this.get(companyId, id);
  }

  async history(companyId: string, id: string) {
    await this.get(companyId, id);
    const [statuses, references] = await Promise.all([
      this.database.db.select().from(saleStatusHistory).where(and(eq(saleStatusHistory.companyId, companyId), eq(saleStatusHistory.saleId, id))).orderBy(saleStatusHistory.occurredAt),
      this.database.db.select().from(saleReferenceHistory).where(and(eq(saleReferenceHistory.companyId, companyId), eq(saleReferenceHistory.saleId, id))).orderBy(saleReferenceHistory.occurredAt),
    ]);
    return { statuses, references };
  }
}
