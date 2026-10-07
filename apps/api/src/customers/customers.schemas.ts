import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const taxId = z.string().trim().transform((value) => value.replace(/[.\-/\s]/g, '').toUpperCase())
  .pipe(z.string().regex(/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/)).nullable();

const fields = {
  kind: z.enum(['PF', 'PJ']),
  name: z.string().trim().min(1).max(200),
  tradeName: nullableText(200),
  taxId,
  email: z.email().max(254).nullable(),
  phone: nullableText(32),
  notes: nullableText(10000),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  street: nullableText(200),
  number: nullableText(30),
  complement: nullableText(100),
  district: nullableText(120),
  postalCode: z.string().transform((value) => value.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{8}$/)).nullable(),
  cityName: nullableText(150),
  cityIbgeCode: z.string().regex(/^\d{7}$/).nullable(),
  stateCode: z.string().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  countryCode: z.string().toUpperCase().regex(/^[A-Z]{2}$/),
};

export const createCustomerSchema = z.strictObject({ ...fields, kind: fields.kind, name: fields.name }).partial()
  .required({ kind: true, name: true });
export const updateCustomerSchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
export const listCustomersSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ALL']).default('ACTIVE'),
  search: z.string().trim().min(1).max(100).optional(),
});
export const customerIdSchema = z.uuid();
