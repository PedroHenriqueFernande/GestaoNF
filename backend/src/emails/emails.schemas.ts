import { z } from 'zod';
import { emailAddress } from './emails.config.js';

export const emailKeySchema = z.string().min(1).max(200).regex(/^[a-zA-Z0-9_./-]+$/);
export const sendEmailSchema = z.strictObject({
  to: emailAddress,
  subject: z.string().trim().min(1).max(200).regex(/^[^\r\n]+$/),
  message: z.string().trim().min(1).max(20_000),
});
export const testEmailSchema = z.strictObject({ scenario: z.enum(['OWN', 'DELIVERED', 'BOUNCED', 'COMPLAINED', 'SUPPRESSED']).default('OWN') });
export const emailListSchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});
export const emailWebhookSchema = z.object({
  type: z.string().min(1).max(64), created_at: z.iso.datetime({ offset: true }),
  data: z.object({ email_id: z.uuid() }),
});
