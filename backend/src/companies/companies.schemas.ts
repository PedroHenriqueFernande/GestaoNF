import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const fields = {
  legalName: nullableText(200),
  // Nome fantasia: obrigatório e usado como nome exibido da empresa.
  tradeName: z.string().trim().min(1).max(200),
  // Só pessoa jurídica: o tipo (kind) é sempre PJ e não vem da API.
  taxId: z.string().trim().transform((value) => value.replace(/[.\-/\s]/g, '').toUpperCase())
    .pipe(z.string().regex(/^[A-Z0-9]{12}\d{2}$/, 'Informe um CNPJ válido.')).nullable(),
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
  // Fora da API: stateRegistration (inscrição estadual, guardada para a futura NF-e/NFC-e), cnaeCode (a NFS-e não usa) e caepfCode (só pessoa física).
  // simplesTaxationRegime e specialTaxRegime são definidos pelo backend (ver fiscal/simples-regime.ts).
  simplesNationalOption: z.enum(['1', '2', '3', '4']).nullable(),
  simplesIbsCbsRegime: z.enum(['1', '2', '3']).nullable(),
};

export const createCompanySchema = z.strictObject({ ...fields, accountId: z.uuid() }).partial().required({ tradeName: true });
export const updateCompanySchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
