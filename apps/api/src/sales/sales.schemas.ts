import { z } from 'zod';

const date = z.iso.date();
const money = z.string().regex(/^(?:0|[1-9]\d{0,12})\.\d{2}$/, 'Use valor com duas casas decimais');
const positiveMoney = money.refine((value) => value !== '0.00', 'O valor deve ser maior que zero');
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{4}$/).refine((value) => value !== '0.0000');
const method = z.enum(['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BOLETO', 'TRANSFER', 'OTHER']);
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();

const item = z.strictObject({
  serviceId: z.uuid(),
  quantity,
  unitPrice: money,
  discountAmount: money.default('0.00'),
  description: optionalText(1000),
  performedOn: date.nullable().optional(),
});

const installmentFields = {
  paymentMethod: method,
  amount: positiveMoney,
};
const installment = z.union([
  z.strictObject({ ...installmentFields, dueOn: date }),
  z.strictObject({ ...installmentFields, receivedOn: date }),
]);

const saleFields = {
  customerId: z.uuid(),
  soldOn: date.nullable().optional(),
  workOrderNumber: optionalText(40),
  notes: optionalText(2000),
  items: z.array(item).max(100).default([]),
  installments: z.array(installment).max(100).default([]),
};

export const createSaleSchema = z.strictObject(saleFields);
export const updateSaleSchema = z.strictObject({ ...saleFields, expectedVersion: z.number().int().positive() });
const confirmedInstallment = z.union([
  z.strictObject({ ...installmentFields, id: z.uuid().optional(), dueOn: date }),
  z.strictObject({ ...installmentFields, id: z.uuid().optional(), receivedOn: date }),
]);
export const updateConfirmedSaleSchema = z.strictObject({
  ...saleFields,
  soldOn: date,
  items: z.array(item.extend({ id: z.uuid().optional() })).min(1).max(100),
  installments: z.array(confirmedInstallment).min(1).max(100),
  expectedVersion: z.number().int().positive(),
});
export const initialReceiptSchema = z.strictObject({
  installmentId: z.uuid(),
  amount: positiveMoney,
  paymentMethod: method,
  receivedOn: date,
});
export const confirmSaleSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  initialReceipts: z.array(initialReceiptSchema).max(100).default([]),
});
export const workOrderSchema = z.strictObject({ expectedVersion: z.number().int().positive(), workOrderNumber: z.string().trim().min(1).max(40).nullable() });
export const cancelSaleSchema = z.strictObject({ expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(500) });
export const receiptSchema = z.strictObject({ amount: positiveMoney, paymentMethod: method, receivedOn: date, reference: optionalText(100) });
export const reverseReceiptSchema = z.strictObject({ reason: z.string().trim().min(3).max(100) });
export const listSalesSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELED', 'ALL']).default('ALL'),
  search: z.string().trim().min(1).max(100).optional(),
  customerId: z.uuid().optional(),
  from: date.optional(),
  to: date.optional(),
});
export const saleIdSchema = z.uuid();
export const idempotencyKeySchema = z.uuid();

export type CreateSaleInput = z.output<typeof createSaleSchema>;
export type UpdateSaleInput = z.output<typeof updateSaleSchema>;
export type UpdateConfirmedSaleInput = z.output<typeof updateConfirmedSaleSchema>;
export type ConfirmSaleInput = z.output<typeof confirmSaleSchema>;
export type ListSalesInput = z.output<typeof listSalesSchema>;
export type ReceiptInput = z.output<typeof receiptSchema>;
