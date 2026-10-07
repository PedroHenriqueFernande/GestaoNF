import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const fields = {
  name: z.string().trim().min(1).max(200),
  kind: z.enum(['PF', 'PJ']),
  legalName: nullableText(200),
  tradeName: nullableText(200),
  taxId: z.string().trim().transform((value) => value.replace(/[.\-/\s]/g, '').toUpperCase())
    .pipe(z.string().regex(/^(?:\d{11}|[A-Z0-9]{12}\d{2})$/)).nullable(),
  email: z.email().max(254).nullable(),
  phone: nullableText(32),
  street: nullableText(200),
  number: nullableText(30),
  complement: nullableText(100),
  district: nullableText(120),
  postalCode: z.string().transform((value) => value.replace(/[\s-]/g, '')).pipe(z.string().regex(/^\d{8}$/)).nullable(),
  cityName: nullableText(150),
  cityIbgeCode: z.string().regex(/^\d{7}$/).nullable(),
  stateCode: z.string().toUpperCase().regex(/^[A-Z]{2}$/).nullable(),
  countryCode: z.string().toUpperCase().regex(/^[A-Z]{2}$/),
  municipalRegistration: nullableText(30),
  stateRegistration: nullableText(30),
  cnaeCode: z.string().transform((value) => value.replace(/[.\-/\s]/g, '')).pipe(z.string().regex(/^\d{7}$/)).nullable(),
  simplesNationalOption: z.enum(['1', '2', '3', '4']).nullable(),
  simplesTaxationRegime: z.enum(['1', '2', '3']).nullable(),
  specialTaxRegime: z.enum(['0', '1', '2', '3', '4', '5', '6']).nullable(),
};

export const createCompanySchema = z.strictObject(fields).partial().required({ name: true });
export const updateCompanySchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
