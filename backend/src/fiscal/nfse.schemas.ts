import { z } from 'zod';

export const nfseIdSchema = z.uuid();
export const nfsePreviewSchema = z.strictObject({
  expectedSaleVersion: z.number().int().positive().optional(),
  competence: z.iso.date().optional(),
  municipalityIbgeCode: z.string().regex(/^\d{7}$/).optional(),
  simplesTotalTaxPercent: z.string().regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/).optional(),
});
export const nfseEmitSchema = z.strictObject({ previewId: z.uuid() });
export const nfseCancelSchema = z.strictObject({ reasonCode: z.enum(['1', '2', '9']), reasonText: z.string().trim().min(15).max(255) });
export const nfseSubstitutionSchema = z.strictObject({ reasonCode: z.enum(['01', '02', '03', '04', '05', '99']), reasonText: z.string().trim().min(15).max(255).optional() })
  .refine(value => value.reasonCode !== '99' || !!value.reasonText, { message: 'Descreva o motivo da substituição.', path: ['reasonText'] });
export type NfseCancelInput = z.infer<typeof nfseCancelSchema>;
export type NfseSubstitutionInput = z.infer<typeof nfseSubstitutionSchema>;
export type NfsePreviewInput = z.infer<typeof nfsePreviewSchema>;
