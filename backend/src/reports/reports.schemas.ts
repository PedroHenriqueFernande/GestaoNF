import { z } from 'zod';
import { dateSchema } from '../crm/crm.schemas.js';

export const reportTypes = ['closed-services', 'service-receipts', 'lead-entries', 'customers', 'service-catalog', 'meetings', 'disqualification-rate', 'loss-rate'] as const;
export const reportTypeSchema = z.enum(reportTypes);
export type ReportType = z.infer<typeof reportTypeSchema>;
export type CatalogReport = 'customers' | 'service-catalog';
const fields = {
  from: dateSchema.optional(), to: dateSchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  customerId: z.uuid().optional(), serviceId: z.uuid().optional(), assignedUserId: z.uuid().optional(),
  status: z.enum(['ALL', 'ACTIVE', 'INACTIVE', 'SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW']).default('ALL'),
  captureKind: z.enum(['MANUAL', 'FORM', 'META_ADS', 'GOOGLE_ADS', 'IMPORT', 'NERO', 'API']).optional(),
  utmSource: z.string().trim().min(1).max(200).optional(), utmCampaign: z.string().trim().min(1).max(200).optional(),
  sourceFormReference: z.string().trim().min(1).max(200).optional(),
  paymentMethod: z.enum(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25), cursor: z.string().min(1).max(1024).optional(),
};
export const reportFiltersSchema = z.strictObject(fields).superRefine((input, ctx) => {
  if (!!input.from !== !!input.to) ctx.addIssue({ code: 'custom', message: 'Informe as duas datas do período', path: ['to'] });
  if (input.from && input.to) {
    const span = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
    if (span < 0 || span >= 366) ctx.addIssue({ code: 'custom', message: 'Escolha um período de até 366 dias, com início anterior ao fim', path: ['to'] });
  }
});
export type ReportInput = z.output<typeof reportFiltersSchema>;
export const reportOptionsSchema = z.strictObject({
  field: z.enum(['customerId', 'serviceId', 'assignedUserId']),
  search: z.string().trim().max(100).default(''), limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const reportCursorSchema = z.strictObject({ sort: z.union([dateSchema,z.iso.datetime({offset:true}).max(40)]), id: z.uuid(), hash: z.string().regex(/^[a-f0-9]{64}$/) });
