import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyUsers } from '@gestaonf/database/schema';
import { and, eq, exists, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { isValidCpf, isValidCnpj } from '../customers/tax-id.js';
import { DatabaseService } from '../database/database.module.js';
import type { createCompanySchema, updateCompanySchema } from './companies.schemas.js';

@Injectable()
export class CompaniesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  list(userId: string) {
    return this.database.db.select({ id: companies.id, name: companies.name, role: companyUsers.role }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE')));
  }

  async get(companyId: string, userId: string) {
    const [row] = await this.database.db.select({ company: companies, role: companyUsers.role }).from(companies)
      .innerJoin(companyUsers, and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, userId)))
      .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), eq(companyUsers.status, 'ACTIVE'))).limit(1);
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return { ...row.company, role: row.role };
  }

  async create(userId: string, input: z.output<typeof createCompanySchema>) {
    this.validateTaxId(input.kind ?? 'PJ', input.taxId);
    this.validateTradeName(input.kind ?? 'PJ', input.tradeName);
    this.validateTaxRegime(input.simplesNationalOption, input.simplesTaxationRegime);
    const company = await this.database.db.transaction(async (tx) => {
      const [created] = await tx.insert(companies).values({ ...input, kind: input.kind ?? 'PJ' }).returning();
      await tx.insert(companyUsers).values({ companyId: created.id, userId, role: 'OWNER' });
      return created;
    });
    return { ...company, role: 'OWNER' };
  }

  async update(companyId: string, userId: string, input: z.output<typeof updateCompanySchema>) {
    const current = await this.get(companyId, userId);
    if (current.role !== 'OWNER' && current.role !== 'ADMIN') throw new ForbiddenException('Sem permissão para alterar a empresa');
    this.validateTaxId(input.kind ?? current.kind as 'PF' | 'PJ', input.taxId === undefined ? current.taxId : input.taxId);
    this.validateTradeName(input.kind ?? current.kind as 'PF' | 'PJ', input.tradeName === undefined ? current.tradeName : input.tradeName);
    this.validateTaxRegime(
      input.simplesNationalOption === undefined ? current.simplesNationalOption : input.simplesNationalOption,
      input.simplesTaxationRegime === undefined ? current.simplesTaxationRegime : input.simplesTaxationRegime,
    );
    const allowed = this.database.db.select({ userId: companyUsers.userId }).from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), inArray(companyUsers.role, ['OWNER', 'ADMIN'])));
    const [updated] = await this.database.db.update(companies).set({ ...input, updatedAt: new Date() })
      .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), exists(allowed))).returning();
    if (!updated) throw new ForbiddenException('Sem permissão para alterar a empresa');
    return { ...updated, role: current.role };
  }

  private validateTaxId(kind: 'PF' | 'PJ', taxId: string | null | undefined) {
    if (taxId && (kind === 'PF' ? !isValidCpf(taxId) : !isValidCnpj(taxId))) {
      throw new BadRequestException(kind === 'PF' ? 'CPF inválido' : 'CNPJ inválido');
    }
  }

  private validateTaxRegime(option: string | null | undefined, regime: string | null | undefined) {
    if (regime && option !== '3') throw new BadRequestException('Regime de apuração do Simples exige opção ME/EPP');
  }

  private validateTradeName(kind: 'PF' | 'PJ', tradeName: string | null | undefined) {
    if (kind === 'PF' && tradeName) throw new BadRequestException('Nome fantasia só é permitido para pessoa jurídica');
  }
}
