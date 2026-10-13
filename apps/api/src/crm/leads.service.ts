import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { crmContacts, crmLeadEntries, crmOpportunities, crmActivities, customers } from '@gestaonf/database/schema';
import { and, asc, count, desc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService } from './crm-policy.service.js';
import { CrmHistoryService } from './crm-history.service.js';
import { changedFields, commandHash, expectVersion, lockKeys, phoneKey, terminal, validateDocument } from './crm-normalization.js';
import { contactFilters, negotiationFilters, needsNegotiation, entryJoin, publicEntry } from './crm-query.js';
import { candidatesSchema, captureOptionsSchema, customerLinkSchema, keySchema, noteSchema, updateLeadSchema, type CrmContext, type ListInput, type PageInput } from './crm.schemas.js';
import { escapeLike } from './crm-normalization.js';
import { parseInput } from '../common/validate.js';

@Injectable()
export class LeadsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CrmPolicyService) private readonly policy: CrmPolicyService,
    @Inject(CrmHistoryService) private readonly history: CrmHistoryService) {}
  async list(ctx: CrmContext, input: ListInput) {
    const db = this.database.db, a = await this.policy.access(ctx);
    const filter = and(this.policy.contactScope(a), ...contactFilters(a, input), ...(needsNegotiation(input) ? [exists(db.select({ id: crmOpportunities.id }).from(crmOpportunities).innerJoin(crmLeadEntries, entryJoin).where(and(this.policy.opportunityScope(a), eq(crmOpportunities.contactId, crmContacts.id), ...negotiationFilters(a, input))))] : []));
    const [items, [total]] = await Promise.all([
      db.select().from(crmContacts).where(filter).orderBy(desc(crmContacts.createdAt), desc(crmContacts.id)).limit(input.limit).offset(input.offset),
      db.select({ value: count() }).from(crmContacts).where(filter),
    ]);
    return { items, total: total.value, limit: input.limit, offset: input.offset };
  }
  async get(ctx: CrmContext, id: string) {
    const db = this.database.db, a = await this.policy.access(ctx), contact = await this.policy.contact(a, id);
    const [[summary], [firstEntry]] = await Promise.all([
      db.select({ opportunities: count(), knownAmounts: sql<number>`count(${crmOpportunities.estimatedAmount})::integer`, estimatedAmount: sql<string>`coalesce(sum(${crmOpportunities.estimatedAmount}), 0.00)::text` }).from(crmOpportunities)
        .where(and(this.policy.opportunityScope(a), eq(crmOpportunities.contactId, id), isNull(crmOpportunities.archivedAt))),
      db.select().from(crmLeadEntries).where(and(this.policy.entryScope(a), eq(crmLeadEntries.contactId, id))).orderBy(asc(crmLeadEntries.receivedAt), asc(crmLeadEntries.id)).limit(1),
    ]);
    return { ...contact, summary, firstVisibleEntry: firstEntry ? publicEntry(firstEntry) : null, visibility: a.manager ? 'COMPANY' : 'ASSIGNED' };
  }
  async entries(ctx: CrmContext, id: string, input: PageInput) {
    const db = this.database.db, a = await this.policy.access(ctx);
    await this.policy.contact(a, id);
    const filter = and(this.policy.entryScope(a), eq(crmLeadEntries.contactId, id));
    const [items, [total]] = await Promise.all([
      db.select().from(crmLeadEntries).where(filter).orderBy(desc(crmLeadEntries.receivedAt), desc(crmLeadEntries.id)).limit(input.limit).offset(input.offset),
      db.select({ value: count() }).from(crmLeadEntries).where(filter),
    ]);
    return { items: items.map(publicEntry), total: total.value, ...input };
  }
  async update(ctx: CrmContext, id: string, input: z.output<typeof updateLeadSchema>) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx), old = await this.policy.contact(a, id, tx, true);
      this.policy.editContact(a, old); this.policy.activeContact(old); expectVersion(old.version, input.expectedVersion);
      const { expectedVersion: _version, ...patch } = input;
      if (patch.assignedUserId !== undefined) await this.policy.assignee(a, patch.assignedUserId, tx, true);
      validateDocument({ taxId: patch.taxId === undefined ? old.taxId : patch.taxId, taxIdKind: patch.taxIdKind === undefined ? old.taxIdKind : patch.taxIdKind });
      const changes = changedFields(old, patch);
      if (!Object.keys(changes).length) return old;
      const [row] = await tx.update(crmContacts).set({ ...patch, ...(patch.phone !== undefined ? { phoneKey: phoneKey(patch.phone) } : {}), version: old.version + 1, updatedAt: new Date() }).where(and(eq(crmContacts.companyId, ctx.companyId), eq(crmContacts.id, id))).returning();
      await this.history.record(tx, a, { contactId: id, kind: 'CONTACT_UPDATED', changes });
      return row;
    });
  }
  async linkCustomer(ctx: CrmContext, id: string, input: z.output<typeof customerLinkSchema>) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx), old = await this.policy.contact(a, id, tx, true);
      this.policy.editContact(a, old); this.policy.activeContact(old); expectVersion(old.version, input.expectedVersion);
      if (input.customerId) {
        const [customer] = await tx.select({ id: customers.id }).from(customers).where(and(eq(customers.companyId, ctx.companyId), eq(customers.id, input.customerId), eq(customers.status, 'ACTIVE'))).for('share').limit(1);
        if (!customer) throw new BadRequestException('Cliente inválido ou inativo');
      }
      if (input.customerId === old.customerId) return old;
      const [row] = await tx.update(crmContacts).set({ customerId: input.customerId, version: old.version + 1, updatedAt: new Date() }).where(and(eq(crmContacts.companyId, ctx.companyId), eq(crmContacts.id, id))).returning();
      await this.history.record(tx, a, { contactId: id, kind: 'CUSTOMER_LINKED', changes: { customerId: { before: old.customerId, after: input.customerId } } });
      return row;
    });
  }
  async archive(ctx: CrmContext, id: string, expectedVersion: number, restore = false) {
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx); this.policy.requireManager(a);
      const old = await this.policy.contact(a, id, tx, true); expectVersion(old.version, expectedVersion);
      if (restore ? !old.archivedAt : !!old.archivedAt) return old;
      const now = new Date();
      if (!restore) {
        const cards = await tx.select().from(crmOpportunities).where(and(eq(crmOpportunities.companyId, ctx.companyId), eq(crmOpportunities.contactId, id))).orderBy(asc(crmOpportunities.id)).for('update');
        if (cards.some((c) => !c.archivedAt && !terminal(c.commercialStatus))) throw new ConflictException('Trate ou arquive as negociações abertas antes de arquivar o lead');
        for (const card of cards.filter((c) => !c.archivedAt)) {
          await tx.update(crmOpportunities).set({ archivedAt: now, version: card.version + 1, updatedAt: now, lastActivityAt: now }).where(and(eq(crmOpportunities.companyId, ctx.companyId), eq(crmOpportunities.id, card.id)));
          await this.history.record(tx, a, { contactId: id, opportunityId: card.id, kind: 'ARCHIVED', changes: { archivedAt: now.toISOString() } });
        }
      }
      const [row] = await tx.update(crmContacts).set({ archivedAt: restore ? null : now, version: old.version + 1, updatedAt: now }).where(and(eq(crmContacts.companyId, ctx.companyId), eq(crmContacts.id, id))).returning();
      await this.history.record(tx, a, { contactId: id, kind: restore ? 'RESTORED' : 'ARCHIVED', changes: { archivedAt: restore ? null : now.toISOString() } });
      return row;
    });
  }
  async addNote(ctx: CrmContext, id: string, input: z.output<typeof noteSchema>, key: string) {
    key = parseInput(keySchema, key);
    const namespace = `note:${ctx.userId}`, hash = commandHash({ contactId: id, input });
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx);
      await lockKeys(tx, [`crm:note:${ctx.companyId}:${namespace}:${key}`]);
      const contact = await this.policy.contact(a, id, tx, true); this.policy.activeContact(contact);
      const card = input.opportunityId ? await this.policy.opportunity(a, input.opportunityId, tx, true) : null;
      if (card && (card.contactId !== id || card.archivedAt)) throw new BadRequestException('Negociação inválida ou arquivada para este lead');
      const [previous] = await tx.select().from(crmActivities).where(and(eq(crmActivities.companyId, ctx.companyId), eq(crmActivities.commandNamespace, namespace), eq(crmActivities.idempotencyKey, key))).limit(1);
      if (previous) {
        if (previous.requestHash !== hash) throw new ConflictException('Chave reutilizada com dados diferentes');
        return { id: previous.id };
      }
      const [activity] = await this.history.record(tx, a, { contactId: id, opportunityId: card?.id, note: input.note, kind: 'NOTE_ADDED', commandNamespace: namespace, idempotencyKey: key, requestHash: hash });
      if (card) await tx.update(crmOpportunities).set({ lastActivityAt: new Date(), updatedAt: new Date(), version: card.version + 1 }).where(and(eq(crmOpportunities.companyId, ctx.companyId), eq(crmOpportunities.id, card.id)));
      return { id: activity.id };
    });
  }
  async candidates(ctx: CrmContext, input: z.output<typeof candidatesSchema>) {
    const a = await this.policy.access(ctx), key = phoneKey(input.phone);
    const matches = [ ...(input.email ? [eq(crmContacts.email, input.email)] : []), ...(input.taxId ? [eq(crmContacts.taxId, input.taxId)] : []), ...(key ? [eq(crmContacts.phoneKey, key)] : []) ];
    if (!matches.length) return { items: [] };
    const items = await this.database.db.select({ id: crmContacts.id, name: crmContacts.name, email: crmContacts.email, phone: crmContacts.phone, taxId: crmContacts.taxId }).from(crmContacts)
      .where(and(this.policy.contactScope(a), isNull(crmContacts.archivedAt), or(...matches))).orderBy(desc(crmContacts.createdAt), desc(crmContacts.id)).limit(20);
    return { items };
  }
  async captureOptions(ctx: CrmContext, input: z.output<typeof captureOptionsSchema>) {
    const a = await this.policy.access(ctx), db = this.database.db, column = crmLeadEntries[input.field];
    const filter = and(this.policy.entryScope(a), sql`${column} IS NOT NULL`, ...(input.search ? [sql`lower(${column}) like ${escapeLike(input.search.toLowerCase())}`] : []));
    const normalized = sql`lower(btrim(${column}))`;
    const [items, [total]] = await Promise.all([
      db.select({ value: sql<string>`min(${column})`, normalized: sql<string>`${normalized}` }).from(crmLeadEntries).where(filter).groupBy(normalized).orderBy(normalized).limit(input.limit).offset(input.offset),
      db.select({ value: sql<number>`count(distinct ${normalized})::integer` }).from(crmLeadEntries).where(filter),
    ]);
    return { items, total: total.value, limit: input.limit, offset: input.offset };
  }
}
