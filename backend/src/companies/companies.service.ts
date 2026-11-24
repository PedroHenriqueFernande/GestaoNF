import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, companyFiscalCertificates, companyUsers } from '@gestaonf/database/schema';
import { ALL_PERMISSIONS } from '@gestaonf/permissions';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { isValidCpf, isValidCnpj } from '../customers/tax-id.js';
import { DatabaseService } from '../database/database.module.js';
import type { createCompanySchema, updateCompanySchema } from './companies.schemas.js';
import { AccountsService } from '../accounts/accounts.service.js';
import { presentMembership, requireMembershipPermission, resolveMemberships } from '../permissions/permission-resolver.js';

@Injectable()
export class CompaniesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(AccountsService) private readonly accounts: AccountsService) {}

  async list(userId: string) {
    const memberships = await resolveMemberships(this.database.db, userId, 'all');
    if (!memberships.length) return [];
    const rows = await this.database.db.select({ id: companies.id, tradeName: companies.tradeName, accountId: companies.accountId, logoId: companies.logoId })
      .from(companies).where(inArray(companies.id, memberships.map(m => m.actor.companyId)));
    const byId = new Map(rows.map(row => [row.id, row]));
    return memberships.flatMap(m => {
      const row = byId.get(m.actor.companyId);
      return row ? [{ ...row, ...presentMembership(m) }] : [];
    });
  }

  async get(companyId: string, userId: string) {
    const [membership] = await resolveMemberships(this.database.db, userId, [companyId]);
    const [company] = membership ? await this.database.db.select().from(companies).where(eq(companies.id, companyId)).limit(1) : [];
    if (!membership || !company) throw new NotFoundException('Empresa não encontrada');
    return { ...company, ...presentMembership(membership) };
  }

  async create(userId: string, input: z.output<typeof createCompanySchema>) {
    this.validateTaxId(input.kind ?? 'PJ', input.taxId);
    this.validateTaxRegime(input.simplesNationalOption, input.simplesTaxationRegime, input.simplesIbsCbsRegime);
    this.validateCaepf(input.kind ?? 'PJ', input.caepfCode);
    const company = await this.database.db.transaction(async (tx) => {
      const accountId = await this.accounts.companyAccount(tx, userId, input.tradeName, input.accountId);
      const [created] = await tx.insert(companies).values({ ...input, accountId, kind: input.kind ?? 'PJ' }).returning();
      await tx.insert(companyUsers).values({ companyId: created.id, userId, role: 'OWNER' });
      return created;
    });
    return { ...company, roleLabel: 'OWNER' as const, accountOwner: true, permissions: [...ALL_PERMISSIONS], role: 'OWNER' as const };
  }

  async update(companyId: string, userId: string, input: z.output<typeof updateCompanySchema>) {
    const current = await this.get(companyId, userId);
    this.validateTaxId(input.kind ?? current.kind as 'PF' | 'PJ', input.taxId === undefined ? current.taxId : input.taxId);
    this.validateTaxRegime(
      input.simplesNationalOption === undefined ? current.simplesNationalOption : input.simplesNationalOption,
      input.simplesTaxationRegime === undefined ? current.simplesTaxationRegime : input.simplesTaxationRegime,
      input.simplesIbsCbsRegime === undefined ? current.simplesIbsCbsRegime : input.simplesIbsCbsRegime,
    );
    this.validateCaepf(input.kind ?? current.kind, input.caepfCode === undefined ? current.caepfCode : input.caepfCode);
    const { updated, membership } = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
      const membership = await requireMembershipPermission(tx, userId, companyId, 'company.edit', 'PATCH /companies/current');
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
      const [updated] = await tx.update(companies).set({ ...input, updatedAt: new Date() })
        .where(and(eq(companies.id, companyId), eq(companies.status, 'ACTIVE'))).returning();
      return { updated, membership };
    });
    if (!updated) throw new NotFoundException('Empresa não encontrada');
    return { ...updated, ...presentMembership(membership) };
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
}
