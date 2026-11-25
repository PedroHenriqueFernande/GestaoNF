import { z } from 'zod';
import { scopeQueryFields } from '../auth/company-scope.guard.js';
import { idSchema, pageFields } from './crm.schemas.js';

const nullableText = (max: number) => z.string().max(max).transform((value) => value.trim() || null).nullable();
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));
const version = z.number().int().min(1);
const timezone = z.string().trim().min(1).max(64).refine((value) => {
  try { new Intl.DateTimeFormat('pt-BR', { timeZone: value }); return !/^[+-]/.test(value); } catch { return false; }
}, 'Informe um fuso IANA válido');
const meetingUrl = z.url({ protocol: /^https?$/ }).max(2000).nullable();
const statuses = ['SCHEDULED', 'COMPLETED', 'CANCELED', 'NO_SHOW'] as const;

const contactParticipant = z.strictObject({ kind: z.literal('CONTACT'), contactId: idSchema });
const userParticipant = z.strictObject({ kind: z.literal('USER'), userId: idSchema });
const externalParticipant = z.strictObject({
  kind: z.literal('EXTERNAL'), name: nullableText(200).optional(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)).nullable().optional(), phone: nullableText(64).optional(),
}).refine((value) => !!(value.name || value.email || value.phone), 'Informe nome, e-mail ou telefone do participante');
export const participantSchema = z.discriminatedUnion('kind', [contactParticipant, userParticipant, externalParticipant]);
const reminderMinutes = z.array(z.number().int().min(0).max(10080)).max(10).transform((items) => [...new Set(items)].sort((a, b) => a - b));

const period = {
  startsAt: instant,
  endsAt: instant,
};
const validatePeriod = <T extends { startsAt: Date; endsAt: Date }>(value: T) => value.endsAt > value.startsAt;

export const createMeetingSchema = z.strictObject({
  contactId: idSchema, opportunityId: idSchema.nullable().optional(),
  assignedUserId: idSchema.optional(), ...period, timezone: timezone.optional(),
  meetingUrl: meetingUrl.optional(),
  participants: z.array(participantSchema).max(100).default([]), reminderMinutes: reminderMinutes.optional(),
  allowConflict: z.boolean().default(false),
}).refine(validatePeriod, { message: 'O término deve ser posterior ao início', path: ['endsAt'] });

export const updateMeetingSchema = z.strictObject({
  expectedVersion: version,
  assignedUserId: idSchema.optional(), timezone: timezone.optional(),
  meetingUrl: meetingUrl.optional(),
  participants: z.array(participantSchema).max(100).optional(), reminderMinutes: reminderMinutes.optional(),
  allowConflict: z.boolean().default(false),
}).refine((value) => Object.keys(value).some((key) => !['expectedVersion', 'allowConflict'].includes(key)), 'Informe ao menos um campo');

export const rescheduleMeetingSchema = z.strictObject({
  expectedVersion: version, ...period, timezone: timezone.optional(), allowConflict: z.boolean().default(false),
}).refine(validatePeriod, { message: 'O término deve ser posterior ao início', path: ['endsAt'] });

export const reopenMeetingSchema = z.strictObject({ expectedVersion: version, allowConflict: z.boolean().default(false) });

export const meetingStatusSchema = z.strictObject({
  expectedVersion: version, status: z.enum(statuses), outcomeNotes: nullableText(10000).optional(),
  nextSteps: nullableText(10000).optional(), cancellationReason: nullableText(1000).optional(),
}).refine((value) => value.status === 'CANCELED' || !value.cancellationReason, 'Motivo permitido somente no cancelamento')
  .refine((value) => value.status === 'COMPLETED' || (!value.outcomeNotes && !value.nextSteps), 'Resultado e próximos passos são permitidos somente ao concluir');

const meetingListFields = {
  ...pageFields, from: instant, to: instant, assignedUserId: idSchema.optional(), contactId: idSchema.optional(),
  opportunityId: idSchema.optional(), status: z.enum(statuses).optional(),
  search: z.string().trim().min(1).max(200).optional(),
};
const orderedPeriod = (value: { from: Date; to: Date }) => value.to > value.from;
const maximumPeriod = (value: { from: Date; to: Date }) => value.to.getTime() - value.from.getTime() <= 366 * 24 * 60 * 60 * 1000;
const invalidPeriod = { message: 'Período invertido', path: ['to'] };
const periodTooLong = { message: 'O período máximo é de 366 dias', path: ['to'] };
export const meetingListSchema = z.strictObject(meetingListFields).refine(orderedPeriod, invalidPeriod).refine(maximumPeriod, periodTooLong);
const { contactId: _contact, opportunityId: _opportunity, ...meetingOverviewFields } = meetingListFields;
export const meetingListOverviewSchema = z.strictObject({ ...scopeQueryFields, ...meetingOverviewFields })
  .refine(orderedPeriod, invalidPeriod).refine(maximumPeriod, periodTooLong)
  .transform(({ companies: _companies, companyIds: _companyIds, ...filters }) => filters);

export const conflictSchema = z.strictObject({
  assignedUserId: idSchema, ...period, excludeMeetingId: idSchema.optional(),
}).refine(validatePeriod, { message: 'O término deve ser posterior ao início', path: ['endsAt'] });

export const meetingHistorySchema = z.strictObject(pageFields);
export const notificationListSchema = z.strictObject({ ...pageFields, unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true') });
export const updateMeetingSettingsSchema = z.strictObject({
  expectedVersion: version, qualifyOpportunityOnMeeting: z.boolean().optional(),
  defaultReminderMinutes: z.number().int().min(0).max(10080).nullable().optional(), conflictPolicy: z.enum(['WARN', 'ALLOW']).optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), 'Informe ao menos um campo');

export type CreateMeeting = z.output<typeof createMeetingSchema>;
export type UpdateMeeting = z.output<typeof updateMeetingSchema>;
export type RescheduleMeeting = z.output<typeof rescheduleMeetingSchema>;
export type MeetingStatusInput = z.output<typeof meetingStatusSchema>;
export type MeetingListInput = z.output<typeof meetingListSchema>;
export type ConflictInput = z.output<typeof conflictSchema>;
