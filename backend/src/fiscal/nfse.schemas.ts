import { z } from 'zod';

export const nfseIdSchema = z.uuid();
export const nfsePreviewSchema = z.strictObject({
  expectedSaleVersion: z.number().int().positive().optional(),
  competence: z.iso.date().optional(),
  municipalityIbgeCode: z.string().regex(/^\d{7}$/).optional(),
  simplesTotalTaxPercent: z.string().regex(/^(?:0|[1-9]\d?)(?:\.\d{1,2})?$/).optional(),
});
export const nfseEmitSchema = z.strictObject({ previewId: z.uuid() });
export type NfsePreviewInput = z.infer<typeof nfsePreviewSchema>;
