import { z } from 'zod';

export const logoFileIdSchema = z.uuid();
export const logoUploadKeySchema = z.string().trim().min(1).max(200);
export const setCompanyLogoSchema = z.strictObject({ logoId: z.uuid().nullable() });
export const emptySchema = z.strictObject({});
