import { z } from 'zod';
import { FILE_TYPES, maxFileBytes } from './files.config.js';

export const fileIdSchema = z.uuid();
export const uploadKeySchema = z.string().trim().min(1).max(128);
export const beginUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.enum(FILE_TYPES),
  sizeBytes: z.number().int().positive(),
}).strict().superRefine((input, ctx) => {
  if (input.sizeBytes > maxFileBytes(input.mimeType)) ctx.addIssue({ code: 'custom', path: ['sizeBytes'], message: input.mimeType === 'application/pdf' ? 'PDF deve ter até 25 MB' : 'Imagem deve ter até 10 MB' });
});
export const fileListSchema = z.object({
  search: z.string().trim().max(180).optional(),
  kind: z.enum(['ALL', 'IMAGE', 'PDF']).default('ALL'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
export const fileAccessSchema = z.object({ disposition: z.enum(['inline', 'attachment']).default('attachment') }).strict();
export type BeginUpload = z.output<typeof beginUploadSchema>;
export type FileListQuery = z.output<typeof fileListSchema>;
