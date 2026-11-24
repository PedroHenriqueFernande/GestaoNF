import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { serviceMunicipalTaxCodes, services } from '@gestaonf/database/schema';
import { and, count, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { requirePermission, type Actor } from '../permissions/actor.js';
import { createServiceSchema, listServicesSchema, updateServiceSchema } from './services.schemas.js';

type CreateService = z.output<typeof createServiceSchema>;
type UpdateService = z.output<typeof updateServiceSchema>;
type ListServices = z.output<typeof listServicesSchema>;

const samePrice = (next: string | null, current: string | null) =>
  next === null || current === null ? next === current : Number(next) === Number(current);

/** Preço, situação e demais dados do serviço têm permissões próprias. */
function requireServiceChange(actor: Actor, before: { status: string; suggestedUnitPrice: string | null }, input: UpdateService, entry: string) {
  const { status, suggestedUnitPrice, ...fields } = input;
  if (status !== undefined && status !== before.status) requirePermission(actor, 'services.deactivate', entry);
  if (suggestedUnitPrice !== undefined && !samePrice(suggestedUnitPrice, before.suggestedUnitPrice)) requirePermission(actor, 'services.edit_price', entry);
  if (Object.keys(fields).length > 0) requirePermission(actor, 'services.edit', entry);
}

@Injectable()
export class ServicesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  private withFiscalClassification<T extends { nationalTaxCode: string | null }>(service: T) {
    return {
      ...service,
      fiscalClassificationStatus: service.nationalTaxCode ? 'NATIONAL_CODE_PROVIDED' : 'PENDING_NATIONAL_CODE',
    };
  }

  async create(companyId: string, userId: string, input: CreateService) {
    try {
      return await this.createInTx(this.database.db, companyId, userId, input);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Código interno já cadastrado nesta empresa');
      throw error;
    }
  }

  async createInTx(db: DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0], companyId: string, userId: string, input: CreateService) {
    try {
      const [service] = await db.insert(services).values({ ...input, companyId, createdByUserId: userId }).returning();
      return this.withFiscalClassification(service);
    } catch (error) {
      // Dentro de uma transação Postgres o erro a aborta; quem chama deve relançar e não reutilizar o tx.
      if (isUniqueViolation(error)) throw new ConflictException('Código interno já cadastrado nesta empresa');
      throw error;
    }
  }

  async list(companyId: string, input: ListServices) {
    const conditions: SQL[] = [eq(services.companyId, companyId)];
    if (input.status !== 'ALL') conditions.push(eq(services.status, input.status));
    if (input.search) {
      const pattern = `%${input.search.replace(/[\\%_]/g, '\\$&')}%`;
      conditions.push(or(
        ilike(services.name, pattern),
        ilike(services.internalCode, pattern),
        ilike(services.nationalTaxCode, pattern),
      )!);
    }
    const filter = and(...conditions);
    const [items, [total]] = await Promise.all([
      this.database.db.select().from(services).where(filter)
        .orderBy(services.name, services.id).limit(input.limit).offset(input.offset),
      this.database.db.select({ count: count() }).from(services).where(filter),
    ]);
    return {
      items: items.map((service) => this.withFiscalClassification(service)),
      total: total.count,
      limit: input.limit,
      offset: input.offset,
    };
  }

  async get(companyId: string, id: string) {
    const [service] = await this.database.db.select().from(services)
      .where(and(eq(services.companyId, companyId), eq(services.id, id))).limit(1);
    if (!service) throw new NotFoundException('Serviço não encontrado');
    return this.withFiscalClassification(service);
  }

  /** Altera dentro da transação recebida; devolve a linha antes e depois. Código interno repetido vira ConflictException. */
  async updateInTx(db: DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0], actor: Actor, id: string, input: UpdateService, entry: string) {
    const companyId = actor.companyId;
    const [existing] = await db.select().from(services).where(and(eq(services.companyId, companyId), eq(services.id, id))).for('update');
    if (!existing) throw new NotFoundException('Serviço não encontrado');
    requireServiceChange(actor, existing, input, entry);
    try {
      const [service] = await db.update(services).set({ ...input, updatedAt: new Date() })
        .where(and(eq(services.companyId, companyId), eq(services.id, id))).returning();
      return { before: this.withFiscalClassification(existing), after: this.withFiscalClassification(service) };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Código interno já cadastrado nesta empresa');
      throw error;
    }
  }

  async update(actor: Actor, id: string, input: UpdateService, entry: string) {
    return (await this.database.db.transaction((tx) => this.updateInTx(tx, actor, id, input, entry))).after;
  }

  async remove(companyId: string, id: string) {
    const [service] = await this.database.db.update(services)
      .set({ status: 'INACTIVE', updatedAt: new Date() })
      .where(and(eq(services.companyId, companyId), eq(services.id, id)))
      .returning({ id: services.id });
    if (!service) throw new NotFoundException('Serviço não encontrado');
  }

  async listMunicipalTaxCodes(companyId: string, serviceId: string) {
    await this.get(companyId, serviceId);
    return this.database.db.select({
      municipalityIbgeCode: serviceMunicipalTaxCodes.municipalityIbgeCode,
      municipalTaxCode: serviceMunicipalTaxCodes.municipalTaxCode,
      createdAt: serviceMunicipalTaxCodes.createdAt,
      updatedAt: serviceMunicipalTaxCodes.updatedAt,
    }).from(serviceMunicipalTaxCodes)
      .where(and(eq(serviceMunicipalTaxCodes.companyId, companyId), eq(serviceMunicipalTaxCodes.serviceId, serviceId)))
      .orderBy(serviceMunicipalTaxCodes.municipalityIbgeCode);
  }

  async upsertMunicipalTaxCode(companyId: string, serviceId: string, municipalityIbgeCode: string, municipalTaxCode: string) {
    await this.get(companyId, serviceId);
    const [entry] = await this.database.db.insert(serviceMunicipalTaxCodes)
      .values({ companyId, serviceId, municipalityIbgeCode, municipalTaxCode })
      .onConflictDoUpdate({
        target: [serviceMunicipalTaxCodes.companyId, serviceMunicipalTaxCodes.serviceId, serviceMunicipalTaxCodes.municipalityIbgeCode],
        set: { municipalTaxCode, updatedAt: new Date() },
      }).returning();
    return entry;
  }

  async removeMunicipalTaxCode(companyId: string, serviceId: string, municipalityIbgeCode: string) {
    await this.get(companyId, serviceId);
    const [entry] = await this.database.db.delete(serviceMunicipalTaxCodes)
      .where(and(
        eq(serviceMunicipalTaxCodes.companyId, companyId),
        eq(serviceMunicipalTaxCodes.serviceId, serviceId),
        eq(serviceMunicipalTaxCodes.municipalityIbgeCode, municipalityIbgeCode),
      )).returning({ municipalityIbgeCode: serviceMunicipalTaxCodes.municipalityIbgeCode });
    if (!entry) throw new NotFoundException('Código municipal não encontrado');
  }
}
