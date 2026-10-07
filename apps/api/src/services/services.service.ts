import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { serviceMunicipalTaxCodes, services } from '@gestaonf/database/schema';
import { and, count, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import { createServiceSchema, listServicesSchema, updateServiceSchema } from './services.schemas.js';

type CreateService = z.output<typeof createServiceSchema>;
type UpdateService = z.output<typeof updateServiceSchema>;
type ListServices = z.output<typeof listServicesSchema>;

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
      const [service] = await this.database.db.insert(services)
        .values({ ...input, companyId, createdByUserId: userId }).returning();
      return this.withFiscalClassification(service);
    } catch (error) {
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

  async update(companyId: string, id: string, input: UpdateService) {
    try {
      const [service] = await this.database.db.update(services)
        .set({ ...input, updatedAt: new Date() })
        .where(and(eq(services.companyId, companyId), eq(services.id, id))).returning();
      if (!service) throw new NotFoundException('Serviço não encontrado');
      return this.withFiscalClassification(service);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Código interno já cadastrado nesta empresa');
      throw error;
    }
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
