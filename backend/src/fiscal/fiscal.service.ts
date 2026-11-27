import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, nfseDps, nfseSeries, nfseSeriesAdjustments, nfseTaxProfiles, nfseTaxProfileRevisions, sales, services, users } from '@gestaonf/database/schema';
import { and, desc, eq, exists, lte, ne, or, sql } from 'drizzle-orm';
import { isForeignKeyViolation, isUniqueViolation } from '../common/validate.js';
import { DatabaseService } from '../database/database.module.js';
import type { AddTaxRevisionInput, CreateSeriesInput, CreateTaxProfileInput, EditSeriesInput, SelectSeriesInput, UpdateTaxProfileInput } from './fiscal.schemas.js';
import { requireMembershipPermission } from '../permissions/permission-resolver.js';

type Db = DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];
type TaxSnapshot = NonNullable<typeof import('@gestaonf/database/schema').saleItems.$inferInsert.taxSnapshot>;

function publicSeries(row: typeof nfseSeries.$inferSelect) {
  return { ...row, initialNumber: row.initialNumber.toString(), nextNumber: row.nextNumber.toString() };
}

function rateValues(input: Pick<AddTaxRevisionInput, 'issRatePercent' | 'pisRatePercent' | 'cofinsRatePercent' | 'csllRatePercent' | 'irRatePercent' | 'inssRatePercent' | 'issWithholdingSuggestion' | 'notes'>) {
  return {
    issRatePercent: input.issRatePercent, pisRatePercent: input.pisRatePercent,
    cofinsRatePercent: input.cofinsRatePercent, csllRatePercent: input.csllRatePercent,
    irRatePercent: input.irRatePercent, inssRatePercent: input.inssRatePercent,
    issWithholdingSuggestion: input.issWithholdingSuggestion, notes: input.notes,
  };
}

@Injectable()
export class FiscalService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async listSeries(companyId: string, environment?: 'HOMOLOGATION' | 'PRODUCTION') {
    const rows = await this.database.db.select().from(nfseSeries)
      .where(and(eq(nfseSeries.companyId, companyId), environment ? eq(nfseSeries.environment, environment) : undefined))
      .orderBy(desc(nfseSeries.createdAt));
    return rows.map(publicSeries);
  }

  async getSeries(companyId: string, id: string) {
    const [series] = await this.database.db.select().from(nfseSeries)
      .where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id))).limit(1);
    if (!series) throw new NotFoundException('Série não encontrada');
    const [locked, rows] = await Promise.all([
      this.seriesConfigurationLocked(series, this.database.db),
      this.database.db.select({ adjustment: nfseSeriesAdjustments, actorName: users.name })
        .from(nfseSeriesAdjustments).innerJoin(users, eq(users.id, nfseSeriesAdjustments.actorUserId))
        .where(and(eq(nfseSeriesAdjustments.companyId, companyId), eq(nfseSeriesAdjustments.seriesId, id)))
        .orderBy(desc(nfseSeriesAdjustments.createdAt)).limit(100),
    ]);
    const adjustments = rows.map(({ adjustment, actorName }) => ({ ...adjustment, actorName,
      oldNextNumber: adjustment.oldNextNumber.toString(), newNextNumber: adjustment.newNextNumber.toString() }));
    return { ...publicSeries(series), locked, adjustments };
  }

  async createSeries(companyId: string, userId: string, input: CreateSeriesInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.series', 'POST /fiscal/series');
    const [company] = await this.database.db.select({ taxId: companies.taxId, city: companies.cityIbgeCode, country: companies.countryCode })
      .from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company || company.country !== 'BR' || !company.taxId || !company.city) {
      throw new BadRequestException('Complete CPF/CNPJ e município brasileiro no cadastro da empresa antes de criar a série');
    }
    try {
      const row = await this.database.db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
        if (input.isDefault) await tx.update(nfseSeries).set({ isDefault: false, updatedAt: new Date(), version: sql`${nfseSeries.version} + 1` })
          .where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.issuerTaxIdSnapshot, company.taxId!), eq(nfseSeries.municipalityIbgeCode, company.city!), eq(nfseSeries.isDefault, true)));
        const [created] = await tx.insert(nfseSeries).values({ companyId, environment: input.environment,
          issuerTaxIdSnapshot: company.taxId!, municipalityIbgeCode: company.city!, seriesNumber: input.seriesNumber,
          initialNumber: BigInt(input.nextNumber), nextNumber: BigInt(input.nextNumber), isDefault: input.isDefault,
          createdByUserId: userId }).returning();
        return created;
      });
      return publicSeries(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Série já cadastrada ou já existe outra série padrão para esse ambiente');
      throw error;
    }
  }

  async selectSeries(companyId: string, userId: string, id: string, input: SelectSeriesInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.series', 'PATCH /fiscal/series/:id');
    try {
      const row = await this.database.db.transaction(async tx => {
        await tx.execute(sql`SELECT id FROM companies WHERE id = ${companyId} FOR UPDATE`);
        const [current] = await tx.select().from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id))).for('update').limit(1);
        if (!current) throw new NotFoundException('Série não encontrada');
        if (current.version !== input.expectedVersion) throw new ConflictException('Série alterada por outra pessoa; atualize a página');
        if (current.status !== 'ACTIVE') throw new ConflictException('Série indisponível para emissão.');
        await tx.update(nfseSeries).set({ isDefault: false, updatedAt: new Date(), version: sql`${nfseSeries.version} + 1` })
          .where(and(eq(nfseSeries.companyId, companyId), ne(nfseSeries.id, id),
            eq(nfseSeries.issuerTaxIdSnapshot, current.issuerTaxIdSnapshot), eq(nfseSeries.municipalityIbgeCode, current.municipalityIbgeCode), eq(nfseSeries.isDefault, true)));
        const [updated] = await tx.update(nfseSeries).set({ isDefault: true, version: current.version + 1, updatedAt: new Date() })
          .where(eq(nfseSeries.id, id)).returning();
        return updated;
      });
      return publicSeries(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Outra série padrão foi definida ao mesmo tempo');
      throw error;
    }
  }

  async deleteSeries(companyId: string, userId: string, id: string) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.series', 'DELETE /fiscal/series/:id');
    try {
      const [deleted] = await this.database.db.delete(nfseSeries)
        .where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id)))
        .returning({ id: nfseSeries.id });
      if (!deleted) throw new NotFoundException('Série não encontrada');
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException('Esta série está vinculada a vendas, reservas de DPS ou ao histórico de numeração e precisa ser preservada.');
      }
      throw error;
    }
  }

  private async seriesConfigurationLocked(series: typeof nfseSeries.$inferSelect, db: Db) {
    if (series.nextNumber !== series.initialNumber) return true;

    const { companyId, id } = series;
    const [linked] = await db.select({ id: nfseSeries.id }).from(nfseSeries)
      .where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id), or(
        exists(db.select({ id: sales.id }).from(sales).where(and(eq(sales.companyId, companyId), eq(sales.fiscalSeriesId, id)))),
        exists(db.select({ id: nfseDps.id }).from(nfseDps).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.seriesId, id)))),
        exists(db.select({ id: nfseSeriesAdjustments.id }).from(nfseSeriesAdjustments).where(and(eq(nfseSeriesAdjustments.companyId, companyId), eq(nfseSeriesAdjustments.seriesId, id)))),
      ))).limit(1);
    return !!linked;
  }

  async editSeries(companyId: string, userId: string, id: string, input: EditSeriesInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.series', 'PATCH /fiscal/series/:id');
    try {
      const row = await this.database.db.transaction(async tx => {
        const [current] = await tx.select().from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id))).for('update').limit(1);
        if (!current) throw new NotFoundException('Série não encontrada');
        if (current.version !== input.expectedVersion) throw new ConflictException('A série mudou. Feche o modal e abra novamente para editar.');
        const seriesNumber = input.seriesNumber ?? current.seriesNumber;
        const nextNumber = input.nextNumber === undefined ? current.nextNumber : BigInt(input.nextNumber);
        if (seriesNumber === current.seriesNumber && nextNumber === current.nextNumber) return current;

        const locked = await this.seriesConfigurationLocked(current, tx);
        if (locked && seriesNumber !== current.seriesNumber) {
          throw new ConflictException('O número de uma série com vínculos ou histórico fiscal precisa ser preservado.');
        }
        if (locked && nextNumber < current.nextNumber) {
          throw new ConflictException('O próximo número da DPS só pode aumentar em uma série com vínculos ou histórico fiscal.');
        }
        if (locked && nextNumber > current.nextNumber) {
          await tx.insert(nfseSeriesAdjustments).values({ companyId, seriesId: id, oldNextNumber: current.nextNumber,
            newNextNumber: nextNumber, reason: 'Alteração do próximo número da DPS na edição da série.', actorUserId: userId });
        }
        const [updated] = await tx.update(nfseSeries).set({
          seriesNumber, nextNumber, initialNumber: locked ? current.initialNumber : nextNumber,
          version: current.version + 1, updatedAt: new Date(),
        }).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, id))).returning();
        return updated;
      });
      return publicSeries(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Já existe uma série com esse número para o mesmo emissor, município e ambiente.');
      throw error;
    }
  }

  async listTaxProfiles(companyId: string) {
    const [profiles, revisions] = await Promise.all([
      this.database.db.select().from(nfseTaxProfiles).where(eq(nfseTaxProfiles.companyId, companyId)).orderBy(desc(nfseTaxProfiles.createdAt)),
      this.database.db.select().from(nfseTaxProfileRevisions).where(eq(nfseTaxProfileRevisions.companyId, companyId))
        .orderBy(desc(nfseTaxProfileRevisions.effectiveFrom), desc(nfseTaxProfileRevisions.revision)),
    ]);
    return profiles.map(profile => ({ ...profile, revisions: revisions.filter(row => row.profileId === profile.id) }));
  }

  private async validateService(companyId: string, serviceId: string | null, db: Db = this.database.db) {
    if (!serviceId) return;
    const [row] = await db.select({ id: services.id }).from(services).where(and(eq(services.companyId, companyId), eq(services.id, serviceId), eq(services.status, 'ACTIVE'))).limit(1);
    if (!row) throw new BadRequestException('Selecione um serviço ativo desta empresa');
  }

  private async clearDefault(companyId: string, scope: string, serviceId: string | null, municipality: string | null, db: Db) {
    await db.update(nfseTaxProfiles).set({ isDefault: false, version: sql`${nfseTaxProfiles.version} + 1`, updatedAt: new Date() })
      .where(and(eq(nfseTaxProfiles.companyId, companyId), eq(nfseTaxProfiles.scope, scope),
        serviceId ? eq(nfseTaxProfiles.serviceId, serviceId) : sql`${nfseTaxProfiles.serviceId} IS NULL`,
        municipality ? eq(nfseTaxProfiles.municipalityIbgeCode, municipality) : sql`${nfseTaxProfiles.municipalityIbgeCode} IS NULL`,
        eq(nfseTaxProfiles.isDefault, true)));
  }

  async createTaxProfile(companyId: string, userId: string, input: CreateTaxProfileInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.tax', 'POST /fiscal/tax-profiles');
    await this.validateService(companyId, input.serviceId);
    try {
      const id = await this.database.db.transaction(async tx => {
        if (input.isDefault) await this.clearDefault(companyId, input.scope, input.serviceId, input.municipalityIbgeCode, tx);
        const [profile] = await tx.insert(nfseTaxProfiles).values({ companyId, name: input.name, scope: input.scope,
          serviceId: input.serviceId, municipalityIbgeCode: input.municipalityIbgeCode,
          isDefault: input.isDefault, createdByUserId: userId }).returning({ id: nfseTaxProfiles.id });
        await tx.insert(nfseTaxProfileRevisions).values({ companyId, profileId: profile.id,
          revision: 1, effectiveFrom: input.revision.effectiveFrom, ...rateValues(input.revision), createdByUserId: userId });
        return profile.id;
      });
      return (await this.listTaxProfiles(companyId)).find(profile => profile.id === id)!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Já existe uma regra padrão para este alcance ou data');
      throw error;
    }
  }

  async updateTaxProfile(companyId: string, userId: string, id: string, input: UpdateTaxProfileInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.tax', 'PATCH /fiscal/tax-profiles/:id');
    try {
      await this.database.db.transaction(async tx => {
        const [current] = await tx.select().from(nfseTaxProfiles).where(and(eq(nfseTaxProfiles.companyId, companyId), eq(nfseTaxProfiles.id, id))).for('update').limit(1);
        if (!current) throw new NotFoundException('Regra não encontrada');
        if (current.version !== input.expectedVersion) throw new ConflictException('Regra alterada por outra pessoa; atualize a página');
        const status = input.status ?? current.status;
        const isDefault = status === 'ACTIVE' ? input.isDefault ?? current.isDefault : false;
        if (isDefault && !current.isDefault) await this.clearDefault(companyId, current.scope, current.serviceId, current.municipalityIbgeCode, tx);
        await tx.update(nfseTaxProfiles).set({ name: input.name ?? current.name, status, isDefault,
          version: current.version + 1, updatedAt: new Date() }).where(eq(nfseTaxProfiles.id, id));
      });
      return (await this.listTaxProfiles(companyId)).find(profile => profile.id === id)!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Outra regra padrão foi definida ao mesmo tempo');
      throw error;
    }
  }

  async addTaxRevision(companyId: string, userId: string, id: string, input: AddTaxRevisionInput) {
    await requireMembershipPermission(this.database.db, userId, companyId, 'fiscal.tax', 'POST /fiscal/tax-profiles/:id/revisions');
    try {
      await this.database.db.transaction(async tx => {
        const [profile] = await tx.select().from(nfseTaxProfiles).where(and(eq(nfseTaxProfiles.companyId, companyId), eq(nfseTaxProfiles.id, id))).for('update').limit(1);
        if (!profile) throw new NotFoundException('Regra não encontrada');
        if (profile.version !== input.expectedVersion) throw new ConflictException('Regra alterada por outra pessoa; atualize a página');
        const [latest] = await tx.select().from(nfseTaxProfileRevisions).where(and(eq(nfseTaxProfileRevisions.companyId, companyId), eq(nfseTaxProfileRevisions.profileId, id)))
          .orderBy(desc(nfseTaxProfileRevisions.effectiveFrom)).limit(1);
        if (latest && input.effectiveFrom <= latest.effectiveFrom) throw new BadRequestException('A nova vigência deve começar após a última revisão');
        await tx.insert(nfseTaxProfileRevisions).values({ companyId, profileId: id,
          revision: (latest?.revision ?? 0) + 1, effectiveFrom: input.effectiveFrom, ...rateValues(input), createdByUserId: userId });
        await tx.update(nfseTaxProfiles).set({ version: profile.version + 1, updatedAt: new Date() }).where(eq(nfseTaxProfiles.id, id));
      });
      return (await this.listTaxProfiles(companyId)).find(profile => profile.id === id)!;
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('Já existe uma revisão para essa data');
      throw error;
    }
  }

  async resolveTax(companyId: string, serviceId: string, competence: string, municipality: string | null, db: Db = this.database.db,
    requestedProfileId?: string | null): Promise<{ revisionId: string; snapshot: TaxSnapshot } | null> {
    if (requestedProfileId === null) return null;
    const serviceOnly = and(eq(nfseTaxProfiles.scope, 'SERVICE'), eq(nfseTaxProfiles.serviceId, serviceId));
    const serviceCity = municipality ? and(eq(nfseTaxProfiles.scope, 'SERVICE_MUNICIPALITY'), eq(nfseTaxProfiles.serviceId, serviceId), eq(nfseTaxProfiles.municipalityIbgeCode, municipality)) : undefined;
    const [match] = await db.select({ profile: nfseTaxProfiles, revision: nfseTaxProfileRevisions }).from(nfseTaxProfiles)
      .innerJoin(nfseTaxProfileRevisions, eq(nfseTaxProfileRevisions.profileId, nfseTaxProfiles.id))
      .where(and(eq(nfseTaxProfiles.companyId, companyId), eq(nfseTaxProfiles.status, 'ACTIVE'),
        requestedProfileId ? eq(nfseTaxProfiles.id, requestedProfileId) : eq(nfseTaxProfiles.isDefault, true),
        lte(nfseTaxProfileRevisions.effectiveFrom, competence), or(serviceCity, serviceOnly, eq(nfseTaxProfiles.scope, 'COMPANY'))))
      .orderBy(sql`CASE ${nfseTaxProfiles.scope} WHEN 'SERVICE_MUNICIPALITY' THEN 3 WHEN 'SERVICE' THEN 2 ELSE 1 END DESC`,
        desc(nfseTaxProfileRevisions.effectiveFrom), desc(nfseTaxProfileRevisions.revision)).limit(1);
    if (!match) {
      if (requestedProfileId) throw new BadRequestException('Regra tributária inválida ou sem revisão vigente para este serviço e município');
      return null;
    }
    const revision = match.revision;
    return { revisionId: revision.id, snapshot: { profileId: match.profile.id, profileName: match.profile.name,
      effectiveFrom: revision.effectiveFrom, issRatePercent: revision.issRatePercent,
      pisRatePercent: revision.pisRatePercent, cofinsRatePercent: revision.cofinsRatePercent,
      csllRatePercent: revision.csllRatePercent, irRatePercent: revision.irRatePercent,
      inssRatePercent: revision.inssRatePercent, issWithholdingSuggestion: revision.issWithholdingSuggestion } };
  }

  async previewTax(companyId: string, items: Array<{ serviceId: string; taxProfileId?: string | null }>, competence: string, municipality?: string | null) {
    const [company] = await this.database.db.select({ city: companies.cityIbgeCode }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company) throw new NotFoundException('Empresa não encontrada');
    const rows = await Promise.all(items.map(async item => {
      await this.validateService(companyId, item.serviceId);
      return { serviceId: item.serviceId, taxProfileId: item.taxProfileId,
        ...(await this.resolveTax(companyId, item.serviceId, competence, municipality === undefined ? company.city : municipality,
          this.database.db, item.taxProfileId)) };
    }));
    return { items: rows, municipalityIbgeCode: municipality === undefined ? company.city : municipality,
      notice: 'Sugestões comerciais. A emissão fiscal ainda deve validar município, regime, retenções e leiaute vigente.' };
  }
}
