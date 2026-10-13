import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { crmContacts, crmLeadEntries, crmOpportunities, crmPipelines, crmPipelineStages } from '@gestaonf/database/schema';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { parseInput, isUniqueViolation } from '../common/validate.js';
import { CrmPolicyService, type CrmAccess } from './crm-policy.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { commandHash, lockKeys, phoneKey, validateDocument, type CrmTx } from './crm-normalization.js';
import { createLeadSchema, createEntrySchema, idSchema, keySchema, type CrmContext, type CreateLead, type CreateEntry } from './crm.schemas.js';

// Only backend adapters may provide these verified references. HTTP never accepts them.
export type VerifiedCaptureSource = {
  kind: 'FORM' | 'META_ADS' | 'GOOGLE_ADS' | 'IMPORT' | 'NERO' | 'API';
  namespace: string; eventId: string; formReference?: string;
  externalCampaignId?: string; externalAdId?: string;
};
@Injectable()
export class LeadCaptureService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CrmPolicyService) private readonly policy: CrmPolicyService,
    @Inject(CrmHistoryService) private readonly history: CrmHistoryService) {}

  create(ctx: CrmContext, input: CreateLead, key: string) {
    return this.capture(ctx, parseInput(createLeadSchema, input), parseInput(keySchema, key));
  }
  addEntry(ctx: CrmContext, id: string, input: CreateEntry, key: string) {
    return this.capture(ctx, parseInput(createEntrySchema, input), parseInput(keySchema, key), parseInput(idSchema, id));
  }
  async capture(ctx: CrmContext, input: CreateLead | CreateEntry, key: string, contactId?: string, source?: VerifiedCaptureSource) {
    key = parseInput(keySchema, key);
    if (contactId) { contactId = parseInput(idSchema, contactId); input = parseInput(createEntrySchema, input); }
    else input = parseInput(createLeadSchema, input);
    if (source && (!source.namespace.trim() || source.namespace.length > 160 || !source.eventId.trim() || source.eventId.length > 200 || (source.formReference?.length ?? 0) > 200 || (source.externalAdId?.length ?? 0) > 200 || (source.externalCampaignId?.length ?? 0) > 200)) throw new BadRequestException('Referência de captação inválida');
    const work = () => this.database.db.transaction((tx) => this.captureInTx(ctx, input, key, tx, contactId, source));
    try { return await work(); } catch (error) {
      if (isUniqueViolation(error)) return work();
      throw error;
    }
  }
  /** Internal composition boundary: caller owns the transaction and validates input. */
  async captureInTx(ctx: CrmContext, input: CreateLead | CreateEntry, key: string, tx: CrmTx, contactId?: string, source?: VerifiedCaptureSource) {
    const namespace = `${source ? source.kind.toLowerCase() : 'manual'}:${contactId ? 'entry' : 'lead'}:${ctx.userId}`;
    const hash = commandHash({ contactId: contactId ?? null, input, source: source ?? null });
      const a = await this.policy.access(ctx, tx);
      await lockKeys(tx, [`crm:command:${ctx.companyId}:${namespace}:${key}`, ...(source ? [`crm:event:${ctx.companyId}:${source.namespace}:${source.eventId}`] : [])]);
      const previous = await tx.select().from(crmLeadEntries).where(and(eq(crmLeadEntries.companyId, ctx.companyId), or(
        and(eq(crmLeadEntries.commandNamespace, namespace), eq(crmLeadEntries.idempotencyKey, key)),
        ...(source ? [and(eq(crmLeadEntries.sourceNamespace, source.namespace), eq(crmLeadEntries.sourceEventId, source.eventId))] : []),
      ))).limit(1);
      if (previous[0]) {
        if (previous[0].requestHash !== hash) throw new ConflictException('Chave ou evento reutilizado com dados diferentes');
        const [card] = await tx.select().from(crmOpportunities).where(and(this.policy.opportunityScope(a), eq(crmOpportunities.originEntryId, previous[0].id))).limit(1);
        if (!card) throw new ConflictException('Captação anterior indisponível para este usuário');
        await this.policy.contact(a, card.contactId, tx);
        return { leadId: card.contactId, entryId: previous[0].id, opportunityId: card.id };
      }
      const destination = await this.destination(tx, a, input.pipelineId);
      const cardAssignee = input.assignedUserId === undefined
        ? ('lead' in input && input.lead.assignedUserId !== undefined ? input.lead.assignedUserId : ctx.userId)
        : input.assignedUserId;
      await this.policy.assignee(a, cardAssignee, tx);
      const service = await this.policy.service(a, input.interest.primaryServiceId, tx);
      let contact: typeof crmContacts.$inferSelect;
      if (contactId) {
        contact = await this.policy.contact(a, contactId, tx, true);
        this.policy.activeContact(contact);
      } else {
        const profile = (input as CreateLead).lead;
        validateDocument(profile);
        const assignee = profile.assignedUserId === undefined ? ctx.userId : profile.assignedUserId;
        await this.policy.assignee(a, assignee, tx);
        [contact] = await tx.insert(crmContacts).values({
          companyId: ctx.companyId, name: profile.name, organizationName: profile.organizationName ?? null,
          email: profile.email ?? null, phone: profile.phone ?? null, phoneKey: phoneKey(profile.phone),
          taxId: profile.taxId ?? null, taxIdKind: profile.taxIdKind ?? null, notes: profile.notes ?? null,
          assignedUserId: assignee, createdByUserId: ctx.userId,
        }).returning();
        await this.history.record(tx, a, { contactId: contact.id, kind: 'CONTACT_CREATED', changes: { name: contact.name } });
      }
      const snapshot = 'lead' in input ? Object.fromEntries(Object.entries(input.lead).filter(([k]) => ['name', 'organizationName', 'email', 'phone', 'taxId', 'taxIdKind', 'notes'].includes(k))) : {};
      const [entry] = await tx.insert(crmLeadEntries).values({
        companyId: ctx.companyId, contactId: contact.id, captureKind: source?.kind ?? 'MANUAL',
        ...input.capture, sourceNamespace: source?.namespace ?? null, sourceEventId: source?.eventId ?? null,
        sourceFormReference: source?.formReference ?? null, externalCampaignId: source?.externalCampaignId ?? null, externalAdId: source?.externalAdId ?? null,
        primaryServiceId: input.interest.primaryServiceId ?? null, interestDescription: input.interest.description ?? null,
        submittedContact: snapshot, actorUserId: ctx.userId, commandNamespace: namespace, idempotencyKey: key, requestHash: hash,
      }).returning();
      const [card] = await tx.insert(crmOpportunities).values({
        companyId: ctx.companyId, contactId: contact.id, originEntryId: entry.id, ...destination,
        title: (input.title ?? service?.name ?? input.interest.description ?? `Atendimento de ${contact.name}`).slice(0, 200),
        primaryServiceId: input.interest.primaryServiceId ?? null, estimatedAmount: input.interest.estimatedAmount ?? null,
        expectedCloseOn: input.interest.expectedCloseOn ?? null, assignedUserId: cardAssignee, createdByUserId: ctx.userId,
      }).returning();
      await this.history.record(tx, a, { contactId: contact.id, entryId: entry.id, opportunityId: card.id, kind: 'ENTRY_RECEIVED', changes: { captureKind: entry.captureKind } });
      await this.history.record(tx, a, { contactId: contact.id, entryId: entry.id, opportunityId: card.id, kind: 'OPPORTUNITY_CREATED', changes: { status: 'NEW', stageId: card.stageId } });
      return { leadId: contact.id, entryId: entry.id, opportunityId: card.id };
  }
  private async destination(tx: CrmTx, a: CrmAccess, requestedId?: string) {
    await lockKeys(tx, [`crm:pipeline:${a.companyId}`]);
    let [pipeline] = await tx.select().from(crmPipelines).where(and(eq(crmPipelines.companyId, a.companyId), isNull(crmPipelines.archivedAt), requestedId ? eq(crmPipelines.id, requestedId) : eq(crmPipelines.isDefault, true))).for('share').limit(1);
    if (!pipeline && requestedId) throw new BadRequestException('Funil inválido ou arquivado');
    if (!pipeline) {
      [pipeline] = await tx.insert(crmPipelines).values({ companyId: a.companyId, name: 'Funil comercial', isDefault: true, createdByUserId: a.userId }).returning();
      await tx.insert(crmPipelineStages).values({ companyId: a.companyId, pipelineId: pipeline.id, name: 'Novo lead', position: 1, isEntry: true });
    }
    const [stage] = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), eq(crmPipelineStages.pipelineId, pipeline.id), isNull(crmPipelineStages.archivedAt))).orderBy(asc(crmPipelineStages.position), asc(crmPipelineStages.id)).for('share').limit(1);
    if (!stage?.isEntry) throw new ConflictException('Funil sem primeira coluna de entrada válida');
    return { pipelineId: pipeline.id, stageId: stage.id };
  }
}
