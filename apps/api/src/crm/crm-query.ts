import { crmContacts, crmLeadEntries, crmOpportunities } from '@gestaonf/database/schema';
import { and, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { CrmAccess } from './crm-policy.service.js';
import type { ListInput } from './crm.schemas.js';
import { escapeLike } from './crm-normalization.js';

export function contactFilters(a: CrmAccess, input: ListInput) {
  const filters: SQL[] = [];
  if (!input.includeArchived) filters.push(isNull(crmContacts.archivedAt));
  if (input.contactId) filters.push(eq(crmContacts.id, input.contactId));
  if (input.search) {
    const pattern = escapeLike(input.search);
    filters.push(or(ilike(crmContacts.name, pattern), ilike(crmContacts.organizationName, pattern), ilike(crmContacts.email, pattern),
      ilike(crmContacts.phone, pattern), ilike(crmContacts.phoneKey, escapeLike(input.search.replace(/\D/g, '') || input.search)),
      ilike(crmContacts.taxId, escapeLike(input.search.replace(/[.\-/\s]/g, '').toUpperCase())))!);
  }
  if (input.periodBy === 'CONTACT_CREATED') filters.push(...period(crmContacts.createdAt, a, input));
  return filters;
}
export function period(column: SQL | typeof crmContacts.createdAt | typeof crmLeadEntries.receivedAt, a: CrmAccess, input: ListInput) {
  const filters: SQL[] = [];
  if (input.from) filters.push(sql`${column} >= (${input.from}::date::timestamp AT TIME ZONE ${a.timezone})`);
  if (input.to) filters.push(sql`${column} < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${a.timezone})`);
  return filters;
}
export function negotiationFilters(a: CrmAccess, input: ListInput) {
  const filters: SQL[] = [];
  if (!input.includeArchived) filters.push(isNull(crmOpportunities.archivedAt));
  if (input.assignedUserId) filters.push(eq(crmOpportunities.assignedUserId, input.assignedUserId));
  if (input.pipelineId) filters.push(eq(crmOpportunities.pipelineId, input.pipelineId));
  if (input.stageId) filters.push(eq(crmOpportunities.stageId, input.stageId));
  if (input.status) filters.push(eq(crmOpportunities.commercialStatus, input.status));
  if (input.primaryServiceId) filters.push(eq(crmOpportunities.primaryServiceId, input.primaryServiceId));
  if (input.captureKind) filters.push(eq(crmLeadEntries.captureKind, input.captureKind));
  if (input.sourceFormReference) filters.push(eq(crmLeadEntries.sourceFormReference, input.sourceFormReference));
  for (const field of ['sourceLabel', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm'] as const) {
    if (input[field]) filters.push(sql`lower(btrim(${crmLeadEntries[field]})) = ${input[field]!.toLowerCase()}`);
  }
  if (input.missingField) filters.push(isNull(crmLeadEntries[input.missingField]));
  if (input.periodBy === 'ENTRY_RECEIVED') filters.push(...period(crmLeadEntries.receivedAt, a, input));
  return filters;
}
export const contactJoin = and(eq(crmContacts.companyId, crmOpportunities.companyId), eq(crmContacts.id, crmOpportunities.contactId));
export const entryJoin = and(eq(crmLeadEntries.companyId, crmOpportunities.companyId), eq(crmLeadEntries.contactId, crmOpportunities.contactId), eq(crmLeadEntries.id, crmOpportunities.originEntryId));
export function needsNegotiation(input: ListInput) {
  return !!(input.assignedUserId || input.pipelineId || input.stageId || input.status || input.primaryServiceId || input.captureKind || input.sourceLabel || input.sourceFormReference || input.utmSource || input.utmMedium || input.utmCampaign || input.utmContent || input.utmTerm || input.missingField || (input.periodBy === 'ENTRY_RECEIVED' && (input.from || input.to)));
}
export function publicEntry(entry: typeof crmLeadEntries.$inferSelect) {
  const { commandNamespace: _namespace, idempotencyKey: _key, requestHash: _hash, ...data } = entry;
  return data;
}

