import { companies, crmContacts, crmLeadEntries, crmOpportunities, services } from '@gestaonf/database/schema';
import { and, eq, ilike, inArray, isNull, or, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { ListInput } from './crm.schemas.js';
import { escapeLike } from './crm-normalization.js';

/** A mesma condição serve à listagem por empresa e à consolidada. */
export const inCompanies = (column: AnyColumn, companyIds: readonly string[]) =>
  companyIds.length === 1 ? eq(column, companyIds[0]) : inArray(column, [...companyIds]);

const zone = alias(companies, 'crm_zone');
/** Condição no fuso da empresa do registro. O EXISTS sobre a PK vira junção: sem SubPlan por linha e com a data no Index Cond (Tarefas 14.10 e 14.11). */
export const inCompanyZone = (companyColumn: AnyColumn, condition: (timezone: AnyColumn) => SQL) =>
  sql`exists (select 1 from ${companies} ${sql.identifier('crm_zone')} where ${zone.id} = ${companyColumn} and ${condition(zone.timezone)})`;

export function contactFilters(input: ListInput) {
  const filters: SQL[] = [];
  if (!input.includeArchived) filters.push(isNull(crmContacts.archivedAt));
  if (input.contactId) filters.push(eq(crmContacts.id, input.contactId));
  if (input.search) {
    const pattern = escapeLike(input.search);
    filters.push(or(ilike(crmContacts.name, pattern), ilike(crmContacts.organizationName, pattern), ilike(crmContacts.email, pattern),
      ilike(crmContacts.phone, pattern), ilike(crmContacts.phoneKey, escapeLike(input.search.replace(/\D/g, '') || input.search)),
      ilike(crmContacts.taxId, escapeLike(input.search.replace(/[.\-/\s]/g, '').toUpperCase())))!);
  }
  if (input.periodBy === 'CONTACT_CREATED') filters.push(...period(crmContacts.createdAt, crmContacts.companyId, input));
  return filters;
}
/** Período no fuso da empresa de cada registro. */
export function period(column: AnyColumn, companyColumn: AnyColumn, input: Pick<ListInput, 'from' | 'to'>): SQL[] {
  if (!input.from && !input.to) return [];
  return [inCompanyZone(companyColumn, timezone => {
    const bounds: SQL[] = [];
    if (input.from) bounds.push(sql`${column} >= (${input.from}::date::timestamp AT TIME ZONE ${timezone})`);
    if (input.to) bounds.push(sql`${column} < ((${input.to}::date + 1)::timestamp AT TIME ZONE ${timezone})`);
    return and(...bounds)!;
  })];
}
export function negotiationFilters(input: ListInput) {
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
  if (input.periodBy === 'ENTRY_RECEIVED') filters.push(...period(crmLeadEntries.receivedAt, crmLeadEntries.companyId, input));
  return filters;
}
export const contactJoin = and(eq(crmContacts.companyId, crmOpportunities.companyId), eq(crmContacts.id, crmOpportunities.contactId));
export const entryJoin = and(eq(crmLeadEntries.companyId, crmOpportunities.companyId), eq(crmLeadEntries.contactId, crmOpportunities.contactId), eq(crmLeadEntries.id, crmOpportunities.originEntryId));
export const servicePriceJoin = (priceCompanyIds: readonly string[]) => and(
  eq(services.companyId, crmOpportunities.companyId),
  eq(services.id, crmOpportunities.primaryServiceId),
  inCompanies(services.companyId, priceCompanyIds),
);
export const servicePriceSummary = {
  knownAmounts: sql<number>`count(${services.suggestedUnitPrice})::integer`,
  servicePriceTotal: sql<string>`coalesce(sum(${services.suggestedUnitPrice}), 0.00)::text`,
};
export function needsNegotiation(input: ListInput) {
  return !!(input.assignedUserId || input.pipelineId || input.stageId || input.status || input.primaryServiceId || input.captureKind || input.sourceLabel || input.sourceFormReference || input.utmSource || input.utmMedium || input.utmCampaign || input.utmContent || input.utmTerm || input.missingField || (input.periodBy === 'ENTRY_RECEIVED' && (input.from || input.to)));
}
export function publicEntry(entry: typeof crmLeadEntries.$inferSelect) {
  const { commandNamespace: _namespace, idempotencyKey: _key, requestHash: _hash, ...data } = entry;
  return data;
}

