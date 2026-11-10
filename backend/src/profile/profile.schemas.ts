import { z } from 'zod';

export const avatarIdSchema = z.uuid();
export const uploadKeySchema = z.string().trim().min(1).max(200);
export const beginAvatarUploadSchema = z.strictObject({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  sizeBytes: z.number().int().min(1).max(5 * 1024 * 1024),
});
export const patchProfileSchema = z.strictObject({
  expectedVersion: z.number().int().positive(),
  name: z.string().trim().min(1).max(200).optional(),
  avatarId: avatarIdSchema.nullable().optional(),
}).refine(value => value.name !== undefined || value.avatarId !== undefined, 'Informe nome ou foto');
export type BeginAvatarUpload = z.infer<typeof beginAvatarUploadSchema>;
export type PatchProfile = z.infer<typeof patchProfileSchema>;
