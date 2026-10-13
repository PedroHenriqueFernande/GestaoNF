import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookie from '@fastify/cookie';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import sharp from 'sharp';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { count, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { FilesModule } from '../src/files/files.module.js';
import { FilesService } from '../src/files/files.service.js';
import { ObjectNotUploaded, R2StorageService } from '../src/files/r2-storage.service.js';
import { SalesModule } from '../src/sales/sales.module.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_files_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const secret = 'files-isolated-test-secret-with-at-least-32-characters';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, files: FilesService, storage: R2StorageService;
let owner: string, seller: string, other: string, company: string, companyB: string, serviceId: string, customerId: string;
let pdf: Buffer, png: Buffer;
const objects = new Map<string, { body: Buffer; mimeType: string }>();
const ctx = (userId = owner, companyId = company) => ({ userId, companyId });
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] }) class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, FilesModule, SalesModule] }) class TestAppModule {}
async function http(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, userId = owner, companyId = company, key?: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId, ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
}
function saleInput(attachmentIds?: string[]) { return { customerId, soldOn: '2026-10-13', ...(attachmentIds ? { attachmentIds } : {}), items: [{ serviceId, quantity: '1.0000', unitPrice: '5000.00' }], installments: [{ paymentMethod: 'PIX', amount: '5000.00', dueOn: '2026-10-20' }] }; }
async function pending(body = pdf, mimeType: 'application/pdf' | 'image/png' = 'application/pdf', userId = owner) {
  const res = await http('POST', '/files/uploads', { fileName: mimeType === 'application/pdf' ? 'Contrato João.pdf' : 'foto.png', mimeType, sizeBytes: body.length }, userId, company, randomUUID());
  expect(res.statusCode).toBe(201);
  const id = res.json().file.id as string;
  const [row] = await db.select().from(s.storedFiles).where(eq(s.storedFiles.id, id));
  return { id, row, body, userId };
}
async function ready(body = pdf, mimeType: 'application/pdf' | 'image/png' = 'application/pdf', userId = owner) {
  const upload = await pending(body, mimeType, userId);
  objects.set(upload.row.stagingKey, { body, mimeType });
  const res = await http('POST', `/files/${upload.id}/complete`, {}, userId); expect(res.statusCode).toBe(200);
  return upload;
}
beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../../../packages/database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s });
  for (const [name, value] of Object.entries({ JWT_SECRET: secret, R2_ENABLED: 'true', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'private-test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_ENDPOINT: '', R2_COMPANY_QUOTA_BYTES: '1073741824' })) vi.stubEnv(name, value);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
  storage = app.get(R2StorageService); files = app.get(FilesService);
  const document = await PDFDocument.create(); document.addPage(); pdf = Buffer.from(await document.save());
  png = await sharp({ create: { width: 8, height: 6, channels: 3, background: '#147b92' } }).png().toBuffer();
}, 60_000);
beforeEach(async () => {
  await db.delete(s.storedFiles);
  objects.clear();
  vi.spyOn(storage, 'signUpload').mockResolvedValue('https://upload.example.test/temporary');
  vi.spyOn(storage, 'head').mockImplementation(async (_bucket, key) => { const o = objects.get(key); if (!o) throw new ObjectNotUploaded(); return { sizeBytes: o.body.length, mimeType: o.mimeType, etag: createHash('sha256').update(o.body).digest('hex') }; });
  vi.spyOn(storage, 'read').mockImplementation(async (_bucket, key) => { const o = objects.get(key); if (!o) throw new ObjectNotUploaded(); return { body: Buffer.from(o.body), mimeType: o.mimeType }; });
  vi.spyOn(storage, 'put').mockImplementation(async (_bucket, key, body, mimeType) => { objects.set(key, { body, mimeType }); });
  vi.spyOn(storage, 'remove').mockImplementation(async (_bucket, key) => { objects.delete(key); });
  vi.spyOn(storage, 'signDownload').mockResolvedValue('https://download.example.test/private');
  const insertedUsers = await db.insert(s.users).values(['Gestor', 'Vendedor', 'Outro'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning(); [owner, seller, other] = insertedUsers.map(u => u.id);
  const accountId = await testAccount(db, owner);
  const insertedCompanies = await db.insert(s.companies).values([{ accountId, name: 'Empresa A' }, { accountId, name: 'Empresa B' }]).returning(); [company, companyB] = insertedCompanies.map(c => c.id);
  await db.insert(s.companyUsers).values([{ companyId: company, userId: owner, role: 'OWNER' }, { companyId: companyB, userId: owner, role: 'OWNER' }, { companyId: company, userId: seller, role: 'COLLABORATOR' }, { companyId: company, userId: other, role: 'COLLABORATOR' }]);
  [serviceId] = (await db.insert(s.services).values({ companyId: company, name: 'CRM' }).returning()).map(s => s.id);
  [customerId] = (await db.insert(s.customers).values({ companyId: company, kind: 'PF', name: 'Cliente' }).returning()).map(s => s.id);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_files_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});

describe('arquivos: HTTP, PostgreSQL e armazenamento simulado', () => {
  it('publica contratos no Swagger e exige autenticação e empresa', async () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/files/uploads'].post?.requestBody).toBeTruthy();
    expect((await app.inject({ method: 'POST', url: '/files/uploads', payload: {} })).statusCode).toBe(401);
    expect((await http('GET', '/files/capabilities', undefined, seller, companyB)).statusCode).toBe(403);
    expect((await http('GET', '/files/capabilities')).json()).toMatchObject({ enabled: true, mimeTypes: ['image/jpeg', 'image/png', 'application/pdf'], maxAttachments: 10 });
  });
  it('recusa tipos, tamanho excessivo e empresa enviada no corpo', async () => {
    for (const body of [{ fileName: 'a.svg', mimeType: 'image/svg+xml', sizeBytes: 12 }, { fileName: 'a.png', mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 + 1 }, { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 25 * 1024 * 1024 + 1 }, { fileName: 'a.pdf', mimeType: 'application/pdf', sizeBytes: 10, companyId: companyB }]) expect((await http('POST', '/files/uploads', body, owner, company, randomUUID())).statusCode).toBe(400);
  });
  it('reserva uma vez em chamadas concorrentes e detecta chave com dados diferentes', async () => {
    const key = randomUUID(), input = { fileName: 'Contrato.pdf', mimeType: 'application/pdf' as const, sizeBytes: pdf.length };
    const results = await Promise.all(Array.from({ length: 5 }, () => files.begin(ctx(), input, key)));
    expect(new Set(results.map(r => r.file.id)).size).toBe(1);
    await expect(files.begin(ctx(), { ...input, fileName: 'Outro.pdf' }, key)).rejects.toMatchObject({ status: 409 });
  });
  it('finaliza PDF com bytes originais, hash, tamanho e chave definitiva diferente', async () => {
    const file = await ready();
    expect(objects.get(file.row.objectKey)?.body.equals(pdf)).toBe(true);
    const [row] = await db.select().from(s.storedFiles).where(eq(s.storedFiles.id, file.id));
    expect(row.sha256).toBe(createHash('sha256').update(pdf).digest('hex')); expect(row.pageCount).toBe(1);
    const detail = (await http('GET', `/files/${file.id}`)).json();
    expect(detail).toMatchObject({ status: 'READY', sizeBytes: pdf.length });
    for (const field of ['bucket', 'objectKey', 'stagingKey', 'requestHash', 'requestKey']) expect(detail).not.toHaveProperty(field);
  });
  it('finalização concorrente é idempotente e PUT reutilizado não muda arquivo aceito', async () => {
    const upload = await pending(); objects.set(upload.row.stagingKey, { body: pdf, mimeType: 'application/pdf' });
    await Promise.all(Array.from({ length: 3 }, () => files.complete(ctx(), upload.id)));
    expect(storage.put).toHaveBeenCalledTimes(1);
    objects.set(upload.row.stagingKey, { body: Buffer.from('changed'), mimeType: 'application/pdf' });
    await files.complete(ctx(), upload.id); expect(storage.put).toHaveBeenCalledTimes(1);
    expect(objects.get(upload.row.objectKey)?.body.equals(pdf)).toBe(true);
  });
  it('upload ausente retorna conflito; conteúdo falso é rejeitado sem publicar objeto', async () => {
    const upload = await pending(); expect((await http('POST', `/files/${upload.id}/complete`, {})).statusCode).toBe(409);
    const bad = await pending(Buffer.from('fake'), 'image/png'); objects.set(bad.row.stagingKey, { body: Buffer.from('fake'), mimeType: 'image/png' });
    expect((await http('POST', `/files/${bad.id}/complete`, {})).statusCode).toBe(400);
    expect(objects.has(bad.row.objectKey)).toBe(false);
    expect((await http('GET', `/files/${bad.id}`)).json().status).toBe('REJECTED');
    expect((await http('GET', `/files/${bad.id}/access`)).statusCode).toBe(410);
  });
  it('verifica MIME/tamanho real, processa imagem e permite download apenas após READY', async () => {
    const upload = await pending(png, 'image/png'); objects.set(upload.row.stagingKey, { body: png, mimeType: 'application/pdf' });
    expect((await http('POST', `/files/${upload.id}/complete`, {})).statusCode).toBe(400);
    const image = await ready(png, 'image/png'); expect((await http('GET', `/files/${image.id}`)).json()).toMatchObject({ width: 8, height: 6 });
    expect((await http('GET', `/files/${image.id}/access`)).statusCode).toBe(200);
    expect(storage.signDownload).toHaveBeenCalledWith(image.row.bucket, image.row.objectKey, 'foto.png', 'image/png', true, 120);
  });
  it('isola empresas e uploads privados entre colaboradores; inativação revoga acesso', async () => {
    const file = await ready(pdf, 'application/pdf', seller);
    expect((await http('GET', `/files/${file.id}/access`, undefined, owner, companyB)).statusCode).toBe(404);
    expect((await http('GET', `/files/${file.id}/access`, undefined, other)).statusCode).toBe(404);
    expect((await http('GET', '/files', undefined, other)).json().items).toHaveLength(0);
    expect((await http('GET', `/files/${file.id}/access`, undefined, owner)).statusCode).toBe(200);
    await db.update(s.users).set({ status: 'INACTIVE' }).where(eq(s.users.id, seller));
    expect((await http('GET', `/files/${file.id}/access`, undefined, seller)).statusCode).toBe(401);
  });
  it('associa anexo na criação, preserva em edição antiga e remove ao salvar array vazio', async () => {
    const file = await ready();
    const created = await http('POST', '/sales', saleInput([file.id]), owner, company, randomUUID()); expect(created.statusCode).toBe(201);
    expect(created.json().attachments.map((f: { id: string }) => f.id)).toEqual([file.id]);
    const saleId = created.json().id;
    expect((await http('DELETE', `/files/${file.id}`)).statusCode).toBe(409);
    const preserved = await http('PATCH', `/sales/${saleId}`, { ...saleInput(), expectedVersion: 1 }); expect(preserved.statusCode).toBe(200); expect(preserved.json().attachments).toHaveLength(1);
    const removed = await http('PATCH', `/sales/${saleId}`, { ...saleInput([]), expectedVersion: 2 }); expect(removed.statusCode).toBe(200); expect(removed.json().attachments).toHaveLength(0);
    expect((await http('GET', `/files/${file.id}/access`)).statusCode).toBe(410);
  });
  it('não anexa upload pendente/de outra empresa e rollback não deixa pedido parcial', async () => {
    const file = await pending();
    const before = (await db.select({ n: count() }).from(s.sales))[0].n;
    expect((await http('POST', '/sales', saleInput([file.id]), owner, company, randomUUID())).statusCode).toBe(400);
    expect((await db.select({ n: count() }).from(s.sales))[0].n).toBe(before);
    const available = await ready();
    const [otherCustomer] = await db.insert(s.customers).values({ companyId: companyB, kind: 'PF', name: 'Outro' }).returning();
    expect((await http('POST', '/sales', { customerId: otherCustomer.id, attachmentIds: [available.id] }, owner, companyB, randomUUID())).statusCode).toBe(400);
  });
  it('anexo associado segue acesso da venda mas não pode ser usado por outra venda', async () => {
    const file = await ready(pdf, 'application/pdf', seller);
    const first = await http('POST', '/sales', saleInput([file.id]), seller, company, randomUUID()); expect(first.statusCode).toBe(201);
    expect((await http('GET', `/files/${file.id}/access`, undefined, other)).statusCode).toBe(200);
    expect((await http('POST', '/sales', saleInput([file.id]), owner, company, randomUUID())).statusCode).toBe(400);
    expect((await http('PATCH', `/sales/${first.json().id}`, { ...saleInput([file.id]), expectedVersion: 1 }, other)).statusCode).toBe(200);
  });
  it('edição de venda confirmada conserva anexo e financeiro; conflito mantém vínculo', async () => {
    const file = await ready(); const created = (await http('POST', '/sales', saleInput([file.id]), owner, company, randomUUID())).json();
    const confirmed = (await http('POST', `/sales/${created.id}/confirm`, { expectedVersion: 1, initialReceipts: [] })).json();
    expect(confirmed.status).toBe('CONFIRMED');
    const update = { ...saleInput([file.id]), items: confirmed.items.map((i: { id: string }) => ({ ...saleInput().items[0], id: i.id })), installments: confirmed.installments.map((i: { id: string }) => ({ ...saleInput().installments[0], id: i.id })), expectedVersion: confirmed.version };
    const saved = await http('PATCH', `/sales/${created.id}/confirmed`, update); expect(saved.statusCode).toBe(200);
    expect(saved.json().attachments).toHaveLength(1); expect(saved.json().installments[0].paycode).toBe(confirmed.installments[0].paycode);
    const stale = { ...update, attachmentIds: [], items: saved.json().items.map((i: { id: string }) => ({ ...saleInput().items[0], id: i.id })) };
    expect((await http('PATCH', `/sales/${created.id}/confirmed`, stale)).statusCode).toBe(409);
    expect((await http('GET', `/sales/${created.id}`)).json().attachments).toHaveLength(1);
  });
  it('cancelamento preserva contrato e exclusão é retomada após falha do armazenamento', async () => {
    const file = await ready(); const created = (await http('POST', '/sales', saleInput([file.id]), owner, company, randomUUID())).json();
    const canceled = await http('POST', `/sales/${created.id}/cancel`, { expectedVersion: 1, reason: 'Cancelamento solicitado' }); expect(canceled.statusCode).toBe(201); expect(canceled.json().attachments).toHaveLength(1);
    const disposable = await ready(); await http('DELETE', `/files/${disposable.id}`);
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error('temporary'));
    expect((await files.cleanup()).failed).toBe(1);
    expect((await http('GET', `/files/${disposable.id}`)).json().status).toBe('DELETING');
    await files.cleanup(); expect((await http('GET', `/files/${disposable.id}`)).json().status).toBe('DELETED');
    expect(objects.has(disposable.row.objectKey)).toBe(false);
  });
  it('limpa temporário somente após vencimento e expira upload sem venda abandonado', async () => {
    const file = await ready(); await files.cleanup(); expect(objects.has(file.row.stagingKey)).toBe(true);
    await db.update(s.storedFiles).set({ expiresAt: new Date(Date.now() - 120_000) }).where(eq(s.storedFiles.id, file.id));
    await files.cleanup(); expect(objects.has(file.row.stagingKey)).toBe(false); expect(objects.has(file.row.objectKey)).toBe(true);
    await db.update(s.storedFiles).set({ unattachedExpiresAt: new Date(Date.now() - 1000) }).where(eq(s.storedFiles.id, file.id));
    await files.cleanup(); expect(objects.has(file.row.objectKey)).toBe(false); expect((await http('GET', `/files/${file.id}`)).json().status).toBe('EXPIRED');
    const upload = await pending(); objects.set(upload.row.stagingKey, { body: pdf, mimeType: 'application/pdf' }); objects.set(upload.row.objectKey, { body: pdf, mimeType: 'application/pdf' });
    await db.update(s.storedFiles).set({ expiresAt: new Date(Date.now() - 120_000) }).where(eq(s.storedFiles.id, upload.id));
    await files.cleanup(); expect(objects.has(upload.row.objectKey)).toBe(false); expect(objects.has(upload.row.stagingKey)).toBe(false);
  });
  it('reserva quota e limite de uploads de forma concorrente', async () => {
    const previousQuota = storage.config!.companyQuotaBytes; storage.config!.companyQuotaBytes = 25 * 1024 * 1024;
    try {
      const input = { fileName: 'a.png', mimeType: 'image/png' as const, sizeBytes: 8 * 1024 * 1024 };
      const attempts = await Promise.allSettled([files.begin(ctx(), input, randomUUID()), files.begin(ctx(), input, randomUUID())]);
      expect(attempts.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(attempts.filter(r => r.status === 'rejected')).toHaveLength(1);
    } finally { storage.config!.companyQuotaBytes = previousQuota; }
    for (let index = 0; index < 19; index++) await pending();
    expect((await http('POST', '/files/uploads', { fileName: 'one.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length }, owner, company, randomUUID())).statusCode).toBe(409);
  });
});
