import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const nullableCode = (length: number) => z.string().regex(new RegExp(`^[0-9]{${length}}$`)).nullable();
const price = z.string().regex(/^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/).nullable();

const fields = {
  internalCode: nullableText(20),
  name: z.string().trim().min(1).max(200),
  description: nullableText(1000),
  unitLabel: z.string().trim().min(1).max(16),
  suggestedUnitPrice: price,
  nationalTaxCode: nullableCode(6),
  nbsCode: nullableCode(9),
  status: z.enum(['ACTIVE', 'INACTIVE']),
};

export const createServiceSchema = z.strictObject(fields).partial().required({ name: true });
export const updateServiceSchema = z.strictObject(fields).partial()
  .refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
export const listServicesSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
  search: z.string().trim().min(1).max(100).optional(),
});
export const serviceIdSchema = z.uuid();
export const municipalityIbgeCodeSchema = z.string().regex(/^\d{7}$/);
export const upsertMunicipalTaxCodeSchema = z.strictObject({
  municipalTaxCode: z.string().regex(/^\d{3}$/),
});
