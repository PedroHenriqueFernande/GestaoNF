import { z } from 'zod';

const text = (max: number) => z.string().max(max).transform((v) => v.trim() || null).nullable();
const email = z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable();
const taxId = z.string().trim().transform((v) => v.replace(/[.\-/\s]/g, '').toUpperCase())
  .pipe(z.string().regex(/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/)).nullable();
export const idSchema = z.uuid();
export const keySchema = z.string().trim().min(1).max(128);
export const statuses = ['NEW', 'CONTACTING', 'QUALIFIED', 'DISQUALIFIED', 'LOST', 'WON'] as const;
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
}, 'Data inválida');
const money = z.string().regex(/^(?:0|[1-9]\d{0,12})\.\d{2}$/).nullable();
const version = z.number().int().min(1);
const profile = {
  name: z.string().trim().min(1).max(200), organizationName: text(200),
  email, phone: text(64), taxId, taxIdKind: z.enum(['PF', 'PJ']).nullable(), notes: text(10000),
  assignedUserId: idSchema.nullable(),
};
export const leadSchema = z.strictObject(profile).partial().required({ name: true });
const interestSchema = z.strictObject({
  description: text(2000).optional(), primaryServiceId: idSchema.nullable().optional(),
  estimatedAmount: money.optional(), expectedCloseOn: dateSchema.nullable().optional(),
});
const captureSchema = z.strictObject({
  sourceLabel: text(120).optional(), utmSource: text(200).optional(), utmMedium: text(200).optional(),
  utmCampaign: text(200).optional(), utmContent: text(200).optional(), utmTerm: text(200).optional(),
});
const entryFields = {
  interest: interestSchema.default({}), capture: captureSchema.default({}),
  pipelineId: idSchema.optional(), title: z.string().trim().min(1).max(200).optional(),
  assignedUserId: idSchema.nullable().optional(),
};
export const createLeadSchema = z.strictObject({ lead: leadSchema, ...entryFields });
export const createEntrySchema = z.strictObject(entryFields);
const nonemptyPatch = (v: object) => Object.keys(v).some((k) => k !== 'expectedVersion');
export const updateLeadSchema = z.strictObject({ ...profile, expectedVersion: version }).partial()
  .required({ expectedVersion: true }).refine(nonemptyPatch, 'Informe ao menos um campo');
export const updateOpportunitySchema = z.strictObject({
  expectedVersion: version, title: z.string().trim().min(1).max(200).optional(),
  primaryServiceId: idSchema.nullable().optional(), estimatedAmount: money.optional(),
  expectedCloseOn: dateSchema.nullable().optional(), assignedUserId: idSchema.nullable().optional(),
}).refine(nonemptyPatch, 'Informe ao menos um campo');
export const statusSchema = z.strictObject({
  expectedVersion: version, status: z.enum(statuses), reasonCode: text(40).optional(), reasonText: text(1000).optional(),
}).refine((v) => ['LOST', 'DISQUALIFIED'].includes(v.status) || (!v.reasonCode && !v.reasonText), 'Motivo permitido somente em perda ou desqualificação');
export const stageSchema = z.strictObject({ expectedVersion: version, stageId: idSchema });
export const versionSchema = z.strictObject({ expectedVersion: version });
export const customerLinkSchema = z.strictObject({ expectedVersion: version, customerId: idSchema.nullable() });
export const noteSchema = z.strictObject({ note: z.string().trim().min(1).max(10000), opportunityId: idSchema.optional() });
export const candidatesSchema = z.strictObject({ email: email.optional(), phone: text(64).optional(), taxId: taxId.optional() })
  .refine((v) => !!(v.email || v.phone || v.taxId), 'Informe e-mail, telefone ou documento');
export const pageFields = { limit: z.coerce.number().int().min(1).max(100).default(20), offset: z.coerce.number().int().min(0).default(0) };
export const pageSchema = z.strictObject(pageFields);
export const listSchema = z.strictObject({
  ...pageFields, search: z.string().trim().min(1).max(200).optional(),
  includeArchived: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  contactId: idSchema.optional(), assignedUserId: idSchema.optional(), pipelineId: idSchema.optional(), stageId: idSchema.optional(),
  status: z.enum(statuses).optional(), primaryServiceId: idSchema.optional(),
  captureKind: z.enum(['MANUAL', 'FORM', 'META_ADS', 'GOOGLE_ADS', 'IMPORT', 'NERO', 'API']).optional(),
  sourceLabel: z.string().trim().min(1).max(120).optional(), sourceFormReference: z.string().trim().min(1).max(200).optional(),
  utmSource: z.string().trim().min(1).max(200).optional(), utmMedium: z.string().trim().min(1).max(200).optional(),
  utmCampaign: z.string().trim().min(1).max(200).optional(), utmContent: z.string().trim().min(1).max(200).optional(), utmTerm: z.string().trim().min(1).max(200).optional(),
  missingField: z.enum(['sourceLabel', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm', 'sourceFormReference']).optional(),
  from: dateSchema.optional(), to: dateSchema.optional(), periodBy: z.enum(['ENTRY_RECEIVED', 'CONTACT_CREATED']).default('ENTRY_RECEIVED'),
}).refine((v) => !v.from || !v.to || v.from <= v.to, 'Período invertido');
export const captureOptionsSchema = z.strictObject({
  ...pageFields, field: z.enum(['sourceLabel', 'utmSource', 'utmMedium', 'utmCampaign', 'utmContent', 'utmTerm']).default('utmCampaign'),
  search: z.string().trim().min(1).max(200).optional(),
});
export type CrmContext = { companyId: string; userId: string };
export type CreateLead = z.output<typeof createLeadSchema>;
export type CreateEntry = z.output<typeof createEntrySchema>;
export type ListInput = z.output<typeof listSchema>;
export type PageInput = z.output<typeof pageSchema>;

