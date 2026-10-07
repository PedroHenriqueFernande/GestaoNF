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
    validateCustomerTaxId(input.kind, input.taxId, input.tradeName);
    try {
      const [customer] = await this.database.db.insert(customers).values({ ...input, companyId, createdByUserId: userId }).returning();
      return customer;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('CPF/CNPJ já cadastrado nesta empresa');
      throw error;
    }
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
    const existing = await this.get(companyId, id);
    const kind = input.kind ?? existing.kind;
    if (kind !== 'PF' && kind !== 'PJ') throw new BadRequestException('Tipo inválido');
    validateCustomerTaxId(kind, input.taxId === undefined ? existing.taxId : input.taxId, input.tradeName === undefined ? existing.tradeName : input.tradeName);
    try {
      const [customer] = await this.database.db.update(customers).set({ ...input, updatedAt: new Date() })
        .where(and(eq(customers.companyId, companyId), eq(customers.id, id))).returning();
      if (!customer) throw new NotFoundException('Cliente não encontrado');
      return customer;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('CPF/CNPJ já cadastrado nesta empresa');
      throw error;
    }
  }

  async remove(companyId: string, id: string) {
    const [customer] = await this.database.db.update(customers).set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(and(eq(customers.companyId, companyId), eq(customers.id, id))).returning({ id: customers.id });
    if (!customer) throw new NotFoundException('Cliente não encontrado');
  }
}
