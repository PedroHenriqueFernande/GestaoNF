import { z } from 'zod';

const client = z.enum(['web', 'mobile']);

export const registerSchema = z.strictObject({
  name: z.string().trim().min(1).max(200),
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(12).max(128),
  companyName: z.string().trim().min(1).max(200),
  client,
});

export const loginSchema = z.strictObject({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string(),
  client,
});

export const refreshSchema = z.strictObject({ refreshToken: z.string().optional() });
export type ClientType = z.infer<typeof client>;
