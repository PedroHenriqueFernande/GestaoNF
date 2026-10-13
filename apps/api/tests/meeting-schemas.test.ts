import { describe, expect, it } from 'vitest';
import { commandHash } from '../src/crm/crm-normalization.js';
import { conflictSchema, createMeetingSchema, meetingListSchema, meetingStatusSchema, updateMeetingSchema } from '../src/crm/meeting.schemas.js';

const payload = {
  contactId: '11111111-1111-4111-8111-111111111111', title: 'Apresentação', modality: 'ONLINE',
  startsAt: '2026-10-15T14:00:00-03:00', endsAt: '2026-10-15T15:00:00-03:00',
};

describe('contratos do agendamento em construção', () => {
  it('aceita datas com offset e converte para o instante UTC', () => {
    const parsed = createMeetingSchema.parse(payload);
    expect(parsed.startsAt.toISOString()).toBe('2026-10-15T17:00:00.000Z');
    expect(parsed.allowConflict).toBe(false);
  });
  it('rejeita datas locais sem offset e intervalos vazios ou invertidos', () => {
    expect(createMeetingSchema.safeParse({ ...payload, startsAt: '2026-10-15T14:00:00' }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...payload, endsAt: payload.startsAt }).success).toBe(false);
    expect(conflictSchema.safeParse({ assignedUserId: payload.contactId, startsAt: payload.endsAt, endsAt: payload.startsAt }).success).toBe(false);
  });
  it('valida from/to na listagem e limita a janela do calendário', () => {
    expect(meetingListSchema.safeParse({ from: payload.startsAt, to: payload.endsAt }).success).toBe(true);
    expect(meetingListSchema.safeParse({ from: payload.endsAt, to: payload.startsAt }).success).toBe(false);
    expect(meetingListSchema.safeParse({ from: payload.startsAt, to: '2028-10-15T14:00:00-03:00' }).success).toBe(false);
  });
  it('inclui os instantes no hash de idempotência e normaliza offsets equivalentes', () => {
    const parsed = createMeetingSchema.parse(payload);
    const same = createMeetingSchema.parse({ ...payload, startsAt: '2026-10-15T17:00:00Z', endsAt: '2026-10-15T18:00:00Z' });
    const different = createMeetingSchema.parse({ ...payload, startsAt: '2026-10-16T14:00:00-03:00', endsAt: '2026-10-16T15:00:00-03:00' });
    expect(commandHash(parsed)).toBe(commandHash(same));
    expect(commandHash(parsed)).not.toBe(commandHash(different));
  });
  it('rejeita payload sem alteração e campos externos ao contrato', () => {
    expect(updateMeetingSchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
    expect(createMeetingSchema.safeParse({ ...payload, companyId: payload.contactId }).success).toBe(false);
  });
  it('deduplica antecedências e exige identificação de participantes externos', () => {
    expect(createMeetingSchema.parse({ ...payload, reminderMinutes: [30, 60, 30] }).reminderMinutes).toEqual([30, 60]);
    expect(createMeetingSchema.safeParse({ ...payload, participants: [{ kind: 'EXTERNAL' }] }).success).toBe(false);
  });
  it('mantém resultado e motivo nos estados correspondentes', () => {
    expect(meetingStatusSchema.safeParse({ expectedVersion: 1, status: 'COMPLETED', outcomeNotes: 'Reunião concluída' }).success).toBe(true);
    expect(meetingStatusSchema.safeParse({ expectedVersion: 1, status: 'SCHEDULED', cancellationReason: 'Desistiu' }).success).toBe(false);
    expect(meetingStatusSchema.safeParse({ expectedVersion: 1, status: 'CANCELED', outcomeNotes: 'Concluiu' }).success).toBe(false);
  });
});
