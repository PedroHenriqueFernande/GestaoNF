import { z } from 'zod';

const nullableText = (max: number) => z.string().trim().min(1).max(max).nullable();
const fields = {
  kind: z.enum(['PF', 'PJ']),
  legalName: nullableText(200),
  // Nome fantasia: obrigatório e usado como nome exibido da empresa.
  tradeName: z.string().trim().min(1).max(200),
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
  // stateRegistration (inscrição estadual) desativado: a NFS-e não usa. A coluna e os dados seguem no banco para a futura NF-e/NFC-e.
  cnaeCode: z.string().transform((value) => value.replace(/[.\-/\s]/g, '')).pipe(z.string().regex(/^\d{7}$/)).nullable(),
  simplesNationalOption: z.enum(['1', '2', '3', '4']).nullable(),
  simplesTaxationRegime: z.enum(['1', '2', '3']).nullable(),
  simplesIbsCbsRegime: z.enum(['1', '2', '3']).nullable(),
  caepfCode: z.string().trim().regex(/^\d{14}$/, 'Informe os 14 dígitos do registro de atividade da pessoa física.').nullable(),
  specialTaxRegime: z.enum(['0', '1', '2', '3', '4', '5', '6', '9']).nullable(),
};

export const createCompanySchema = z.strictObject({ ...fields, accountId: z.uuid() }).partial().required({ tradeName: true });
export const updateCompanySchema = z.strictObject(fields).partial().refine((value) => Object.keys(value).length > 0, 'Informe ao menos um campo');
