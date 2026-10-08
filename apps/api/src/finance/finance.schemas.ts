import { z } from 'zod';

const date = z.iso.date();
const filters = {
  customerId: z.uuid().optional(),
  search: z.string().trim().min(1).max(100).optional(),
  orderCode: z.string().regex(/^[0-9]{5}$/).optional(),
  paycode: z.string().regex(/^[0-9]{4}$/).optional(),
  workOrderNumber: z.string().trim().min(1).max(40).optional(),
  dateFrom: date.optional(),
  dateTo: date.optional(),
  dateBasis: z.enum(['SALE', 'DUE', 'RECEIPT']).default('SALE'),
  settlement: z.enum(['ALL', 'PENDING', 'PARTIAL', 'PAID']).default('ALL'),
  overdue: z.enum(['ALL', 'ONLY', 'EXCLUDE']).default('ALL'),
  paymentMethod: z.enum(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER']).optional(),
};

export const financeFiltersSchema = z.strictObject(filters).refine(
  (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: 'A data inicial deve ser anterior à data final', path: ['dateTo'] },
);

export const financeListSchema = z.strictObject({
  ...filters,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
}).refine(
  (value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo,
  { message: 'A data inicial deve ser anterior à data final', path: ['dateTo'] },
);

export const financeSaleIdSchema = z.uuid();
export const financeDateUpdateSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  soldOn: date,
  dueOn: date.nullable(),
});
export type FinanceFilters = z.output<typeof financeFiltersSchema>;
export type FinanceListInput = z.output<typeof financeListSchema>;
export type FinanceDateUpdateInput = z.output<typeof financeDateUpdateSchema>;
