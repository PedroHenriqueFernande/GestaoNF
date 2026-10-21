import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyFiscalCertificates, companyUsers } from '@gestaonf/database/schema';
import { and, eq, exists, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { isValidCpf, isValidCnpj } from '../customers/tax-id.js';
import { DatabaseService } from '../database/database.module.js';
import type { createCompanySchema, updateCompanySchema } from './companies.schemas.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { companyAvailable } from '../accounts/account-policy.js';

@Injectable()
export class CompaniesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AccountsService) private readonly accounts: AccountsService) {}

  list(userId: string) {
    return this.database.db.select({ id: companies.id, name: companies.name, role: companyUsers.role, accountId: companies.accountId }).from(companyUsers)
      .innerJoin(companies, eq(companies.id, companyUsers.companyId))
      .where(and(eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), eq(companies.status, 'ACTIVE'), companyAvailable(companies.id)));
  }

  async get(companyId: string, userId: string) {
    const [row] = await this.database.db.select({ company: companies, role: companyUsers.role }).from(companies)
      .innerJoin(companyUsers, and(eq(companyUsers.companyId, companies.id), eq(companyUsers.userId, userId)))
      .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), eq(companyUsers.status, 'ACTIVE'), companyAvailable(companies.id))).limit(1);
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return { ...row.company, role: row.role };
  }

  async create(userId: string, input: z.output<typeof createCompanySchema>) {
    this.validateTaxId(input.kind ?? 'PJ', input.taxId);
    this.validateTradeName(input.kind ?? 'PJ', input.tradeName);
    this.validateTaxRegime(input.simplesNationalOption, input.simplesTaxationRegime, input.simplesIbsCbsRegime);
    this.validateCaepf(input.kind ?? 'PJ', input.caepfCode);
    const company = await this.database.db.transaction(async (tx) => {
      const accountId = await this.accounts.companyAccount(tx, userId, input.name, input.accountId);
      const [created] = await tx.insert(companies).values({ ...input, accountId, kind: input.kind ?? 'PJ' }).returning();
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
      input.simplesIbsCbsRegime === undefined ? current.simplesIbsCbsRegime : input.simplesIbsCbsRegime,
    );
    this.validateCaepf(input.kind ?? current.kind, input.caepfCode === undefined ? current.caepfCode : input.caepfCode);
    const allowed = this.database.db.select({ userId: companyUsers.userId }).from(companyUsers)
      .where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE'), inArray(companyUsers.role, ['OWNER', 'ADMIN'])));
    const [updated] = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
      const [locked] = await tx.select({ kind: companies.kind, taxId: companies.taxId, countryCode: companies.countryCode }).from(companies)
        .where(eq(companies.id, companyId)).limit(1);
      const nextKind = input.kind ?? locked?.kind;
      const nextTaxId = input.taxId === undefined ? locked?.taxId : input.taxId;
      const nextCountryCode = input.countryCode ?? locked?.countryCode;
      if (locked && (nextKind !== locked.kind || nextTaxId !== locked.taxId || nextCountryCode !== locked.countryCode)) {
        const [certificate] = await tx.select({ id: companyFiscalCertificates.id }).from(companyFiscalCertificates)
          .where(and(eq(companyFiscalCertificates.companyId, companyId), eq(companyFiscalCertificates.status, 'ACTIVE'))).limit(1);
        if (certificate) throw new ConflictException('Desative o certificado antes de alterar o CPF/CNPJ, tipo ou país da empresa.');
      }
      return tx.update(companies).set({ ...input, updatedAt: new Date() })
        .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'), exists(allowed))).returning();
    });
    if (!updated) throw new ForbiddenException('Sem permissão para alterar a empresa');
    return { ...updated, role: current.role };
  }

  private validateTaxId(kind: 'PF' | 'PJ', taxId: string | null | undefined) {
    if (taxId && (kind === 'PF' ? !isValidCpf(taxId) : !isValidCnpj(taxId))) {
      throw new BadRequestException(kind === 'PF' ? 'CPF inválido' : 'CNPJ inválido');
    }
  }

  private validateTaxRegime(option: string | null | undefined, regime: string | null | undefined, ibsCbsRegime: string | null | undefined) {
    if ((regime || ibsCbsRegime) && option !== '3' && option !== '4') throw new BadRequestException('A apuração pelo Simples exige enquadramento de microempresa/empresa de pequeno porte ou opção pendente.');
  }

  private validateCaepf(kind: string, caepf: string | null | undefined) {
    if (caepf && kind !== 'PF') throw new BadRequestException('O registro de atividade da pessoa física só pode ser informado para prestadora pessoa física.');
  }

  private validateTradeName(kind: 'PF' | 'PJ', tradeName: string | null | undefined) {
    if (kind === 'PF' && tradeName) throw new BadRequestException('Nome fantasia só é permitido para pessoa jurídica');
  }
}
