import { z } from 'zod';

const date = z.iso.date();
const rate = (max: number) => z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,4})?$/).refine(value => Number(value) <= max).nullable();
const numberString = z.string().regex(/^[1-9]\d{0,14}$/).refine(value => BigInt(value) <= 999999999999999n);
const taxFields = {
  issRatePercent: rate(5),
  pisRatePercent: rate(100),
  cofinsRatePercent: rate(100),
  csllRatePercent: rate(100),
  irRatePercent: rate(100),
  inssRatePercent: rate(100),
  issWithholdingSuggestion: z.boolean().nullable(),
  notes: z.string().trim().max(2000).nullable(),
};
const hasTax = (value: Record<string, unknown>) =>
  Object.keys(taxFields).some(key => key !== 'notes' && value[key] !== null);
const taxRevision = z.strictObject({ effectiveFrom: date, ...taxFields }).refine(hasTax, 'Informe ao menos uma sugestão tributária');

export const fiscalIdSchema = z.uuid();
export const seriesQuerySchema = z.strictObject({ environment: z.enum(['HOMOLOGATION', 'PRODUCTION']).optional() });
export const createSeriesSchema = z.strictObject({
  environment: z.enum(['HOMOLOGATION', 'PRODUCTION']),
  seriesNumber: z.number().int().min(1).max(49999),
  nextNumber: numberString,
  isDefault: z.boolean().default(false),
});
export const updateSeriesSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  isDefault: z.boolean().optional(),
});
export const advanceSeriesSchema = z.strictObject({
  expectedVersion: z.number().int().positive(), nextNumber: numberString,
  reason: z.string().trim().min(5).max(500),
});
export const createTaxProfileSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  scope: z.enum(['COMPANY', 'SERVICE', 'SERVICE_MUNICIPALITY']),
  serviceId: z.uuid().nullable(),
  municipalityIbgeCode: z.string().regex(/^\d{7}$/).nullable(),
  isDefault: z.boolean().default(true),
  revision: taxRevision,
}).superRefine((value, ctx) => {
  if ((value.scope === 'COMPANY' && (value.serviceId || value.municipalityIbgeCode)) ||
    (value.scope === 'SERVICE' && (!value.serviceId || value.municipalityIbgeCode)) ||
    (value.scope === 'SERVICE_MUNICIPALITY' && (!value.serviceId || !value.municipalityIbgeCode))) {
    ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Serviço e município não correspondem ao alcance da regra' });
  }
});
export const updateTaxProfileSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(160).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  isDefault: z.boolean().optional(),
});
export const addTaxRevisionSchema = z.strictObject({ effectiveFrom: date, ...taxFields, expectedVersion: z.number().int().positive() }).refine(hasTax, 'Informe ao menos uma sugestão tributária');
export const previewTaxSchema = z.strictObject({
  items: z.array(z.strictObject({ serviceId: z.uuid(), taxProfileId: z.uuid().nullable().optional() })).min(1).max(100),
  competence: date,
  municipalityIbgeCode: z.string().regex(/^\d{7}$/).nullable().optional(),
});

export type CreateSeriesInput = z.output<typeof createSeriesSchema>;
export type UpdateSeriesInput = z.output<typeof updateSeriesSchema>;
export type AdvanceSeriesInput = z.output<typeof advanceSeriesSchema>;
export type CreateTaxProfileInput = z.output<typeof createTaxProfileSchema>;
export type UpdateTaxProfileInput = z.output<typeof updateTaxProfileSchema>;
export type AddTaxRevisionInput = z.output<typeof addTaxRevisionSchema>;
