import 'reflect-metadata';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import rawBody from 'fastify-raw-body';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { createHmac, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { count, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { EmailsModule } from '../src/emails/emails.module.js';
import { EmailsService } from '../src/emails/emails.service.js';
import { EmailDispatchService } from '../src/emails/email-dispatch.service.js';
import { ResendProviderService } from '../src/emails/resend-provider.service.js';
import { emailConfig } from '../src/emails/emails.config.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_emails_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const jwtSecret = 'emails-isolated-test-secret-with-at-least-32-characters';
const webhookKey = Buffer.from('isolated-webhook-key-for-test-only');
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, emails: EmailsService, dispatcher: EmailDispatchService, provider: ResendProviderService;
let owner: string, collaborator: string, company: string, otherCompany: string;
const input = { to: 'owner@example.test', subject: 'Proposta <CRM>', message: 'Olá <script>alert(1)</script>\nTeste & confirmação.' };
const ctx = () => ({ companyId: company, userId: owner });
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] }) class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, EmailsModule] }) class TestAppModule {}
async function http(method: 'GET' | 'POST', url: string, body?: unknown, userId = owner, companyId = company, key?: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(jwtSecret));
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId, ...(key ? { 'idempotency-key': key } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body), headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) } } : {}) });
}
async function event(type: string, emailId: string, id = `msg_${randomUUID()}`, timestamp = Math.floor(Date.now() / 1000), alter = false) {
  const body = JSON.stringify({ type, created_at: new Date().toISOString(), data: { email_id: emailId } });
  const signature = createHmac('sha256', webhookKey).update(`${id}.${timestamp}.${body}`).digest('base64');
  return app.inject({ method: 'POST', url: '/integrations/email/resend/webhook', headers: { 'content-type': 'application/json', 'svix-id': id, 'svix-timestamp': String(timestamp), 'svix-signature': `v1,${signature}` }, payload: alter ? body.replace('email.delivered', 'email.bounced') : body });
}
async function makeDue(id: string) { await db.update(s.emailMessages).set({ availableAt: new Date(Date.now() - 1000), lastAttemptAt: new Date(Date.now() - 2000) }).where(eq(s.emailMessages.id, id)); }
async function row(id: string) { return (await db.select().from(s.emailMessages).where(eq(s.emailMessages.id, id)))[0]; }

beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../../../packages/database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s });
  for (const [key, value] of Object.entries({ JWT_SECRET: jwtSecret, RESEND_ENABLED: 'true', RESEND_API_KEY: 're_test_only', RESEND_TEST_MODE: 'true', RESEND_FROM: 'GestãoNF <onboarding@resend.dev>', RESEND_TEST_RECIPIENT: 'owner@example.test', RESEND_REPLY_TO: '', RESEND_WEBHOOK_SECRET: `whsec_${webhookKey.toString('base64')}`, EMAIL_COMPANY_DAILY_LIMIT: '100' })) vi.stubEnv(key, value);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.register(rawBody, { field: 'rawBody', global: true, encoding: 'utf8', runFirst: true });
  await app.init(); await app.getHttpAdapter().getInstance().ready();
  emails = app.get(EmailsService); dispatcher = app.get(EmailDispatchService); provider = app.get(ResendProviderService);
}, 60_000);
beforeEach(async () => {
  await db.delete(s.emailEvents); await db.delete(s.emailMessages);
  Object.assign(provider.config, { enabled: true, testMode: true, from: 'GestãoNF <onboarding@resend.dev>', dailyLimit: 100 });
  [owner, collaborator] = (await db.insert(s.users).values(['Owner', 'Collaborator'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning()).map(u => u.id);
  [company, otherCompany] = (await db.insert(s.companies).values([{ name: 'Empresa A' }, { name: 'Empresa B' }]).returning()).map(c => c.id);
  await db.insert(s.companyUsers).values([{ companyId: company, userId: owner, role: 'OWNER' }, { companyId: otherCompany, userId: owner, role: 'OWNER' }, { companyId: company, userId: collaborator, role: 'COLLABORATOR' }]);
  // All tests replace the actual provider transport, preventing any outbound email.
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: randomUUID() }), { status: 200 })));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_emails_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});

describe('Resend: base transacional de e-mails', () => {
  it('valida configuração de testes e domínio de produção', () => {
    expect(() => emailConfig({ RESEND_ENABLED: 'true' })).toThrow();
    expect(() => emailConfig({ RESEND_TEST_MODE: 'false' })).toThrow();
    expect(emailConfig({ RESEND_ENABLED: 'false' }).enabled).toBe(false);
  });
  it('exige autenticação, acesso à empresa, gestão e chave idempotente', async () => {
    expect((await app.inject({ method: 'POST', url: '/emails', payload: input })).statusCode).toBe(401);
    expect((await http('POST', '/emails', input, collaborator, company, randomUUID())).statusCode).toBe(403);
    expect((await http('GET', '/emails/capabilities', undefined, collaborator, otherCompany)).statusCode).toBe(403);
    expect((await http('POST', '/emails', input)).statusCode).toBe(400);
    expect((await http('POST', '/emails', { ...input, from: 'spoof@example.test' }, owner, company, randomUUID())).statusCode).toBe(400);
  });
  it('retorna 202, não envia na requisição e escapa HTML em template com texto', async () => {
    const response = await http('POST', '/emails', input, owner, company, randomUUID());
    expect(response.statusCode).toBe(202); expect(response.json().sendStatus).toBe('QUEUED'); expect(fetch).not.toHaveBeenCalled();
    const saved = await row(response.json().id);
    expect(saved.htmlBody).toContain('&lt;script&gt;'); expect(saved.htmlBody).not.toContain('<script>'); expect(saved.textBody).toContain('Olá <script>');
    expect(response.json()).not.toHaveProperty('htmlBody'); expect(response.json()).not.toHaveProperty('requestKey');
  });
  it('idempotência persiste em concorrência e conflita com payload diferente', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => emails.send(ctx(), input, key)));
    expect(new Set(results.map(r => r.id)).size).toBe(1);
    await expect(emails.send(ctx(), { ...input, subject: 'Alterado' }, key)).rejects.toMatchObject({ status: 409 });
    expect((await db.select({ value: count() }).from(s.emailMessages))[0].value).toBe(1);
  });
  it('aceita destinatário da conta e simuladores, recusa clientes sem domínio', async () => {
    expect((await http('POST', '/emails', { ...input, to: 'client@example.test' }, owner, company, randomUUID())).statusCode).toBe(400);
    expect((await http('POST', '/emails/test', { scenario: 'DELIVERED' }, owner, company, randomUUID())).json().to).toBe('delivered@resend.dev');
    expect((await http('POST', '/emails/test', {}, owner, company, randomUUID())).json().to).toBe('owner@example.test');
  });
  it('grava tentativa antes do HTTP, usa chave e payload estáveis e aceita sem afirmar entrega', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    vi.mocked(fetch).mockImplementationOnce(async (_url, options) => {
      expect((await row(queued.id))).toMatchObject({ sendStatus: 'SENDING', attempts: 1, mayHaveSent: true });
      expect((options!.headers as Record<string, string>)['Idempotency-Key']).toBe(`gestaonf-email/${queued.id}`);
      expect(JSON.parse(options!.body as string)).toMatchObject({ from: 'GestãoNF <onboarding@resend.dev>', to: input.to });
      return new Response(JSON.stringify({ id: randomUUID() }));
    });
    await dispatcher.dispatchOne(); expect(await row(queued.id)).toMatchObject({ sendStatus: 'ACCEPTED', deliveryStatus: 'PENDING', attempts: 1 });
  });
  it('retenta falha transitória com mesmo corpo/chave, respeita Retry-After', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'private data must not be logged' }), { status: 429, headers: { 'retry-after': '300' } }));
    await dispatcher.dispatchOne();
    const retry = await row(queued.id); expect(retry.sendStatus).toBe('RETRYING'); expect(retry.mayHaveSent).toBe(false); expect(retry.availableAt.getTime()).toBeGreaterThan(Date.now() + 290_000);
    await makeDue(queued.id); await dispatcher.dispatchOne();
    expect(await row(queued.id)).toMatchObject({ sendStatus: 'ACCEPTED', attempts: 2 });
    expect(vi.mocked(fetch).mock.calls[0][1]!.body).toBe(vi.mocked(fetch).mock.calls[1][1]!.body);
    expect(vi.mocked(fetch).mock.calls[0][1]!.headers).toEqual(vi.mocked(fetch).mock.calls[1][1]!.headers);
  });
  it('falha permanente não é retentada nem publica erro bruto', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'validation_error', message: 'email secret details' }), { status: 403 }));
    await dispatcher.dispatchOne(); expect(await row(queued.id)).toMatchObject({ sendStatus: 'FAILED', lastErrorCode: 'validation_error', mayHaveSent: false });
    await makeDue(queued.id); await dispatcher.dispatchOne(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('rede ambígua e janela expirada param em UNKNOWN sem reenviar', async () => {
    const queued = await emails.send(ctx(), input, randomUUID()); vi.mocked(fetch).mockRejectedValueOnce(new Error('timeout'));
    await dispatcher.dispatchOne(); expect(await row(queued.id)).toMatchObject({ sendStatus: 'RETRYING', mayHaveSent: true });
    await db.update(s.emailMessages).set({ firstAttemptAt: new Date(Date.now() - 24 * 60 * 60_000) }).where(eq(s.emailMessages.id, queued.id));
    await makeDue(queued.id); await dispatcher.dispatchOne(); expect((await row(queued.id)).sendStatus).toBe('UNKNOWN'); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('workers concorrentes não enviam o mesmo registro duas vezes; lease vencido é recuperado', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    await Promise.all(Array.from({ length: 5 }, () => dispatcher.dispatchOne())); expect(fetch).toHaveBeenCalledTimes(1);
    await db.update(s.emailMessages).set({ sendStatus: 'SENDING', providerEmailId: null, acceptedAt: null, leaseUntil: new Date(Date.now() - 1000), leaseToken: randomUUID() }).where(eq(s.emailMessages.id, queued.id));
    await makeDue(queued.id); await dispatcher.dispatchOne(); expect(fetch).toHaveBeenCalledTimes(2); expect((await row(queued.id)).sendStatus).toBe('ACCEPTED');
  });
  it('rollback da transação de negócio também desfaz o e-mail', async () => {
    await expect(db.transaction(async tx => { await emails.enqueueInTx(tx, ctx(), input, randomUUID(), 'PROPOSAL'); throw new Error('rollback'); })).rejects.toThrow('rollback');
    expect((await db.select({ value: count() }).from(s.emailMessages))[0].value).toBe(0);
  });
  it('valida assinatura/corpo/timestamp e deduplica eventos fora de ordem', async () => {
    const queued = await emails.send(ctx(), input, randomUUID()); await dispatcher.dispatchOne(); const saved = await row(queued.id);
    expect((await event('email.delivered', saved.providerEmailId!, undefined, undefined, true)).statusCode).toBe(401);
    expect((await event('email.delivered', saved.providerEmailId!, undefined, Math.floor(Date.now() / 1000) - 3600)).statusCode).toBe(401);
    const eventId = `msg_${randomUUID()}`;
    expect((await event('email.delivered', saved.providerEmailId!, eventId)).statusCode).toBe(200);
    await event('email.delivered', saved.providerEmailId!, eventId); await event('email.sent', saved.providerEmailId!); await event('email.delivery_delayed', saved.providerEmailId!);
    expect((await row(queued.id)).deliveryStatus).toBe('DELIVERED');
    expect((await db.select({ value: count() }).from(s.emailEvents))[0].value).toBe(3);
    await event('email.complained', saved.providerEmailId!); await event('email.delivered', saved.providerEmailId!); expect((await row(queued.id)).deliveryStatus).toBe('COMPLAINED');
  });
  it('evento anterior à resposta do envio é conciliado ao confirmar provider id', async () => {
    const queued = await emails.send(ctx(), input, randomUUID()), emailId = randomUUID();
    await event('email.delivered', emailId);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: emailId }))); await dispatcher.dispatchOne();
    expect((await row(queued.id)).deliveryStatus).toBe('DELIVERED');
  });
  it('isola histórico por empresa, protege conteúdo e respeita revogação antes do worker', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    expect((await http('GET', `/emails/${queued.id}`, undefined, owner, otherCompany)).statusCode).toBe(404);
    expect((await http('GET', `/emails/${queued.id}`, undefined, collaborator)).statusCode).toBe(404);
    await db.update(s.companyUsers).set({ status: 'INACTIVE' }).where(eq(s.companyUsers.userId, owner));
    await dispatcher.dispatchOne(); expect((await row(queued.id)).lastErrorCode).toBe('company_access_revoked'); expect(fetch).not.toHaveBeenCalled();
  });
  it('admissão concorrente respeita limite diário e desativação', async () => {
    provider.config.dailyLimit = 1;
    const results = await Promise.allSettled(Array.from({ length: 3 }, () => emails.send(ctx(), input, randomUUID())));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    provider.config.enabled = false; expect((await http('POST', '/emails', input, owner, company, randomUUID())).statusCode).toBe(503);
  });
  it('troca de modo/remetente ou perda de permissão encerra pendências sem emitir', async () => {
    const queued = await emails.send(ctx(), input, randomUUID());
    provider.config.from = 'GestãoNF <mail@example.test>'; provider.config.testMode = false;
    await dispatcher.dispatchOne(); expect((await row(queued.id)).lastErrorCode).toBe('configuration_changed');
    provider.config.from = 'GestãoNF <onboarding@resend.dev>'; provider.config.testMode = true;
    const another = await emails.send(ctx(), input, randomUUID());
    await db.update(s.companyUsers).set({ role: 'COLLABORATOR' }).where(eq(s.companyUsers.userId, owner));
    await dispatcher.dispatchOne(); expect((await row(another.id)).lastErrorCode).toBe('send_permission_revoked'); expect(fetch).not.toHaveBeenCalled();
  });
  it('rejeição em produção bloqueia próximos envios e mensagens já enfileiradas', async () => {
    provider.config.from = 'GestãoNF <mail@example.test>'; provider.config.testMode = false;
    const first = await emails.send(ctx(), input, randomUUID()), second = await emails.send(ctx(), input, randomUUID());
    await db.update(s.emailMessages).set({ sendStatus: 'FAILED', deliveryStatus: 'BOUNCED' }).where(eq(s.emailMessages.id, first.id));
    await expect(emails.send(ctx(), input, randomUUID())).rejects.toMatchObject({ status: 409 });
    await dispatcher.dispatchOne(); expect((await row(second.id)).lastErrorCode).toBe('recipient_suppressed'); expect(fetch).not.toHaveBeenCalled();
  });
  it('cota mensal é definitiva; cota diária aguarda virada UTC', async () => {
    const first = await emails.send(ctx(), input, randomUUID());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'monthly_quota_exceeded' }), { status: 429 }));
    await dispatcher.dispatchOne(); expect((await row(first.id)).sendStatus).toBe('FAILED'); await makeDue(first.id);
    const second = await emails.send(ctx(), input, randomUUID());
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ name: 'daily_quota_exceeded' }), { status: 429 }));
    await dispatcher.dispatchOne(); const saved = await row(second.id);
    const midnight = new Date(); midnight.setUTCHours(24, 0, 0, 0);
    expect(saved.availableAt.getTime()).toBeGreaterThanOrEqual(midnight.getTime() - 1000);
    expect(['RETRYING', 'FAILED']).toContain(saved.sendStatus); expect(saved.mayHaveSent).toBe(false);
  });
});
