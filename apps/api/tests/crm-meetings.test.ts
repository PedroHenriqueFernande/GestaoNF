import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, count, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { CrmModule } from '../src/crm/crm.module.js';
import { LeadCaptureService } from '../src/crm/lead-capture.service.js';
import { OpportunitiesService } from '../src/crm/opportunities.service.js';
import { CrmHistoryService } from '../src/crm/crm-history.service.js';
import { MeetingsService } from '../src/crm/meetings.service.js';
import { MeetingReminderService } from '../src/crm/meeting-reminder.service.js';
import { createEntrySchema, createLeadSchema, pageSchema } from '../src/crm/crm.schemas.js';
import { createMeetingSchema, meetingListSchema, rescheduleMeetingSchema, updateMeetingSchema } from '../src/crm/meeting.schemas.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_meetings_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const secret = 'meetings-isolated-test-secret-with-at-least-32-characters';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, meetings: MeetingsService, reminders: MeetingReminderService, capture: LeadCaptureService, cards: OpportunitiesService, history: CrmHistoryService;
let owner: string, seller: string, otherSeller: string, company: string, otherCompany: string;
const ctx = (userId = owner, companyId = company) => ({ userId, companyId });
const start = '2030-01-15T14:00:00-03:00', end = '2030-01-15T15:00:00-03:00';
const period = { from: '2030-01-15T00:00:00-03:00', to: '2030-01-16T00:00:00-03:00' };
@Global()
@Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] })
class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, CrmModule] })
class TestAppModule {}
async function lead(assignedUserId?: string) {
  return capture.create(ctx(), createLeadSchema.parse({ lead: { name: 'Maria', ...(assignedUserId ? { assignedUserId } : {}) } }), randomUUID());
}
function input(contactId: string, extra: Record<string, unknown> = {}) {
  return createMeetingSchema.parse({ contactId, title: 'Apresentação do CRM', modality: 'ONLINE', startsAt: start, endsAt: end, ...extra });
}
async function meeting(extra: Record<string, unknown> = {}) {
  const l = await lead(); const result = await meetings.create(ctx(), input(l.leadId, extra), randomUUID());
  return { ...l, id: String(result.meetingId) };
}
async function http(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, options: { userId?: string; companyId?: string; key?: string; unauthenticated?: boolean } = {}) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(options.userId ?? owner).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  return app.inject({ method, url, headers: { ...(options.unauthenticated ? {} : { authorization: `Bearer ${token}` }), 'x-company-id': options.companyId ?? company, ...(options.key ? { 'idempotency-key': options.key } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
}
beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina DATABASE_URL para os testes isolados');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../../../packages/database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s }); vi.stubEnv('JWT_SECRET', secret);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
  meetings = app.get(MeetingsService); reminders = app.get(MeetingReminderService); capture = app.get(LeadCaptureService); cards = app.get(OpportunitiesService); history = app.get(CrmHistoryService);
}, 60_000);
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_meetings_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  // Vencimentos sintéticos de outros cenários não participam dos lotes seguintes.
  await db.update(s.crmMeetingReminderOccurrences).set({ status: 'CANCELED' }).where(eq(s.crmMeetingReminderOccurrences.status, 'PENDING'));
  const us = await db.insert(s.users).values(['Gestor', 'Vendedor', 'Outro'].map((name) => ({ name, email: `${randomUUID()}@example.test` }))).returning();
  [owner, seller, otherSeller] = us.map((u) => u.id);
  const accountId = await testAccount(db, owner);
  const cs = await db.insert(s.companies).values([{ accountId, name: 'Empresa A' }, { accountId, name: 'Empresa B' }]).returning(); [company, otherCompany] = cs.map((c) => c.id);
  await db.insert(s.companyUsers).values([{ companyId: company, userId: owner, role: 'OWNER' }, { companyId: otherCompany, userId: owner, role: 'OWNER' }, { companyId: company, userId: seller, role: 'COLLABORATOR' }, { companyId: company, userId: otherSeller, role: 'COLLABORATOR' }]);
});

describe('agenda, PostgreSQL, HTTP e entregas internas', () => {
  it('cria agenda, regras e históricos juntos e qualifica apenas o card explícito', async () => {
    const l = await lead();
    const second = await capture.addEntry(ctx(), l.leadId, createEntrySchema.parse({}), randomUUID());
    const result = await meetings.create(ctx(), input(l.leadId, { opportunityId: l.opportunityId, participants: [{ kind: 'EXTERNAL', name: 'Parceiro' }] }), randomUUID());
    const detail = await meetings.get(ctx(), String(result.meetingId));
    expect(detail.reminderMinutes).toEqual([30]); expect(detail.participants).toHaveLength(1);
    expect(detail.startsAt.toISOString()).toBe('2030-01-15T17:00:00.000Z');
    expect(result.opportunityQualified).toBe(true);
    expect((await cards.get(ctx(), l.opportunityId)).commercialStatus).toBe('QUALIFIED');
    expect((await cards.get(ctx(), second.opportunityId)).commercialStatus).toBe('NEW');
    expect((await history.list(ctx(), l.leadId, pageSchema.parse({}))).items.some((e) => e.kind === 'MEETING_CREATED')).toBe(true);
    expect('idempotencyKey' in detail).toBe(false); expect('requestHash' in detail).toBe(false);
  });
  it('contato sozinho, negociação encerrada ou automação desativada não qualifica', async () => {
    const a = await lead(); await meetings.create(ctx(), input(a.leadId), randomUUID());
    expect((await cards.get(ctx(), a.opportunityId)).commercialStatus).toBe('NEW');
    const b = await lead(); await cards.status(ctx(), b.opportunityId, { expectedVersion: 1, status: 'LOST' });
    await meetings.create(ctx(), input(b.leadId, { opportunityId: b.opportunityId, allowConflict: true }), randomUUID());
    expect((await cards.get(ctx(), b.opportunityId)).commercialStatus).toBe('LOST');
    await meetings.updateSettings(ctx(), { expectedVersion: 1, qualifyOpportunityOnMeeting: false });
    const c = await lead(); await meetings.create(ctx(), input(c.leadId, { opportunityId: c.opportunityId, allowConflict: true }), randomUUID());
    expect((await cards.get(ctx(), c.opportunityId)).commercialStatus).toBe('NEW');
  });
  it('serializa horários concorrentes de contatos distintos e permite horários adjacentes', async () => {
    const a = await lead(), b = await lead();
    const outcomes = await Promise.allSettled([meetings.create(ctx(), input(a.leadId), randomUUID()), meetings.create(ctx(), input(b.leadId), randomUUID())]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === 'rejected'); expect(rejected?.status === 'rejected' && rejected.reason.status).toBe(409);
    await meetings.create(ctx(), input(b.leadId, { startsAt: end, endsAt: '2030-01-15T16:00:00-03:00' }), randomUUID());
    expect((await meetings.list(ctx(), meetingListSchema.parse(period))).total).toBe(2);
    const confirmed = await meetings.create(ctx(), input(a.leadId, { allowConflict: true }), randomUUID());
    expect(confirmed.conflicts).toHaveLength(1);
  });
  it('replays concorrentes mantêm resultado e rejeitam mesma chave com outro horário', async () => {
    const l = await lead(), key = randomUUID(), data = input(l.leadId);
    const results = await Promise.all(Array.from({ length: 4 }, () => meetings.create(ctx(), data, key)));
    for (const result of results) expect(result).toEqual(results[0]);
    await expect(meetings.create(ctx(), input(l.leadId, { startsAt: end, endsAt: '2030-01-15T16:00:00-03:00' }), key)).rejects.toMatchObject({ status: 409 });
    expect((await meetings.history(ctx(), String(results[0].meetingId), 20, 0)).total).toBe(1);
  });
  it('versão e snapshots completos impedem sobrescritas e conservam participantes anteriores', async () => {
    const m = await meeting({ participants: [{ kind: 'EXTERNAL', name: 'João' }] });
    const outcomes = await Promise.allSettled([
      meetings.update(ctx(), m.id, updateMeetingSchema.parse({ expectedVersion: 1, participants: [{ kind: 'EXTERNAL', name: 'Ana' }], reminderMinutes: [60] })),
      meetings.update(ctx(), m.id, updateMeetingSchema.parse({ expectedVersion: 1, title: 'Outro título' })),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const detail = await meetings.get(ctx(), m.id);
    if (detail.title === 'Outro título') await meetings.update(ctx(), m.id, updateMeetingSchema.parse({ expectedVersion: 2, participants: [{ kind: 'EXTERNAL', name: 'Ana' }], reminderMinutes: [60] }));
    const events = await meetings.history(ctx(), m.id, 20, 0);
    expect(JSON.stringify(events.items)).toContain('João'); expect(JSON.stringify(events.items)).toContain('Ana');
    const current = await meetings.get(ctx(), m.id);
    await meetings.reschedule(ctx(), m.id, rescheduleMeetingSchema.parse({ expectedVersion: current.version, startsAt: start, endsAt: end }));
    expect((await meetings.get(ctx(), m.id)).version).toBe(current.version);
  });
  it('reabrir verifica conflito e cancelamento preserva a negociação', async () => {
    const l = await lead(), r = await meetings.create(ctx(), input(l.leadId, { opportunityId: l.opportunityId }), randomUUID()), id = String(r.meetingId);
    await meetings.status(ctx(), id, { expectedVersion: 1, status: 'CANCELED', cancellationReason: 'Outro dia' });
    await meeting();
    await expect(meetings.reopen(ctx(), id, { expectedVersion: 2, allowConflict: false })).rejects.toMatchObject({ status: 409 });
    await meetings.reopen(ctx(), id, { expectedVersion: 2, allowConflict: true });
    expect((await cards.get(ctx(), l.opportunityId)).commercialStatus).toBe('QUALIFIED');
    await expect(meetings.status(ctx(), id, { expectedVersion: 3, status: 'SCHEDULED' })).rejects.toMatchObject({ status: 400 });
  });
  it('isola empresa, oportunidade privada e o replay após transferência', async () => {
    const l = await lead();
    const r = await meetings.create(ctx(), input(l.leadId, { opportunityId: l.opportunityId, assignedUserId: seller }), randomUUID());
    const id = String(r.meetingId);
    expect((await meetings.get(ctx(seller), id)).opportunity).toBeNull();
    await expect(meetings.get(ctx(otherSeller), id)).rejects.toMatchObject({ status: 404 });
    await expect(meetings.get(ctx(owner, otherCompany), id)).rejects.toMatchObject({ status: 404 });
    const mine = await lead(seller), key = randomUUID();
    const result = await meetings.create(ctx(seller), input(mine.leadId, { allowConflict: true }), key);
    await meetings.update(ctx(), String(result.meetingId), updateMeetingSchema.parse({ expectedVersion: 1, assignedUserId: otherSeller }));
    await expect(meetings.create(ctx(seller), input(mine.leadId, { allowConflict: true }), key)).rejects.toMatchObject({ status: 404 });
  });
  it('configurações concorrentes verificam a versão e colaborador não as altera', async () => {
    const outcomes = await Promise.allSettled([meetings.updateSettings(ctx(), { expectedVersion: 1, defaultReminderMinutes: 60 }), meetings.updateSettings(ctx(), { expectedVersion: 1, defaultReminderMinutes: 15 })]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    await expect(meetings.updateSettings(ctx(seller), { expectedVersion: 2, conflictPolicy: 'ALLOW' })).rejects.toMatchObject({ status: 403 });
  });
  it('participante inválido desfaz toda a reserva e a qualificação', async () => {
    const l = await lead();
    await expect(meetings.create(ctx(), input(l.leadId, { opportunityId: l.opportunityId, participants: [{ kind: 'USER', userId: randomUUID() }] }), randomUUID())).rejects.toMatchObject({ status: 400 });
    expect((await meetings.list(ctx(), meetingListSchema.parse(period))).total).toBe(0);
    expect((await cards.get(ctx(), l.opportunityId)).commercialStatus).toBe('NEW');
  });
  it('worker concorrente entrega uma única notificação e preserva o registro enviado', async () => {
    const m = await meeting(); const now = new Date('2030-01-15T16:31:00Z');
    await Promise.all([reminders.dispatchDue(now), reminders.dispatchDue(now)]);
    const inbox = await reminders.notifications(ctx(), { limit: 20, offset: 0, unreadOnly: false });
    expect(inbox.total).toBe(1);
    const notification = inbox.items[0];
    await expect(reminders.read(ctx(seller), notification.id)).rejects.toMatchObject({ status: 404 });
    await reminders.read(ctx(), notification.id);
    expect((await reminders.notifications(ctx(), { limit: 20, offset: 0, unreadOnly: true })).total).toBe(0);
    await meetings.reschedule(ctx(), m.id, rescheduleMeetingSchema.parse({ expectedVersion: 1, startsAt: '2030-01-16T14:00:00-03:00', endsAt: '2030-01-16T15:00:00-03:00' }));
    const rows = await db.select().from(s.crmMeetingReminderOccurrences).where(eq(s.crmMeetingReminderOccurrences.meetingId, m.id));
    expect(rows.filter((r) => r.status === 'DELIVERED')).toHaveLength(1); expect(rows.filter((r) => r.status === 'PENDING')).toHaveLength(1);
  });
  it('reagendamento, cancelamento, atraso e perda de acesso não entregam aviso antigo', async () => {
    const a = await meeting();
    await meetings.reschedule(ctx(), a.id, rescheduleMeetingSchema.parse({ expectedVersion: 1, startsAt: '2030-01-16T14:00:00-03:00', endsAt: '2030-01-16T15:00:00-03:00' }));
    expect((await reminders.dispatchDue(new Date('2030-01-15T16:31:00Z'))).delivered).toBe(0);
    await meetings.status(ctx(), a.id, { expectedVersion: 2, status: 'CANCELED' });
    expect((await reminders.dispatchDue(new Date('2030-01-16T16:31:00Z'))).delivered).toBe(0);
    await meeting();
    expect((await reminders.dispatchDue(new Date('2030-01-15T17:01:00Z'))).expired).toBe(1);
    const l = await lead(seller); await meetings.create(ctx(seller), input(l.leadId), randomUUID());
    await db.update(s.companyUsers).set({ status: 'INACTIVE' }).where(and(eq(s.companyUsers.companyId, company), eq(s.companyUsers.userId, seller)));
    expect((await reminders.dispatchDue(new Date('2030-01-15T16:31:00Z'))).canceled).toBe(1);
  });
  it('HTTP aplica contratos, controle de acesso e Swagger', async () => {
    expect((await http('GET', '/crm/meetings', undefined, { unauthenticated: true })).statusCode).toBe(401);
    expect((await http('GET', '/crm/meetings')).statusCode).toBe(400);
    const l = await lead(), payload = { contactId: l.leadId, title: 'HTTP', modality: 'ONLINE', startsAt: start, endsAt: end };
    expect((await http('POST', '/crm/meetings', payload)).statusCode).toBe(400);
    const response = await http('POST', '/crm/meetings', payload, { key: randomUUID() }); expect(response.statusCode).toBe(201);
    const id = response.json().meetingId;
    expect((await http('GET', `/crm/meetings/${id}`, undefined, { companyId: otherCompany })).statusCode).toBe(404);
    expect((await http('PATCH', `/crm/meetings/${id}`, { expectedVersion: 1, title: 'Alterado' })).statusCode).toBe(200);
    expect((await http('PATCH', `/crm/meetings/${id}`, { expectedVersion: 1, title: 'Antigo' })).statusCode).toBe(409);
    expect((await http('GET', '/crm/meetings/responsibles', undefined, { userId: seller })).json().items).toHaveLength(1);
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Agenda').setVersion('1').build());
    expect(doc.paths['/crm/meetings'].post?.requestBody).toBeDefined(); expect(doc.paths['/crm/meetings/{id}/reopen'].post).toBeDefined();
  });
  it('lembrete no início tolera um ciclo do worker e expira após essa janela', async () => {
    await meeting({ reminderMinutes: [0] });
    expect((await reminders.dispatchDue(new Date('2030-01-15T17:00:15Z'))).delivered).toBe(1);
    await meeting({ reminderMinutes: [0], allowConflict: true });
    expect((await reminders.dispatchDue(new Date('2030-01-15T17:01:00Z'))).expired).toBe(1);
  });
  it('banco rejeita vínculos de outra empresa e mantém histórico de leads anterior à agenda', async () => {
    const m = await meeting();
    const other = await capture.create(ctx(owner, otherCompany), createLeadSchema.parse({ lead: { name: 'Outro lead' } }), randomUUID());
    await expect(db.update(s.crmMeetings).set({ contactId: other.leadId }).where(eq(s.crmMeetings.id, m.id))).rejects.toThrow();
    expect((await history.list(ctx(), m.leadId, pageSchema.parse({}))).total).toBeGreaterThan(3);
    const [result] = await db.select({ total: count() }).from(s.customers).where(eq(s.customers.companyId, company)); expect(result.total).toBe(0);
  });
});
