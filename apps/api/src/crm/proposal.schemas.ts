import { z } from 'zod';
import { createCustomerSchema } from '../customers/customers.schemas.js';
import { dateSchema, idSchema, pageFields } from './crm.schemas.js';

const text = (max: number) => z.string().trim().max(max).transform(v => v || null).nullable().optional();
const money = z.string().regex(/^(?:0|[1-9]\d{0,12})\.\d{2}$/);
const quantity = z.string().regex(/^(?:0|[1-9]\d{0,10})\.\d{4}$/).refine(v => v !== '0.0000');
export const proposalItemSchema = z.strictObject({
  serviceId: idSchema, quantity, unitPrice: money, description: text(1000),
  discountType: z.enum(['AMOUNT', 'PERCENT']).default('AMOUNT'), discountInput: money.default('0.00'),
}).refine(v => v.discountType !== 'PERCENT' || Number(v.discountInput) <= 100, 'Percentual deve estar entre 0 e 100');
const fields = {
  title: z.string().trim().min(1).max(200).optional(),
  commercialDescription: text(5000), paymentTerms: text(2000), notes: text(2000), terms: text(10000),
  validUntil: dateSchema.nullable().optional(), items: z.array(proposalItemSchema).min(1).max(100),
};
export const createProposalSchema = z.strictObject({
  ...fields, opportunityId: idSchema.optional(), customerId: idSchema.optional(), contactId: idSchema.optional(),
  createOpportunity: z.boolean().default(false), newCustomer: createCustomerSchema.partial().optional(),
}).refine(v => v.createOpportunity ? !!v.customerId && !v.opportunityId && !v.newCustomer : !!v.opportunityId && !v.contactId, 'Selecione uma negociação ou crie uma para o cliente')
  .refine(v => !v.customerId || !v.newCustomer, 'Selecione cliente existente ou informe novo cadastro');
export const updateProposalSchema = z.strictObject({ ...fields, items: fields.items.optional(), expectedVersion: z.number().int().positive() })
  .refine(v => Object.keys(v).some(k => k !== 'expectedVersion'), 'Informe ao menos um campo');
export const proposalCommandSchema = z.strictObject({ expectedVersion: z.number().int().positive() });
export const declineProposalSchema = proposalCommandSchema.extend({ reason: text(1000) });
export const duplicateProposalSchema = proposalCommandSchema.extend({ validUntil: dateSchema.nullable().optional() });
export const proposalPrefillSchema = z.strictObject({ opportunityId: idSchema.optional(), customerId: idSchema.optional(), contactId: idSchema.optional() })
  .refine(v => [v.opportunityId, v.customerId, v.contactId].filter(Boolean).length === 1, 'Informe negociação, lead ou cliente');
export const proposalListSchema = z.strictObject({
  ...pageFields, search: z.string().trim().min(1).max(200).optional(), contactId: idSchema.optional(), customerId: idSchema.optional(),
  opportunityId: idSchema.optional(), assignedUserId: idSchema.optional(), serviceId: idSchema.optional(),
  status: z.enum(['ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CONVERTED']).default('ALL'),
  from: dateSchema.optional(), to: dateSchema.optional(), validFrom: dateSchema.optional(), validTo: dateSchema.optional(),
}).refine(v => (!v.from || !v.to || v.from <= v.to) && (!v.validFrom || !v.validTo || v.validFrom <= v.validTo), 'Período invertido');
export const proposalSettingsSchema = z.strictObject({
  expectedVersion: z.number().int().positive(), winOpportunityOnProposalConversion: z.boolean().optional(), proposalSentStageId: idSchema.nullable().optional(),
}).refine(v => Object.keys(v).some(k => k !== 'expectedVersion'), 'Informe ao menos um campo');
export type CreateProposal = z.output<typeof createProposalSchema>;
export type UpdateProposal = z.output<typeof updateProposalSchema>;
export type ProposalList = z.output<typeof proposalListSchema>;
export type ProposalPrefill = z.output<typeof proposalPrefillSchema>;
export type ProposalItemInput = z.output<typeof proposalItemSchema>;
