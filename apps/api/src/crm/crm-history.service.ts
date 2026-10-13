import { Inject, Injectable } from '@nestjs/common';
import { crmActivities, crmLeadEntries, crmOpportunities } from '@gestaonf/database/schema';
import { and, count, desc, eq, exists, isNull, or } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { CrmPolicyService } from './crm-policy.service.js';
import type { CrmAccess } from './crm-policy.service.js';
import type { CrmTx } from './crm-normalization.js';
import type { CrmContext, PageInput } from './crm.schemas.js';

@Injectable()
export class CrmHistoryService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CrmPolicyService) private readonly policy: CrmPolicyService) {}
  record(tx: CrmTx, a: CrmAccess, data: Omit<typeof crmActivities.$inferInsert, 'companyId' | 'actorType' | 'actorUserId'>) {
    return tx.insert(crmActivities).values({ ...data, companyId: a.companyId, actorType: 'USER', actorUserId: a.userId }).returning();
  }
  async list(ctx: CrmContext, contactId: string, input: PageInput) {
    const db = this.database.db, a = await this.policy.access(ctx);
    await this.policy.contact(a, contactId);
    const visibleOpportunity = exists(db.select({ id: crmOpportunities.id }).from(crmOpportunities).where(and(this.policy.opportunityScope(a), eq(crmOpportunities.id, crmActivities.opportunityId))));
    const visibleEntry = exists(db.select({ id: crmLeadEntries.id }).from(crmLeadEntries).where(and(this.policy.entryScope(a), eq(crmLeadEntries.id, crmActivities.entryId))));
    const filter = and(eq(crmActivities.companyId, a.companyId), eq(crmActivities.contactId, contactId), or(isNull(crmActivities.opportunityId), visibleOpportunity), or(isNull(crmActivities.entryId), visibleEntry));
    const [items, [total]] = await Promise.all([
      db.select().from(crmActivities).where(filter).orderBy(desc(crmActivities.recordedAt), desc(crmActivities.id)).limit(input.limit).offset(input.offset),
      db.select({ value: count() }).from(crmActivities).where(filter),
    ]);
    return { items, total: total.value, ...input };
  }
}
