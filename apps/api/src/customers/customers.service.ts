import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { customers } from '@gestaonf/database/schema';
import { and, count, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { isUniqueViolation } from '../common/validate.js';
import { createCustomerSchema, listCustomersSchema, updateCustomerSchema } from './customers.schemas.js';
import { validateCustomerTaxId } from './tax-id.js';

type CreateCustomer = z.output<typeof createCustomerSchema>;
type UpdateCustomer = z.output<typeof updateCustomerSchema>;
type ListCustomers = z.output<typeof listCustomersSchema>;

@Injectable()
export class CustomersService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async create(companyId: string, userId: string, input: CreateCustomer) {
    try {
      return await this.createInTx(this.database.db, companyId, userId, input);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('CPF/CNPJ já cadastrado nesta empresa');
      throw error;
    }
  }

  async createInTx(db: DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0], companyId: string, userId: string, input: CreateCustomer) {
    validateCustomerTaxId(input.kind, input.taxId, input.tradeName);
    this.validateFiscalData(input);
    const [customer] = await db.insert(customers).values({ ...input, companyId, createdByUserId: userId }).returning();
    return customer;
  }

  async list(companyId: string, input: ListCustomers) {
    const conditions: SQL[] = [eq(customers.companyId, companyId)];
    if (input.status !== 'ALL') conditions.push(eq(customers.status, input.status));
    if (input.search) {
      const escapeLike = (value: string) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;
      const namePattern = escapeLike(input.search);
      const documentPattern = escapeLike(input.search.toUpperCase().replace(/[.\-/\s]/g, ''));
      const phoneDigits = input.search.replace(/\D/g, '');
      conditions.push(or(
        ilike(customers.name, namePattern),
        ilike(customers.tradeName, namePattern),
        ilike(customers.taxId, documentPattern),
        ...(phoneDigits ? [ilike(customers.phone, escapeLike(phoneDigits))] : []),
      )!);
    }
    const filter = and(...conditions);
    const [items, [total]] = await Promise.all([
      this.database.db.select().from(customers).where(filter).orderBy(customers.name, customers.id).limit(input.limit).offset(input.offset),
      this.database.db.select({ count: count() }).from(customers).where(filter),
    ]);
    return { items, total: total.count, limit: input.limit, offset: input.offset };
  }

  async get(companyId: string, id: string) {
    const [customer] = await this.database.db.select().from(customers).where(and(eq(customers.companyId, companyId), eq(customers.id, id))).limit(1);
    if (!customer) throw new NotFoundException('Cliente não encontrado');
    return customer;
  }

  async update(companyId: string, id: string, input: UpdateCustomer) {
    try {
      return await this.database.db.transaction(async (tx) => {
        const [existing] = await tx.select().from(customers).where(and(eq(customers.companyId, companyId), eq(customers.id, id))).for('update');
        if (!existing) throw new NotFoundException('Cliente não encontrado');
        const merged = { ...existing, ...input };
        if (merged.kind !== 'PF' && merged.kind !== 'PJ') throw new BadRequestException('Tipo inválido');
        validateCustomerTaxId(merged.kind, merged.taxId, merged.tradeName);
        this.validateFiscalData(merged);
        const [customer] = await tx.update(customers).set({ ...input, updatedAt: new Date() })
          .where(and(eq(customers.companyId, companyId), eq(customers.id, id))).returning();
        return customer;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('CPF/CNPJ já cadastrado nesta empresa');
      throw error;
    }
  }

  private validateFiscalData(input: { kind: string; caepfCode?: string | null; foreignTaxId?: string | null; noForeignTaxIdReason?: string | null }) {
    if (input.caepfCode && input.kind !== 'PF') throw new BadRequestException('O registro de atividade da pessoa física só pode ser informado para cliente pessoa física.');
    if (input.foreignTaxId && input.noForeignTaxIdReason) throw new BadRequestException('Informe o documento fiscal estrangeiro ou o motivo da ausência, nunca os dois ao mesmo tempo.');
  }

  async remove(companyId: string, id: string) {
    const [customer] = await this.database.db.update(customers).set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(and(eq(customers.companyId, companyId), eq(customers.id, id))).returning({ id: customers.id });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }
}
