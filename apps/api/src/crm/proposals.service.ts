import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { companies, customers, crmContacts, crmOpportunities, crmPipelineStages, crmProposalCommands, crmProposalCounters, crmProposalEvents, crmProposalItems, crmProposals, crmSettings, sales } from '@gestaonf/database/schema';
import { and, asc, count, desc, eq, isNull, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { CustomersService } from '../customers/customers.service.js';
import { createCustomerSchema } from '../customers/customers.schemas.js';
import { SalesService, constraintName } from '../sales/sales.service.js';
import { createSaleSchema } from '../sales/sales.schemas.js';
import { CrmPolicyService, type CrmAccess } from './crm-policy.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { LeadCaptureService } from './lead-capture.service.js';
import { commandHash, lockKeys, type CrmDb, type CrmTx } from './crm-normalization.js';
import { createLeadSchema, createEntrySchema, keySchema, type CrmContext } from './crm.schemas.js';
import { effectiveProposalStatus, proposalAmounts, proposalCode, proposalToday, proposalTotals } from './proposal-money.js';
import { createProposalSchema, updateProposalSchema, proposalCommandSchema, declineProposalSchema, duplicateProposalSchema, proposalSettingsSchema, type CreateProposal, type UpdateProposal, type ProposalItemInput } from './proposal.schemas.js';
import { parseInput } from '../common/validate.js';
import type { ProposalSnapshot } from './proposal.types.js';

type Proposal = typeof crmProposals.$inferSelect;
type Contact = typeof crmContacts.$inferSelect;
const failure = (code: string, message: string) => new UnprocessableEntityException({ code, message });

@Injectable()
export class ProposalsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CrmPolicyService) private readonly policy: CrmPolicyService,
    @Inject(CrmHistoryService) private readonly history: CrmHistoryService, @Inject(LeadCaptureService) private readonly capture: LeadCaptureService,
    @Inject(CustomersService) private readonly customerService: CustomersService, @Inject(SalesService) private readonly saleService: SalesService) {}

  async row(a: CrmAccess, id: string, db: CrmDb = this.database.db, lock = false) {
    const query = db.select({ proposal: crmProposals }).from(crmProposals).innerJoin(crmOpportunities,
      and(eq(crmOpportunities.companyId, crmProposals.companyId), eq(crmOpportunities.id, crmProposals.opportunityId)))
      .where(and(eq(crmProposals.companyId, a.companyId), eq(crmProposals.id, id), this.policy.opportunityScope(a))).limit(1);
    const [r] = await (lock ? query.for('update', { of: crmProposals }) : query);
    if (!r) throw new NotFoundException('Proposta não encontrada');
    return r.proposal;
  }
  private version(p: Proposal, v: number) {
    if (p.version !== v) throw new ConflictException({ code: 'PROPOSAL_VERSION_CONFLICT', message: 'Proposta alterada. Atualize antes de salvar.' });
  }
  private async command(ctx: CrmContext, action: string, key: string, input: unknown,
    work: (a: CrmAccess, tx: CrmTx) => Promise<Record<string, unknown>>) {
    key = parseInput(keySchema, key);
    const namespace = `proposal:${action}:${ctx.userId}`, hash = commandHash(input);
    for (let attempt = 0; attempt < 128; attempt++) {
      try {
        return await this.database.db.transaction(async tx => {
          const a = await this.policy.access(ctx, tx);
          await lockKeys(tx, [`crm:command:${a.companyId}:${namespace}:${key}`]);
          const [previous] = await tx.select().from(crmProposalCommands).where(and(eq(crmProposalCommands.companyId, a.companyId), eq(crmProposalCommands.namespace, namespace), eq(crmProposalCommands.idempotencyKey, key))).limit(1);
          if (previous) {
            await this.row(a, previous.proposalId, tx);
            if (previous.requestHash !== hash) throw new ConflictException('Chave reutilizada com dados diferentes');
            return previous.result;
          }
          const result = await work(a, tx);
          await tx.insert(crmProposalCommands).values({ companyId: a.companyId, namespace, idempotencyKey: key, requestHash: hash, proposalId: String(result.proposalId), result });
          return result;
        });
      } catch (e) {
        if (constraintName(e) === 'sales_company_order_code_uq') continue;
        if (constraintName(e) === 'customers_company_tax_id_uq') throw new ConflictException({ code: 'PROPOSAL_CUSTOMER_CONFLICT', message: 'CPF/CNPJ já cadastrado. Selecione o cliente existente.' });
        throw e;
      }
    }
    throw new ConflictException('Não foi possível reservar o código do pedido');
  }
  private async items(a: CrmAccess, input: ProposalItemInput[], tx: CrmTx) {
    if (!input.length) throw failure('PROPOSAL_SERVICE_REQUIRED', 'Selecione pelo menos um serviço');
    const rows = [];
    for (const [i, item] of input.entries()) {
      const service = await this.policy.service(a, item.serviceId, tx);
      if (!service) throw failure('PROPOSAL_SERVICE_REQUIRED', 'Selecione um serviço');
      rows.push({ companyId: a.companyId, serviceId: service.id, position: i + 1, serviceNameSnapshot: service.name,
        descriptionSnapshot: item.description === undefined ? service.description : item.description, unitLabelSnapshot: service.unitLabel,
        nationalTaxCodeSnapshot: service.nationalTaxCode, nbsCodeSnapshot: service.nbsCode,
        quantity: item.quantity, unitPrice: item.unitPrice, discountType: item.discountType, discountInput: item.discountInput, ...proposalAmounts(item) });
    }
    return rows;
  }
  private async customer(a: CrmAccess, contact: Contact, input: CreateProposal, tx: CrmTx) {
    const id = input.customerId ?? contact.customerId;
    if (id) {
      if (contact.customerId && input.customerId && contact.customerId !== input.customerId) throw new ConflictException({ code: 'PROPOSAL_CUSTOMER_CONFLICT', message: 'Cliente diferente do vínculo atual do lead' });
      const [c] = await tx.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, id))).for('share').limit(1);
      if (!c || c.status !== 'ACTIVE') throw failure('PROPOSAL_CUSTOMER_INVALID', 'Selecione um cliente ativo desta empresa');
      return c;
    }
    const kind = input.newCustomer?.kind ?? contact.taxIdKind;
    const data = createCustomerSchema.safeParse({ kind,
      name: kind === 'PJ' ? contact.organizationName ?? contact.name : contact.name,
      taxId: contact.taxId, email: contact.email, phone: contact.phone, ...input.newCustomer, status: 'ACTIVE' });
    if (!data.success) throw failure('PROPOSAL_CUSTOMER_DETAILS_REQUIRED', 'Complete o tipo PF/PJ e os dados válidos do cliente antes de salvar a proposta');
    if (data.data.taxId) {
      const [existing] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.taxId, data.data.taxId))).limit(1);
      if (existing) throw new ConflictException({ code: 'PROPOSAL_CUSTOMER_CONFLICT', message: 'CPF/CNPJ já cadastrado. Confirme e selecione o cliente existente.', customerId: existing.id });
    }
    return this.customerService.createInTx(tx, a.companyId, a.userId, data.data);
  }
  private async contextForCreation(a: CrmAccess, input: CreateProposal, key: string, tx: CrmTx) {
    if (input.opportunityId) {
      const opportunity = await this.policy.opportunity(a, input.opportunityId, tx, true);
      const contact = await this.policy.contact(a, opportunity.contactId, tx, true);
      this.policy.activeContact(contact);
      if (opportunity.archivedAt) throw failure('PROPOSAL_OPPORTUNITY_ARCHIVED', 'Restaure a negociação antes de criar proposta');
      return { contact, opportunity };
    }
    const [customer] = await tx.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, input.customerId!))).for('share').limit(1);
    if (!customer || customer.status !== 'ACTIVE') throw failure('PROPOSAL_CUSTOMER_INVALID', 'Cliente inválido ou inativo');
    await lockKeys(tx, [`crm:proposal-customer:${a.companyId}:${customer.id}`]);
    const contacts = await tx.select().from(crmContacts).where(and(this.policy.contactScope(a, tx), eq(crmContacts.customerId, customer.id), isNull(crmContacts.archivedAt), input.contactId ? eq(crmContacts.id, input.contactId) : sql`true`)).limit(2);
    if (input.contactId && !contacts.length) throw new NotFoundException('Contato não encontrado para este cliente');
    if (contacts.length > 1) throw failure('PROPOSAL_CONTACT_REQUIRED', 'Selecione o contato para criar a negociação');
    const common = { title: input.title, interest: { primaryServiceId: input.items[0].serviceId }, assignedUserId: a.userId };
    const captureKey = commandHash({ proposalCreationKey: key, actor: a.userId });
    const capture = contacts.length ? await this.capture.captureInTx(a, createEntrySchema.parse(common), captureKey, tx, contacts[0].id)
      : await this.capture.captureInTx(a, createLeadSchema.parse({ ...common, lead: { name: customer.name, organizationName: customer.tradeName, taxId: customer.taxId, taxIdKind: customer.taxId ? customer.kind : null, email: customer.email, phone: customer.phone } }), captureKey, tx);
    const opportunity = await this.policy.opportunity(a, capture.opportunityId, tx, true), contact = await this.policy.contact(a, capture.leadId, tx, true);
    return { contact, opportunity };
  }
  create(ctx: CrmContext, raw: CreateProposal, key: string) {
    const input = parseInput(createProposalSchema, raw);
    return this.command(ctx, 'create', key, input, async (a, tx) => {
      const { contact, opportunity } = await this.contextForCreation(a, input, key, tx);
      const customer = await this.customer(a, contact, input, tx);
      if (contact.customerId !== customer.id) {
        await tx.update(crmContacts).set({ customerId: customer.id, version: contact.version + 1, updatedAt: new Date() }).where(eq(crmContacts.id, contact.id));
        await this.history.record(tx, a, { contactId: contact.id, opportunityId: opportunity.id, kind: 'CUSTOMER_LINKED', changes: { before: contact.customerId, after: customer.id } });
      }
      const rows = await this.items(a, input.items, tx), totals = proposalTotals(rows);
      const [counter] = await tx.insert(crmProposalCounters).values({ companyId: a.companyId, nextNumber: 2 })
        .onConflictDoUpdate({ target: crmProposalCounters.companyId, set: { nextNumber: sql`${crmProposalCounters.nextNumber} + 1` } }).returning();
      const [p] = await tx.insert(crmProposals).values({ companyId: a.companyId, proposalNumber: counter.nextNumber - 1, contactId: contact.id, opportunityId: opportunity.id, customerId: customer.id,
        title: input.title ?? opportunity.title, recipientName: customer.name, recipientOrganization: contact.organizationName,
        recipientEmail: customer.email, recipientTaxId: customer.taxId, commercialDescription: input.commercialDescription,
        paymentTerms: input.paymentTerms, notes: input.notes, terms: input.terms, validUntil: input.validUntil, ...totals, createdByUserId: a.userId }).returning();
      await tx.insert(crmProposalItems).values(rows.map(r => ({ ...r, proposalId: p.id })));
      await this.event(a, tx, p, 'CREATED', null, { proposal: p, items: rows });
      return this.result(p);
    });
  }
  private result(p: Proposal) { return { proposalId: p.id, proposalNumber: p.proposalNumber, proposalCode: proposalCode(p.proposalNumber), customerId: p.customerId, status: p.status, version: p.version, totalAmount: p.totalAmount }; }
  private async event(a: CrmAccess, tx: CrmTx, p: Proposal, kind: string, before: Record<string, unknown> | null, after: Record<string, unknown>, reason?: string | null) {
    const [event] = await tx.insert(crmProposalEvents).values({ companyId: a.companyId, proposalId: p.id, actorType: 'USER', actorUserId: a.userId, eventType: kind, before, after, reason }).returning();
    await this.history.record(tx, a, { contactId: p.contactId, opportunityId: p.opportunityId, proposalId: p.id, kind: `PROPOSAL_${kind}`, causeReference: `proposal-event:${event.id}`, changes: { proposalCode: proposalCode(p.proposalNumber), eventId: event.id, status: p.status } });
    await tx.update(crmOpportunities).set({ lastActivityAt: new Date() }).where(and(eq(crmOpportunities.companyId, a.companyId), eq(crmOpportunities.id, p.opportunityId)));
  }
  async get(ctx: CrmContext, id: string) {
    const a = await this.policy.access(ctx), p = await this.row(a, id);
    const [items, [sale]] = await Promise.all([this.database.db.select().from(crmProposalItems).where(and(eq(crmProposalItems.companyId, a.companyId), eq(crmProposalItems.proposalId, id))).orderBy(asc(crmProposalItems.position)),
      this.database.db.select({ id: sales.id, orderCode: sales.orderCode, status: sales.status }).from(sales).where(and(eq(sales.companyId, a.companyId), eq(sales.sourceProposalId, id))).limit(1)]);
    return { ...p, proposalCode: proposalCode(p.proposalNumber), effectiveStatus: effectiveProposalStatus(p, a.timezone), items, sale: sale ?? null };
  }
  async events(ctx: CrmContext, id: string, limit: number, offset: number) {
    const a = await this.policy.access(ctx); await this.row(a, id);
    const filter = and(eq(crmProposalEvents.companyId, a.companyId), eq(crmProposalEvents.proposalId, id));
    const [items, [total]] = await Promise.all([this.database.db.select().from(crmProposalEvents).where(filter).orderBy(desc(crmProposalEvents.recordedAt), desc(crmProposalEvents.id)).limit(limit).offset(offset), this.database.db.select({ n: count() }).from(crmProposalEvents).where(filter)]);
    return { items, total: total.n, limit, offset };
  }
  async update(ctx: CrmContext, id: string, raw: UpdateProposal) {
    const input = parseInput(updateProposalSchema, raw);
    return this.database.db.transaction(async tx => {
      const a = await this.policy.access(ctx, tx), p = await this.row(a, id, tx, true); this.version(p, input.expectedVersion);
      if (p.status !== 'DRAFT') throw new ConflictException('Apenas rascunhos podem ser editados. Duplique a proposta para renegociar.');
      const opportunity = await this.policy.opportunity(a, p.opportunityId, tx, true); if (opportunity.archivedAt) throw failure('PROPOSAL_OPPORTUNITY_ARCHIVED', 'Restaure a negociação');
      const contact = await this.policy.contact(a, p.contactId, tx); this.policy.activeContact(contact);
      const beforeItems = await tx.select().from(crmProposalItems).where(and(eq(crmProposalItems.companyId, a.companyId), eq(crmProposalItems.proposalId, id))).orderBy(asc(crmProposalItems.position));
      const { expectedVersion: _, items, ...patch } = input;
      const rows = items ? await this.items(a, items, tx) : beforeItems;
      const [updated] = await tx.update(crmProposals).set({ ...patch, ...proposalTotals(rows), version: p.version + 1, updatedAt: new Date() }).where(eq(crmProposals.id, id)).returning();
      if (items) {
        await tx.delete(crmProposalItems).where(and(eq(crmProposalItems.companyId, a.companyId), eq(crmProposalItems.proposalId, id)));
        await tx.insert(crmProposalItems).values(rows.map(r => ({ ...r, proposalId: id })));
      }
      await this.event(a, tx, updated, 'UPDATED', { proposal: p, items: beforeItems }, { proposal: updated, items: rows });
      return this.result(updated);
    });
  }
  private async snapshot(a: CrmAccess, p: Proposal, db: CrmDb, now: Date): Promise<ProposalSnapshot> {
    const [company] = await db.select().from(companies).where(eq(companies.id, a.companyId)).limit(1);
    const [customer] = await db.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, p.customerId))).limit(1);
    const items = await db.select().from(crmProposalItems).where(and(eq(crmProposalItems.companyId, a.companyId), eq(crmProposalItems.proposalId, p.id))).orderBy(asc(crmProposalItems.position));
    return { templateVersion: 1, proposalId: p.id, proposalCode: proposalCode(p.proposalNumber), title: p.title, currency: 'BRL', issuedAt: now.toISOString(),
      issuer: { name: company.name, legalName: company.legalName, taxId: company.taxId },
      recipient: { customerId: p.customerId, name: p.recipientName, kind: customer.kind, organization: p.recipientOrganization, email: p.recipientEmail, taxId: p.recipientTaxId },
      commercialDescription: p.commercialDescription, paymentTerms: p.paymentTerms, notes: p.notes, terms: p.terms, validUntil: p.validUntil,
      subtotalAmount: p.subtotalAmount, discountAmount: p.discountAmount, totalAmount: p.totalAmount,
      items: items.map(({ id: _id, proposalId: _p, companyId: _c, position: _n, ...i }) => i) };
  }
  async preview(ctx: CrmContext, id: string) {
    const a = await this.policy.access(ctx), p = await this.row(a, id);
    return { draft: p.status === 'DRAFT', snapshot: p.issuedSnapshot ? p.issuedSnapshot as unknown as ProposalSnapshot : await this.snapshot(a, p, this.database.db, new Date()) };
  }
  transition(ctx: CrmContext, id: string, action: 'send' | 'accept' | 'decline', raw: { expectedVersion: number; reason?: string | null }, key: string) {
    const input = parseInput(action === 'decline' ? declineProposalSchema : proposalCommandSchema, raw);
    return this.command(ctx, `${action}:${id}`, key, input, async (a, tx) => {
      const p = await this.row(a, id, tx, true); this.version(p, input.expectedVersion);
      const opportunity = await this.policy.opportunity(a, p.opportunityId, tx, true), contact = await this.policy.contact(a, p.contactId, tx); this.policy.activeContact(contact);
      if (opportunity.archivedAt) throw failure('PROPOSAL_OPPORTUNITY_ARCHIVED', 'Restaure a negociação');
      if (effectiveProposalStatus(p, a.timezone) === 'EXPIRED') throw new ConflictException({ code: 'PROPOSAL_EXPIRED', message: 'Proposta vencida. Duplique e reenvie.' });
      if (p.status !== (action === 'send' ? 'DRAFT' : 'SENT')) throw new ConflictException('Estado incompatível com esta ação');
      const now = new Date(); let patch: Partial<typeof crmProposals.$inferInsert>;
      if (action === 'send') {
        if (p.totalAmount === '0.00') throw failure('PROPOSAL_TOTAL_REQUIRED', 'Proposta deve ter valor total positivo');
        if (p.validUntil && p.validUntil < proposalToday(a.timezone)) throw failure('PROPOSAL_EXPIRED', 'Validade anterior ao dia de envio');
        const [c] = await tx.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, p.customerId))).for('share').limit(1);
        if (c.status !== 'ACTIVE' || contact.customerId !== p.customerId) throw failure('PROPOSAL_CUSTOMER_INVALID', 'Revise o vínculo com o cliente ativo');
        const snapshot = await this.snapshot(a, p, tx, now);
        for (const item of snapshot.items) await this.policy.service(a, item.serviceId, tx);
        patch = { status: 'SENT', sentAt: now, issuedSnapshot: snapshot as unknown as Record<string, unknown>, issuedHash: commandHash(snapshot) };
      } else patch = action === 'accept' ? { status: 'ACCEPTED', acceptedAt: now } : { status: 'DECLINED', declinedAt: now, declineReason: 'reason' in input && typeof input.reason === 'string' ? input.reason : null };
      const [updated] = await tx.update(crmProposals).set({ ...patch, version: p.version + 1, updatedAt: now }).where(eq(crmProposals.id, id)).returning();
      if (action === 'send') {
        const settings = await this.settingsInTx(a, tx);
        if (settings.proposalSentStageId && !['WON', 'LOST', 'DISQUALIFIED'].includes(opportunity.commercialStatus)) {
          const [stage] = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), eq(crmPipelineStages.id, settings.proposalSentStageId), eq(crmPipelineStages.pipelineId, opportunity.pipelineId), isNull(crmPipelineStages.archivedAt))).limit(1);
          if (stage && stage.id !== opportunity.stageId) {
            await tx.update(crmOpportunities).set({ stageId: stage.id, version: opportunity.version + 1, updatedAt: now }).where(eq(crmOpportunities.id, opportunity.id));
            await this.history.record(tx, a, { contactId: p.contactId, opportunityId: p.opportunityId, kind: 'STAGE_CHANGED', changes: { before: opportunity.stageId, after: stage.id }, causeReference: `proposal:${id}` });
          }
        }
      }
      await this.event(a, tx, updated, action === 'send' ? 'SENT' : action === 'accept' ? 'ACCEPTED' : 'DECLINED', { status: p.status }, { status: updated.status }, updated.declineReason);
      return this.result(updated);
    });
  }
  duplicate(ctx: CrmContext, id: string, raw: { expectedVersion: number; validUntil?: string | null }, key: string) {
    const input = parseInput(duplicateProposalSchema, raw);
    return this.command(ctx, `duplicate:${id}`, key, input, async (a, tx) => {
      const p = await this.row(a, id, tx, true); this.version(p, input.expectedVersion);
      const opportunity = await this.policy.opportunity(a, p.opportunityId, tx, true);
      if (opportunity.archivedAt) throw failure('PROPOSAL_OPPORTUNITY_ARCHIVED', 'Restaure a negociação');
      const contact = await this.policy.contact(a, p.contactId, tx); this.policy.activeContact(contact);
      const [customer] = await tx.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, p.customerId))).for('share').limit(1);
      if (customer.status !== 'ACTIVE' || contact.customerId !== p.customerId) throw failure('PROPOSAL_CUSTOMER_INVALID', 'Revise o vínculo do cliente antes de duplicar');
      const source = p.issuedSnapshot ? p.issuedSnapshot as unknown as ProposalSnapshot : await this.snapshot(a, p, tx, new Date());
      const rows = await this.items(a, source.items.map(i => ({ serviceId: i.serviceId, quantity: i.quantity, unitPrice: i.unitPrice, description: i.descriptionSnapshot, discountType: i.discountType as 'AMOUNT' | 'PERCENT', discountInput: i.discountInput })), tx);
      const [counter] = await tx.insert(crmProposalCounters).values({ companyId: a.companyId, nextNumber: 2 }).onConflictDoUpdate({ target: crmProposalCounters.companyId, set: { nextNumber: sql`${crmProposalCounters.nextNumber} + 1` } }).returning();
      const [copy] = await tx.insert(crmProposals).values({ companyId: a.companyId, contactId: p.contactId, opportunityId: p.opportunityId, customerId: p.customerId, proposalNumber: counter.nextNumber - 1,
        replacesProposalId: p.id, title: p.title, recipientName: p.recipientName, recipientEmail: p.recipientEmail, recipientOrganization: p.recipientOrganization, recipientTaxId: p.recipientTaxId,
        commercialDescription: source.commercialDescription, paymentTerms: source.paymentTerms, notes: source.notes, terms: source.terms, validUntil: input.validUntil ?? null,
        ...proposalTotals(rows), createdByUserId: a.userId }).returning();
      await tx.insert(crmProposalItems).values(rows.map(r => ({ ...r, proposalId: copy.id })));
      await this.event(a, tx, copy, 'CREATED', null, { replacesProposalId: id, items: rows });
      return this.result(copy);
    });
  }
  convert(ctx: CrmContext, id: string, raw: { expectedVersion: number }, key: string) {
    const input = parseInput(proposalCommandSchema, raw);
    return this.command(ctx, `convert:${id}`, key, input, async (a, tx) => {
      const p = await this.row(a, id, tx, true);
      const opportunity = await this.policy.opportunity(a, p.opportunityId, tx, true);
      const [existing] = await tx.select().from(sales).where(and(eq(sales.companyId, a.companyId), eq(sales.sourceProposalId, id))).limit(1);
      if (existing) return { ...this.result(p), saleId: existing.id, orderCode: existing.orderCode, saleStatus: existing.status, reviewUrl: `/portal-de-servicos?editar=${existing.id}&empresa=${a.companyId}` };
      this.version(p, input.expectedVersion);
      if (p.status !== 'ACCEPTED') throw new ConflictException('Apenas uma proposta aceita pode ser convertida');
      const contact = await this.policy.contact(a, p.contactId, tx, true); this.policy.activeContact(contact);
      if (contact.customerId !== p.customerId) throw failure('PROPOSAL_CUSTOMER_CONFLICT', 'Vínculo do cliente mudou. Revise antes de converter');
      if (opportunity.archivedAt) throw failure('PROPOSAL_OPPORTUNITY_ARCHIVED', 'Restaure a negociação');
      const snapshot = p.issuedSnapshot as unknown as ProposalSnapshot;
      if (commandHash(snapshot) !== p.issuedHash) throw new ConflictException('Documento da proposta inconsistente');
      const saleInput = createSaleSchema.parse({ customerId: p.customerId, notes: [`Proposta ${snapshot.proposalCode}`, snapshot.paymentTerms, snapshot.notes].filter(Boolean).join('\n').slice(0, 2000),
        items: snapshot.items.map(i => ({ serviceId: i.serviceId, quantity: i.quantity, unitPrice: i.unitPrice, discountAmount: i.discountAmount, description: i.descriptionSnapshot })), installments: [] });
      const sale = await this.saleService.createDraftInTx(tx, a.companyId, a.userId, randomUUID(), saleInput, { sourceProposalId: id, requestHash: commandHash({ proposalId: id, issuedHash: p.issuedHash }), frozenItems: snapshot.items });
      const [updated] = await tx.update(crmProposals).set({ status: 'CONVERTED', convertedAt: new Date(), version: p.version + 1, updatedAt: new Date() }).where(eq(crmProposals.id, id)).returning();
      const settings = await this.settingsInTx(a, tx);
      if (settings.winOpportunityOnProposalConversion && opportunity.commercialStatus !== 'WON') {
        await tx.update(crmOpportunities).set({ commercialStatus: 'WON', closedAt: new Date(), reasonCode: null, reasonText: null, version: opportunity.version + 1, updatedAt: new Date() }).where(eq(crmOpportunities.id, opportunity.id));
        await this.history.record(tx, a, { contactId: p.contactId, opportunityId: p.opportunityId, kind: 'STATUS_CHANGED', changes: { before: opportunity.commercialStatus, after: 'WON' }, causeReference: `proposal:${id}` });
      }
      await this.event(a, tx, updated, 'CONVERTED', { status: p.status }, { status: updated.status, saleId: sale.id, orderCode: sale.orderCode });
      return { ...this.result(updated), saleId: sale.id, orderCode: sale.orderCode, saleStatus: sale.status, reviewUrl: `/portal-de-servicos?editar=${sale.id}&empresa=${a.companyId}` };
    });
  }
  private async settingsInTx(a: CrmAccess, db: CrmDb) {
    await db.insert(crmSettings).values({ companyId: a.companyId }).onConflictDoNothing();
    const [settings] = await db.select().from(crmSettings).where(eq(crmSettings.companyId, a.companyId)).limit(1);
    return settings;
  }
  async settings(ctx: CrmContext) { const a = await this.policy.access(ctx); return this.settingsInTx(a, this.database.db); }
  async updateSettings(ctx: CrmContext, raw: unknown) {
    const input = parseInput(proposalSettingsSchema, raw);
    return this.database.db.transaction(async tx => {
      const a = await this.policy.access(ctx, tx); this.policy.requireManager(a);
      await this.settingsInTx(a, tx);
      const [old] = await tx.select().from(crmSettings).where(eq(crmSettings.companyId, a.companyId)).for('update').limit(1);
      if (old.version !== input.expectedVersion) throw new ConflictException('Configuração alterada');
      if (input.proposalSentStageId) {
        const [stage] = await tx.select().from(crmPipelineStages).where(and(eq(crmPipelineStages.companyId, a.companyId), eq(crmPipelineStages.id, input.proposalSentStageId), isNull(crmPipelineStages.archivedAt))).limit(1);
        if (!stage) throw failure('PROPOSAL_STAGE_INVALID', 'Etapa inválida');
      }
      const { expectedVersion: _, ...patch } = input;
      const [updated] = await tx.update(crmSettings).set({ ...patch, version: old.version + 1, updatedAt: new Date() }).where(eq(crmSettings.companyId, a.companyId)).returning();
      return updated;
    });
  }
}
