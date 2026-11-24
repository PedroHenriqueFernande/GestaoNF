import { z } from 'zod';
import { ROLE_LABELS } from '@gestaonf/permissions';
const roleLabelSchema = z.enum(ROLE_LABELS);
const MAX_EMAIL_LENGTH = 254;
/** Chaves como texto: desconhecidas viram 422 UNKNOWN_PERMISSION no serviço (Spec 8.2), não 400. */
const permissionsSchema = z.array(z.string().min(1).max(64)).max(200);
export const companySelection = z.array(z.uuid()).min(1).max(100).refine(v => new Set(v).size === v.length, 'Empresas repetidas').transform(v => v.sort());
export const createInvitationSchema = z.strictObject({ name: z.string().trim().min(1).max(200), email: z.string().trim().toLowerCase().pipe(z.email().max(MAX_EMAIL_LENGTH)), companyIds: companySelection,
  roleLabel: roleLabelSchema.default('COLLABORATOR'), permissions: permissionsSchema.default([]) });
export const invitationVersionSchema = z.strictObject({ version: z.number().int().min(1) });
export const invitationAccessSchema = invitationVersionSchema.extend({ companyIds: companySelection, roleLabel: roleLabelSchema, permissions: permissionsSchema });
export type InvitationAccessInput = z.output<typeof invitationAccessSchema>;
const membershipCompanies = z.array(z.uuid()).max(100).refine(v => new Set(v).size === v.length, 'Empresas repetidas').transform(v => v.sort());
export const memberAccessSchema = z.strictObject({ version: z.string().length(64), companyIds: membershipCompanies, roleLabel: roleLabelSchema, permissions: permissionsSchema });
export type MemberAccessInput = z.output<typeof memberAccessSchema>;
export const userListSchema = z.strictObject({ search: z.string().trim().max(MAX_EMAIL_LENGTH).default(''), limit: z.coerce.number().int().min(1).max(100).default(25), offset: z.coerce.number().int().min(0).max(100000).default(0) });
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const previewSchema = z.strictObject({ token: tokenSchema });
export const acceptNewSchema = previewSchema.extend({ password: z.string().min(12).max(128), passwordConfirmation: z.string(), client: z.enum(['web', 'mobile']).default('web') }).refine(v => v.password === v.passwordConfirmation, 'As senhas precisam ser iguais');
