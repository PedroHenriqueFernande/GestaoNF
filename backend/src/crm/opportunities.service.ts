import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { crmContacts, crmLeadEntries, crmOpportunities, crmPipelines, crmPipelineStages, services } from '@gestaonf/database/schema';
import { and, asc, count, desc, eq, isNull, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService, type CrmAccess } from './crm-policy.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { changedFields, expectVersion, terminal, type CrmTx } from './crm-normalization.js';
import { contactFilters, negotiationFilters, contactJoin, entryJoin, inCompanies, publicEntry, servicePriceJoin, servicePriceSummary } from './crm-query.js';
import { stageSchema, statusSchema, updateOpportunitySchema, type CrmContext, type ListInput } from './crm.schemas.js';
import { can } from '../permissions/actor.js';

@Injectable()
export class OpportunitiesService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CrmPolicyService) private readonly policy: CrmPolicyService,
    @Inject(CrmHistoryService) private readonly history: CrmHistoryService) {}
  async list(ctx: CrmContext, input: ListInput) {
    const a = await this.policy.access(ctx);
    return this.page(this.listConditions([a.companyId], input), input, can(a.actor, 'services.access') ? [a.companyId] : []);
  }
  overview(companyIds: readonly string[], input: ListInput, priceCompanyIds: readonly string[]) {
    return this.page(this.listConditions(companyIds, input), input, priceCompanyIds);
  }
  listConditions(companyIds: readonly string[], input: ListInput) {
    return and(inCompanies(crmOpportunities.companyId, companyIds), ...contactFilters(input), ...negotiationFilters(input));
  }
  private async page(filter: SQL | undefined, input: ListInput, priceCompanyIds: readonly string[]) {
    const db = this.database.db;
    const priceJoin = servicePriceJoin(priceCompanyIds);
    const [rows, [summary]] = await Promise.all([
      db.select({ opportunity: crmOpportunities, lead: { id: crmContacts.id, name: crmContacts.name, organizationName: crmContacts.organizationName }, entry: crmLeadEntries, servicePrice: services.suggestedUnitPrice })
        .from(crmOpportunities).innerJoin(crmContacts, contactJoin).innerJoin(crmLeadEntries, entryJoin).leftJoin(services, priceJoin)
        .where(filter).orderBy(desc(crmOpportunities.createdAt), desc(crmOpportunities.id)).limit(input.limit).offset(input.offset),
      db.select({ total: count(), ...servicePriceSummary }).from(crmOpportunities).innerJoin(crmContacts, contactJoin).innerJoin(crmLeadEntries, entryJoin).leftJoin(services, priceJoin).where(filter),
    ]);
    return { items: rows.map((r) => ({ ...r.opportunity, lead: r.lead, origin: publicEntry(r.entry), servicePrice: r.servicePrice })), total: summary.total, summary, limit: input.limit, offset: input.offset };
  }
  async get(ctx: CrmContext, id: string) {
    const db = this.database.db, a = await this.policy.access(ctx), card = await this.policy.opportunity(a, id);
    const [contact, [entry], [service], [stage]] = await Promise.all([
      this.policy.contact(a, card.contactId),
      db.select().from(crmLeadEntries).where(and(eq(crmLeadEntries.companyId, a.companyId), eq(crmLeadEntries.id, card.originEntryId))).limit(1),
      card.primaryServiceId && can(a.actor, 'services.access')
        ? db.select({ name: services.name, price: services.suggestedUnitPrice }).from(services).where(and(eq(services.companyId, a.companyId), eq(services.id, card.primaryServiceId))).limit(1)
        : [],
      db.select({ name: crmPipelineStages.name }).from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), eq(crmPipelineStages.pipelineId, card.pipelineId), eq(crmPipelineStages.id, card.stageId))).limit(1),
    ]);
    return { ...card, lead: contact, origin: publicEntry(entry), stageName: stage?.name ?? null, serviceName: service?.name ?? null, servicePrice: service?.price ?? null };
  }
  private async mutate(ctx: CrmContext, id: string, version: number,
    apply: (tx: CrmTx, a: CrmAccess, old: typeof crmOpportunities.$inferSelect) => Promise<{ patch: Partial<typeof crmOpportunities.$inferInsert>; kind: string }>, allowArchived = false) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx), initial = await this.policy.opportunity(a, id, tx);
      const contact = await this.policy.contact(a, initial.contactId, tx, true); this.policy.activeContact(contact);
      const old = await this.policy.opportunity(a, id, tx, true); expectVersion(old.version, version);
      if (old.archivedAt && !allowArchived) throw new BadRequestException('Restaure a negociação antes desta operação');
      const { patch, kind } = await apply(tx, a, old), changes = changedFields(old, patch);
      if (!Object.keys(changes).length) return old;
      const now = new Date();
      const [row] = await tx.update(crmOpportunities).set({ ...patch, version: old.version + 1, updatedAt: now, lastActivityAt: now }).where(and(eq(crmOpportunities.companyId, ctx.companyId), eq(crmOpportunities.id, id))).returning();
      await this.history.record(tx, a, { contactId: old.contactId, opportunityId: id, kind, changes });
      return row;
    });
  }
  update(ctx: CrmContext, id: string, input: z.output<typeof updateOpportunitySchema>) {
    return this.mutate(ctx, id, input.expectedVersion, async (tx, a) => {
      const { expectedVersion: _version, ...patch } = input;
      if (patch.assignedUserId !== undefined) await this.policy.assignee(a, patch.assignedUserId, tx, await this.policy.opportunity(a, id, tx));
      await this.policy.service(a, patch.primaryServiceId, tx);
      return { patch, kind: patch.assignedUserId !== undefined ? 'ASSIGNED' : 'CONTACT_UPDATED' };
    });
  }
  status(ctx: CrmContext, id: string, input: z.output<typeof statusSchema>) {
    return this.mutate(ctx, id, input.expectedVersion, async (_tx, _a, old) => {
      const withReason = ['LOST', 'DISQUALIFIED'].includes(input.status);
      if (!withReason && (input.reasonCode || input.reasonText)) throw new BadRequestException('Motivo permitido somente em perda ou desqualificação');
      return { kind: 'STATUS_CHANGED', patch: {
        commercialStatus: input.status,
        closedAt: terminal(input.status) ? (terminal(old.commercialStatus) ? old.closedAt : new Date()) : null,
        reasonCode: withReason ? (input.reasonCode === undefined && old.commercialStatus === input.status ? old.reasonCode : input.reasonCode ?? null) : null,
        reasonText: withReason ? (input.reasonText === undefined && old.commercialStatus === input.status ? old.reasonText : input.reasonText ?? null) : null,
      } };
    });
  }
  stage(ctx: CrmContext, id: string, input: z.output<typeof stageSchema>) {
    return this.mutate(ctx, id, input.expectedVersion, async (tx, a, old) => {
      await this.activeDestination(tx, a, old.pipelineId, input.stageId);
      return { patch: { stageId: input.stageId }, kind: 'STAGE_CHANGED' };
    });
  }
  archive(ctx: CrmContext, id: string, expectedVersion: number, restore = false) {
    return this.mutate(ctx, id, expectedVersion, async (tx, a, old) => {
      if (restore) await this.activeDestination(tx, a, old.pipelineId, old.stageId);
      return { patch: { archivedAt: restore ? null : old.archivedAt ?? new Date() }, kind: restore ? 'RESTORED' : 'ARCHIVED' };
    }, true);
  }
  private async activeDestination(tx: CrmTx, a: CrmAccess, pipelineId: string, stageId: string) {
    const [pipeline] = await tx.select({ id: crmPipelines.id }).from(crmPipelines).where(and(eq(crmPipelines.companyId, a.companyId), eq(crmPipelines.id, pipelineId), isNull(crmPipelines.archivedAt))).for('share').limit(1);
    const [stage] = await tx.select({ id: crmPipelineStages.id }).from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), eq(crmPipelineStages.pipelineId, pipelineId), eq(crmPipelineStages.id, stageId), isNull(crmPipelineStages.archivedAt))).for('share').limit(1);
    if (!pipeline || !stage) throw new BadRequestException('Coluna inválida, arquivada ou de outro funil');
  }
  async pipelines(ctx: CrmContext) {
    const a = await this.policy.access(ctx), db = this.database.db;
    const [pipelines, stages] = await Promise.all([
      db.select().from(crmPipelines).where(and(eq(crmPipelines.companyId, a.companyId), isNull(crmPipelines.archivedAt))).orderBy(asc(crmPipelines.createdAt), asc(crmPipelines.id)),
      db.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), isNull(crmPipelineStages.archivedAt))).orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id)),
    ]);
    return { items: pipelines.map((pipeline) => ({ ...pipeline, stages: stages.filter((s) => s.pipelineId === pipeline.id) })) };
  }
}

