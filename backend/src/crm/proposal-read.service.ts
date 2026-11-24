import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { companies, customers, services, crmContacts, crmLeadEntries, crmOpportunities, crmProposalItems, crmProposals } from '@gestaonf/database/schema';
import { and, count, desc, eq, exists, gte, ilike, isNull, lte, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService } from './crm-policy.service.js';
import { inCompanies, inCompanyZone, period } from './crm-query.js';
import { escapeLike } from './crm-normalization.js';
import { proposalCode } from './proposal-money.js';
import type { CrmContext } from './crm.schemas.js';
import type { ProposalList, ProposalPrefill } from './proposal.schemas.js';

const proposalZone = alias(companies, 'proposal_zone');
/** Situação efetiva: SENT vira EXPIRED após o fim do dia da validade no fuso da empresa da proposta. Recebe a coluna de fuso já presente na consulta. */
const effectiveStatus = (timezone: AnyColumn) => sql<string>`case when ${crmProposals.status} = 'SENT' and ${crmProposals.validUntil} < (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date then 'EXPIRED' else ${crmProposals.status} end`;

@Injectable()
export class ProposalReadService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CrmPolicyService) private readonly policy: CrmPolicyService) {}
  async list(ctx: CrmContext, input: ProposalList) {
    const a = await this.policy.access(ctx);
    return this.page(this.listConditions([a.companyId], input), input);
  }
  overview(companyIds: readonly string[], input: ProposalList) {
    return this.page(this.listConditions(companyIds, input), input);
  }
  listConditions(companyIds: readonly string[], input: ProposalList) {
    const db = this.database.db;
    const filters = [inCompanies(crmProposals.companyId, companyIds)];
    if (input.status !== 'ALL') filters.push(inCompanyZone(crmProposals.companyId, timezone => sql`${effectiveStatus(timezone)} = ${input.status}`));
    if (input.opportunityId) filters.push(eq(crmProposals.opportunityId, input.opportunityId));
    if (input.contactId) filters.push(eq(crmProposals.contactId, input.contactId));
    if (input.customerId) filters.push(eq(crmProposals.customerId, input.customerId));
    if (input.assignedUserId) filters.push(eq(crmOpportunities.assignedUserId, input.assignedUserId));
    if (input.serviceId) filters.push(exists(db.select({ id: crmProposalItems.id }).from(crmProposalItems).where(and(eq(crmProposalItems.companyId, crmProposals.companyId), eq(crmProposalItems.proposalId, crmProposals.id), eq(crmProposalItems.serviceId, input.serviceId)))));
    filters.push(...period(crmProposals.createdAt, crmProposals.companyId, input));
    if (input.validFrom) filters.push(gte(crmProposals.validUntil, input.validFrom));
    if (input.validTo) filters.push(lte(crmProposals.validUntil, input.validTo));
    if (input.search) {
      const q = escapeLike(input.search);
      filters.push(or(ilike(crmProposals.title, q), ilike(crmProposals.recipientName, q), ilike(crmContacts.name, q), sql`('P-' || lpad(${crmProposals.proposalNumber}::text, greatest(6, length(${crmProposals.proposalNumber}::text)), '0')) ilike ${q}`)!);
    }
    return and(...filters);
  }
  private async page(filter: SQL | undefined, input: ProposalList) {
    const db = this.database.db;
    const join = and(eq(crmOpportunities.companyId, crmProposals.companyId), eq(crmOpportunities.id, crmProposals.opportunityId));
    const [items, [summary]] = await Promise.all([
      db.select({ proposal: crmProposals, effectiveStatus: effectiveStatus(proposalZone.timezone), contactName: crmContacts.name, assignedUserId: crmOpportunities.assignedUserId }).from(crmProposals)
        .innerJoin(proposalZone, eq(proposalZone.id, crmProposals.companyId)).innerJoin(crmOpportunities, join).innerJoin(crmContacts, and(eq(crmContacts.companyId, crmProposals.companyId), eq(crmContacts.id, crmProposals.contactId)))
        .where(filter).orderBy(desc(crmProposals.createdAt), desc(crmProposals.id)).limit(input.limit).offset(input.offset),
      db.select({ total: count(), totalAmount: sql<string>`coalesce(sum(${crmProposals.totalAmount}), 0)::text`,
        sent: sql<number>`count(*) filter (where ${effectiveStatus(proposalZone.timezone)} = 'SENT')::integer`, expired: sql<number>`count(*) filter (where ${effectiveStatus(proposalZone.timezone)} = 'EXPIRED')::integer`,
        accepted: sql<number>`count(*) filter (where ${effectiveStatus(proposalZone.timezone)} = 'ACCEPTED')::integer`, converted: sql<number>`count(*) filter (where ${effectiveStatus(proposalZone.timezone)} = 'CONVERTED')::integer` })
        .from(crmProposals).innerJoin(proposalZone, eq(proposalZone.id, crmProposals.companyId)).innerJoin(crmOpportunities, join).innerJoin(crmContacts, and(eq(crmContacts.companyId, crmProposals.companyId), eq(crmContacts.id, crmProposals.contactId))).where(filter),
    ]);
    return { items: items.map(({ proposal: { issuedSnapshot: _s, issuedHash: _h, ...p }, ...rest }) => ({ ...p, ...rest, proposalCode: proposalCode(p.proposalNumber) })), total: summary.total, summary, limit: input.limit, offset: input.offset };
  }
  async prefill(ctx: CrmContext, input: ProposalPrefill) {
    const db = this.database.db, a = await this.policy.access(ctx);
    if (!input.opportunityId) {
      if (input.contactId) {
        const contact = await this.policy.contact(a, input.contactId);
        const opportunities = await db.select().from(crmOpportunities).where(and(this.policy.opportunityScope(a), eq(crmOpportunities.contactId, contact.id), isNull(crmOpportunities.archivedAt))).orderBy(desc(crmOpportunities.createdAt));
        return { contact, opportunities, requiresOpportunitySelection: true };
      }
      const [customer] = await db.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, input.customerId!))).limit(1);
      if (!customer) throw new NotFoundException('Cliente não encontrado');
      const opportunities = await db.select({ opportunity: crmOpportunities }).from(crmOpportunities).innerJoin(crmContacts, and(eq(crmContacts.companyId, crmOpportunities.companyId), eq(crmContacts.id, crmOpportunities.contactId)))
        .where(and(this.policy.opportunityScope(a), eq(crmContacts.customerId, customer.id), isNull(crmOpportunities.archivedAt), isNull(crmContacts.archivedAt))).orderBy(desc(crmOpportunities.createdAt));
      const contacts = await db.select({ id: crmContacts.id, name: crmContacts.name }).from(crmContacts).where(and(this.policy.contactScope(a), eq(crmContacts.customerId, customer.id), isNull(crmContacts.archivedAt)));
      return { customer, contacts, opportunities: opportunities.map(r => r.opportunity), requiresOpportunityCreation: !opportunities.length };
    }
    const opportunity = await this.policy.opportunity(a, input.opportunityId), contact = await this.policy.contact(a, opportunity.contactId);
    const [customer] = contact.customerId ? await db.select().from(customers).where(and(eq(customers.companyId, a.companyId), eq(customers.id, contact.customerId))).limit(1) : [];
    const [service] = opportunity.primaryServiceId ? await db.select().from(services).where(and(eq(services.companyId, a.companyId), eq(services.id, opportunity.primaryServiceId), eq(services.status, 'ACTIVE'))).limit(1) : [];
    const [entry] = await db.select({ description: crmLeadEntries.interestDescription }).from(crmLeadEntries).where(and(eq(crmLeadEntries.companyId, a.companyId), eq(crmLeadEntries.id, opportunity.originEntryId))).limit(1);
    const candidates = !customer ? await db.select({ id: customers.id, name: customers.name, kind: customers.kind, taxId: customers.taxId, status: customers.status }).from(customers).where(and(eq(customers.companyId, a.companyId), or(
      eq(customers.name, contact.name), ...(contact.taxId ? [eq(customers.taxId, contact.taxId)] : []), ...(contact.email ? [eq(customers.email, contact.email)] : []), ...(contact.phone ? [eq(customers.phone, contact.phone)] : [])))).limit(20) : [];
    return { contact, opportunity, customer: customer ?? null, customerCandidates: candidates,
      customerDraft: { kind: contact.taxIdKind, name: contact.taxIdKind === 'PJ' ? contact.organizationName ?? contact.name : contact.name, taxId: contact.taxId, email: contact.email, phone: contact.phone },
      service: service ?? null, interestDescription: entry?.description ?? null,
      suggestedItems: service ? [{ serviceId: service.id, quantity: '1.0000', unitPrice: service.suggestedUnitPrice, discountType: 'AMOUNT', discountInput: '0.00' }] : [],
      requiresCustomerDetails: !customer && !contact.taxIdKind, requiresServiceSelection: !service };
  }
}
