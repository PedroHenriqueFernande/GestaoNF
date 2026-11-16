import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, HttpException, Logger, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, eq, inArray } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { CompaniesModule } from '../src/companies/companies.module.js';
import { FilesModule } from '../src/files/files.module.js';
import { CompanyLogoService } from '../src/companies/company-logo.service.js';
import { InvalidStoredContent, ObjectNotUploaded, R2StorageService } from '../src/files/r2-storage.service.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_logo_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const secret = 'company-logo-isolated-test-secret-with-32-chars-minimum';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, storage: R2StorageService;
let owner: string, adminUser: string, manager: string, collaborator: string, outsider: string, company: string, companyB: string;
let png: Buffer;
const objects = new Map<string, { body: Buffer; mimeType: string }>();
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] }) class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, FilesModule, CompaniesModule] }) class TestAppModule {}

async function http(method: 'GET' | 'POST' | 'PATCH' | 'PUT', url: string, body?: unknown, userId = owner, companyId: string | null = company, key?: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...(companyId ? { 'x-company-id': companyId } : {}), ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
}
const image = (width = 1080, height = 1080) => sharp({ create: { width, height, channels: 3, background: '#147b92' } }).png().toBuffer();
const reserve = (body = png, userId = owner, companyId = company, key: string = randomUUID()) =>
  http('POST', '/companies/current/logo/uploads', { mimeType: 'image/png', sizeBytes: body.length }, userId, companyId, key);
async function pending(body = png, userId = owner, companyId = company) {
  const res = await reserve(body, userId, companyId); expect(res.statusCode).toBe(201);
  const id = res.json().file.id as string;
  const [row] = await db.select().from(s.companyLogoFiles).where(eq(s.companyLogoFiles.id, id));
  return { id, row };
}
async function ready(body = png, userId = owner, companyId = company) {
  const upload = await pending(body, userId, companyId);
  objects.set(upload.row.stagingKey, { body, mimeType: 'image/png' });
  const res = await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {}, userId, companyId);
  expect(res.statusCode).toBe(200);
  return upload;
}
async function activate(body = png, userId = owner, companyId = company) {
  const upload = await ready(body, userId, companyId);
  const res = await http('PUT', '/companies/current/logo', { logoId: upload.id }, userId, companyId);
  expect(res.statusCode).toBe(200);
  return upload;
}
/** Linha de arquivo inserida direto no banco (estado que a API sozinha demoraria a produzir). */
const insertFile = async (overrides: Partial<typeof s.companyLogoFiles.$inferInsert> = {}) => {
  const id = randomUUID();
  const [row] = await db.insert(s.companyLogoFiles).values({ id, companyId: company, createdByUserId: owner, requestKey: randomUUID(), requestHash: 'a'.repeat(64), inputMimeType: 'image/png', expectedBytes: 10, bucket: 'private-test',
    stagingKey: `s/${id}`, objectKey: `o/${id}`, thumbObjectKey: `t/${id}`, status: 'DELETED', uploadExpiresAt: new Date(Date.now() - 3_600_000), stagingCleanedAt: new Date(), objectDeletedAt: new Date(), ...overrides }).returning();
  return row;
};
const fileRow = async (id: string) => (await db.select().from(s.companyLogoFiles).where(eq(s.companyLogoFiles.id, id)))[0];
const companyRow = async (id = company) => (await db.select().from(s.companies).where(eq(s.companies.id, id)))[0];

beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s });
  for (const [name, value] of Object.entries({ JWT_SECRET: secret, R2_ENABLED: 'true', R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'private-test', R2_ACCESS_KEY_ID: 'test-access', R2_SECRET_ACCESS_KEY: 'test-secret', R2_ENDPOINT: '', R2_COMPANY_QUOTA_BYTES: '1073741824' })) vi.stubEnv(name, value);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
  storage = app.get(R2StorageService);
  png = await image();
}, 60_000);
beforeEach(async () => {
  await db.update(s.companies).set({ logoId: null });
  await db.delete(s.companyLogoFiles);
  objects.clear();
  vi.spyOn(storage, 'signUpload').mockResolvedValue('https://upload.example.test/temporary');
  vi.spyOn(storage, 'head').mockImplementation(async (_bucket, key) => { const o = objects.get(key); if (!o) throw new ObjectNotUploaded(); return { sizeBytes: o.body.length, mimeType: o.mimeType, etag: createHash('sha256').update(o.body).digest('hex') }; });
  vi.spyOn(storage, 'read').mockImplementation(async (_bucket, key) => { const o = objects.get(key); if (!o) throw new ObjectNotUploaded(); return { body: Buffer.from(o.body), mimeType: o.mimeType }; });
  vi.spyOn(storage, 'put').mockImplementation(async (_bucket, key, body, mimeType) => { objects.set(key, { body, mimeType }); });
  vi.spyOn(storage, 'remove').mockImplementation(async (_bucket, key) => { objects.delete(key); });
  vi.spyOn(storage, 'signDownload').mockImplementation(async (_bucket, key) => `https://download.example.test/${encodeURIComponent(key)}`);
  const users = await db.insert(s.users).values(['Dono', 'Admin', 'Gerente', 'Colaborador', 'Externo'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning();
  [owner, adminUser, manager, collaborator, outsider] = users.map(u => u.id);
  const accountId = await testAccount(db, owner);
  [company, companyB] = (await db.insert(s.companies).values([{ accountId, name: 'Empresa A' }, { accountId, name: 'Empresa B' }]).returning()).map(c => c.id);
  await db.insert(s.companyUsers).values([
    { companyId: company, userId: owner, role: 'OWNER' }, { companyId: company, userId: adminUser, role: 'ADMIN' },
    { companyId: company, userId: manager, role: 'MANAGER' }, { companyId: company, userId: collaborator, role: 'COLLABORATOR' },
    { companyId: companyB, userId: owner, role: 'OWNER' }, { companyId: companyB, userId: outsider, role: 'OWNER' },
  ]);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_logo_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});

describe('empresas: regra de gestão e logoId', () => {
  it('GET /companies inclui logoId e PATCH continua exigindo OWNER/ADMIN', async () => {
    const list = await http('GET', '/companies', undefined, owner, null);
    expect(list.statusCode).toBe(200);
    expect(list.json().find((c: { id: string }) => c.id === company)).toMatchObject({ logoId: null });
    expect((await http('PATCH', '/companies/current', { phone: '11999990000' }, collaborator)).statusCode).toBe(403);
    expect((await http('PATCH', '/companies/current', { phone: '11999990000' }, manager)).statusCode).toBe(403);
    const updated = await http('PATCH', '/companies/current', { phone: '11999990000' }, adminUser);
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ logoId: null, role: 'ADMIN' });
    expect((await http('PATCH', '/companies/current', { logoId: randomUUID() })).statusCode).toBe(400);
  });
});

describe('foto da empresa: reserva', () => {
  it('exige OWNER/ADMIN e vínculo com a empresa', async () => {
    expect((await reserve(png, collaborator)).statusCode).toBe(403);
    expect((await reserve(png, manager)).statusCode).toBe(403);
    expect((await reserve(png, outsider, company)).statusCode).toBe(403);
    const res = await reserve(png, adminUser);
    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.json()).toMatchObject({ file: { status: 'PENDING' }, upload: { method: 'PUT', headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, no-store' } } });
    const [row] = await db.select().from(s.companyLogoFiles).where(eq(s.companyLogoFiles.id, res.json().file.id));
    expect(row.stagingKey).toMatch(new RegExp(`^uploads/company-logos/${company}/${row.id}/`));
    expect(row.objectKey).toBe(`company-logos/${company}/${row.id}/logo.webp`);
    expect(row.thumbObjectKey).toBe(`company-logos/${company}/${row.id}/logo-128.webp`);
  });
  it('recusa corpo inválido', async () => {
    for (const body of [{ mimeType: 'image/svg+xml', sizeBytes: 10 }, { mimeType: 'image/gif', sizeBytes: 10 }, { mimeType: 'image/png', sizeBytes: 5 * 1024 * 1024 + 1 }, { mimeType: 'image/png', sizeBytes: 10, companyId: companyB }])
      expect((await http('POST', '/companies/current/logo/uploads', body, owner, company, randomUUID())).statusCode).toBe(400);
    expect((await http('POST', '/companies/current/logo/uploads', { mimeType: 'image/png', sizeBytes: 10 })).statusCode).toBe(400);
  });
  it('é idempotente por chave e detecta corpo diferente', async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => reserve(png, owner, company, key)));
    expect(results.every(r => r.statusCode === 201)).toBe(true);
    expect(new Set(results.map(r => r.json().file.id)).size).toBe(1);
    const other = await http('POST', '/companies/current/logo/uploads', { mimeType: 'image/png', sizeBytes: png.length + 1 }, owner, company, key);
    expect(other.statusCode).toBe(409);
    expect((await reserve(png, adminUser, company, key)).json().file.id).not.toBe(results[0].json().file.id);
  });
  it('limita pendências por empresa (429) sem afetar outra empresa', async () => {
    for (let i = 0; i < 3; i++) expect((await reserve()).statusCode).toBe(201);
    expect((await reserve()).statusCode).toBe(429);
    expect((await reserve(png, owner, companyB)).statusCode).toBe(201);
  });
  it('dez reservas simultâneas com chaves distintas respeitam o limite de 3 pendentes (lock por empresa)', async () => {
    // Direto no serviço: app.inject serializa transações curtas e esconderia a corrida.
    const logos = app.get(CompanyLogoService);
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => logos.begin({ companyId: company, userId: owner }, { mimeType: 'image/png', sizeBytes: 100 }, randomUUID())));
    const rows = await db.select().from(s.companyLogoFiles).where(eq(s.companyLogoFiles.companyId, company));
    expect(rows).toHaveLength(3);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected).toHaveLength(7);
    for (const r of rejected) expect((r.reason as HttpException).getStatus()).toBe(429);
  });
  it('cinco reservas simultâneas com a mesma chave resolvem para o mesmo arquivo', async () => {
    const logos = app.get(CompanyLogoService);
    const key = randomUUID();
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => logos.begin({ companyId: company, userId: owner }, { mimeType: 'image/png', sizeBytes: 100 }, key)));
    expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    expect(new Set(results.map(r => (r as PromiseFulfilledResult<{ file: { id: string } }>).value.file.id)).size).toBe(1);
    expect(await db.select().from(s.companyLogoFiles).where(eq(s.companyLogoFiles.companyId, company))).toHaveLength(1);
  });
  it('limita 5 reservas por minuto (429) mesmo sem pendências, sem afetar outra empresa', async () => {
    // Linhas já limpas (DELETED) não contam como pendentes, só como reservas recentes.
    for (let i = 0; i < 4; i++) await insertFile({ createdAt: new Date() });
    await insertFile({ createdAt: new Date(Date.now() - 120_000) });
    expect((await reserve()).statusCode).toBe(201); // 4 recentes + esta = 5; a antiga não conta
    await db.update(s.companyLogoFiles).set({ stagingCleanedAt: new Date(), objectDeletedAt: new Date(), status: 'DELETED' }).where(eq(s.companyLogoFiles.status, 'PENDING'));
    const blocked = await reserve();
    expect(blocked.statusCode).toBe(429);
    expect((await reserve(png, owner, companyB)).statusCode).toBe(201);
  });
  it('a foto atual não conta como pendência para o limite de 3', async () => {
    await activate();
    for (let i = 0; i < 3; i++) expect((await reserve()).statusCode).toBe(201);
    expect((await reserve()).statusCode).toBe(429);
  });
  it('R2 indisponível responde 503 e a listagem de empresas continua funcionando', async () => {
    vi.spyOn(storage, 'requireClient').mockImplementation(() => { throw new ServiceUnavailableException({ code: 'FILES_NOT_CONFIGURED', message: 'O envio de arquivos ainda não foi configurado.' }); });
    expect((await reserve()).statusCode).toBe(503);
    expect((await http('GET', '/companies', undefined, owner, null)).statusCode).toBe(200);
  });
});

describe('foto da empresa: finalização', () => {
  it('gera principal 1080 e miniatura 128 WebP, sem expor chaves', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    const res = await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {});
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ file: { status: 'READY', mimeType: 'image/webp', width: 1080, height: 1080, thumbnail: { width: 128, height: 128 } } });
    for (const field of ['bucket', 'objectKey', 'thumbObjectKey', 'stagingKey', 'requestKey', 'requestHash']) expect(res.json().file).not.toHaveProperty(field);
    const row = await fileRow(upload.id);
    expect((await sharp(objects.get(row.objectKey)!.body).metadata()).width).toBe(1080);
    expect((await sharp(objects.get(row.thumbObjectKey)!.body).metadata()).width).toBe(128);
    expect(row.unattachedExpiresAt!.getTime() - row.readyAt!.getTime()).toBe(86_400_000);
  });
  it('finalização concorrente ou repetida não reprocessa', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    const results = await Promise.all(Array.from({ length: 3 }, () => http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {})));
    expect(results.every(r => r.statusCode === 200)).toBe(true);
    expect(storage.put).toHaveBeenCalledTimes(2);
    const again = await reserve(png, owner, company, upload.row.requestKey);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ file: { id: upload.id, status: 'READY' }, upload: null });
  });
  it('upload ausente dá 409; conteúdo falso ou pequeno dá 400 e REJECTED', async () => {
    const missing = await pending();
    expect((await http('POST', `/companies/current/logo/uploads/${missing.id}/complete`, {})).statusCode).toBe(409);
    const fake = Buffer.from('not-a-png-but-same-size');
    const bad = await pending(fake);
    objects.set(bad.row.stagingKey, { body: fake, mimeType: 'image/png' });
    expect((await http('POST', `/companies/current/logo/uploads/${bad.id}/complete`, {})).statusCode).toBe(400);
    expect((await fileRow(bad.id)).status).toBe('REJECTED');
    const tiny = await image(500, 100);
    const small = await pending(tiny);
    objects.set(small.row.stagingKey, { body: tiny, mimeType: 'image/png' });
    const res = await http('POST', `/companies/current/logo/uploads/${small.id}/complete`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Imagem menor que 128 × 128 pixels');
  });
  it('outro criador ou outra empresa recebe 404; papel rebaixado recebe 403', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    expect((await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {}, adminUser)).statusCode).toBe(404);
    expect((await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {}, owner, companyB)).statusCode).toBe(404);
    const byAdmin = await pending(png, adminUser);
    await db.update(s.companyUsers).set({ role: 'COLLABORATOR' }).where(and(eq(s.companyUsers.companyId, company), eq(s.companyUsers.userId, adminUser)));
    expect((await http('POST', `/companies/current/logo/uploads/${byAdmin.id}/complete`, {}, adminUser)).statusCode).toBe(403);
  });
  it('COLLABORATOR e MANAGER recebem 403 na finalização; ADMIN conclui a própria reserva', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    for (const user of [collaborator, manager]) expect((await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {}, user)).statusCode).toBe(403);
    expect((await fileRow(upload.id)).status).toBe('PENDING');
    const byAdmin = await pending(png, adminUser);
    objects.set(byAdmin.row.stagingKey, { body: png, mimeType: 'image/png' });
    expect((await http('POST', `/companies/current/logo/uploads/${byAdmin.id}/complete`, {}, adminUser)).statusCode).toBe(200);
  });
  it('tamanho ou tipo do HEAD diferente do declarado dá 400 e REJECTED, sem ler o conteúdo', async () => {
    const bigger = await pending();
    objects.set(bigger.row.stagingKey, { body: Buffer.concat([png, Buffer.from([0])]), mimeType: 'image/png' });
    const res = await http('POST', `/companies/current/logo/uploads/${bigger.id}/complete`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('Tipo ou tamanho diferente do declarado');
    expect((await fileRow(bigger.id)).status).toBe('REJECTED');
    const wrongType = await pending();
    objects.set(wrongType.row.stagingKey, { body: png, mimeType: 'image/jpeg' });
    expect((await http('POST', `/companies/current/logo/uploads/${wrongType.id}/complete`, {})).json().message).toBe('Tipo ou tamanho diferente do declarado');
    expect((await fileRow(wrongType.id)).status).toBe('REJECTED');
    expect(storage.read).not.toHaveBeenCalled();
  });
  it('conteúdo alterado durante a finalização (ETag divergente) dá 400 e REJECTED, sem gravar variantes', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    vi.mocked(storage.read).mockRejectedValueOnce(new InvalidStoredContent('O arquivo foi alterado durante o envio. Selecione o arquivo novamente.'));
    const res = await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toBe('O arquivo foi alterado durante o envio. Selecione o arquivo novamente.');
    expect((await fileRow(upload.id)).status).toBe('REJECTED');
    expect(storage.put).not.toHaveBeenCalled();
  });
  it('R2 desligado na finalização responde 503 e mantém PENDING', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    vi.spyOn(storage, 'requireClient').mockImplementation(() => { throw new ServiceUnavailableException({ code: 'FILES_NOT_CONFIGURED', message: 'O envio de arquivos ainda não foi configurado.' }); });
    expect((await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {})).statusCode).toBe(503);
    expect(storage.head).not.toHaveBeenCalled();
    expect((await fileRow(upload.id)).status).toBe('PENDING');
  });
  it('falha do put dá 503, mantém PENDING, registra fileId no log e permite tentar de novo', async () => {
    const upload = await pending();
    objects.set(upload.row.stagingKey, { body: png, mimeType: 'image/png' });
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.mocked(storage.put).mockRejectedValueOnce(new Error('r2 down'));
    expect((await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {})).statusCode).toBe(503);
    expect((await fileRow(upload.id)).status).toBe('PENDING');
    expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: 'company_logo_complete', companyId: company, userId: owner, fileId: upload.id, errorType: 'Error' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(upload.row.stagingKey);
    const retry = await http('POST', `/companies/current/logo/uploads/${upload.id}/complete`, {});
    expect(retry.statusCode).toBe(200);
    expect((await fileRow(upload.id)).status).toBe('READY');
  });
});

describe('foto da empresa: associação', () => {
  it('associa, troca e remove mantendo no máximo uma ACTIVE', async () => {
    const first = await activate();
    expect((await companyRow()).logoId).toBe(first.id);
    expect((await fileRow(first.id)).status).toBe('ACTIVE');
    const second = await ready();
    const res = await http('PUT', '/companies/current/logo', { logoId: second.id });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: company, logoId: second.id, role: 'OWNER' });
    expect((await fileRow(first.id)).status).toBe('DELETING');
    expect((await fileRow(second.id)).status).toBe('ACTIVE');
    expect((await http('PUT', '/companies/current/logo', { logoId: second.id })).statusCode).toBe(200);
    const removed = await http('PUT', '/companies/current/logo', { logoId: null });
    expect(removed.json()).toMatchObject({ logoId: null });
    expect((await fileRow(second.id)).status).toBe('DELETING');
  });
  it('trocas simultâneas deixam exatamente uma foto ACTIVE', async () => {
    const a = await ready(), b = await ready(png, adminUser);
    const results = await Promise.all([http('PUT', '/companies/current/logo', { logoId: a.id }), http('PUT', '/companies/current/logo', { logoId: b.id }, adminUser)]);
    expect(results.every(r => r.statusCode === 200)).toBe(true);
    const active = await db.select().from(s.companyLogoFiles).where(and(eq(s.companyLogoFiles.companyId, company), eq(s.companyLogoFiles.status, 'ACTIVE')));
    expect(active).toHaveLength(1);
    expect((await companyRow()).logoId).toBe(active[0].id);
    const other = active[0].id === a.id ? b.id : a.id;
    expect((await fileRow(other)).status).toBe('DELETING');
  });
  it('recusa foto de outra empresa ou de outro criador; o banco rejeita logo_id cruzado', async () => {
    const foreign = await ready(png, owner, companyB);
    expect((await http('PUT', '/companies/current/logo', { logoId: foreign.id })).statusCode).toBe(404);
    const byOwner = await ready();
    expect((await http('PUT', '/companies/current/logo', { logoId: byOwner.id }, adminUser)).statusCode).toBe(404);
    await expect(db.update(s.companies).set({ logoId: foreign.id }).where(eq(s.companies.id, company))).rejects.toThrow();
  });
  it('o banco recusa linha READY incompleta (ready_chk, SQLSTATE 23514) e logo_id cruzado (23503)', async () => {
    const dbError = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return ((error as { cause?: unknown }).cause ?? error) as { code?: string; constraint_name?: string }; } throw new Error('esperava erro do banco'); };
    const valid = { companyId: company, createdByUserId: owner, requestHash: 'a'.repeat(64), inputMimeType: 'image/png', expectedBytes: 10, bucket: 'private-test', status: 'READY',
      uploadExpiresAt: new Date(Date.now() + 600_000), mimeType: 'image/webp', sizeBytes: 1000, width: 1080, height: 1080, sha256: 'b'.repeat(64), thumbSizeBytes: 100, thumbWidth: 128, thumbHeight: 128, readyAt: new Date() };
    const keys = () => { const id = randomUUID(); return { requestKey: randomUUID(), stagingKey: `s/${id}`, objectKey: `o/${id}`, thumbObjectKey: `t/${id}` }; };
    // Controle: a mesma linha, completa, é aceita.
    await db.insert(s.companyLogoFiles).values({ ...valid, ...keys() });
    // Cada coluna nula exigida pelo CHECK deve ser recusada (NULL no CHECK passaria sem as guardas IS NOT NULL).
    for (const column of ['mimeType', 'sizeBytes', 'width', 'height', 'thumbSizeBytes', 'thumbWidth', 'thumbHeight'] as const) {
      const error = await dbError(db.insert(s.companyLogoFiles).values({ ...valid, ...keys(), [column]: null }));
      expect(error.code, column).toBe('23514');
      expect(error.constraint_name, column).toBe('company_logo_files_ready_chk');
    }
    const foreign = await ready(png, owner, companyB);
    const cross = await dbError(db.update(s.companies).set({ logoId: foreign.id }).where(eq(s.companies.id, company)));
    expect(cross.code).toBe('23503');
    expect(cross.constraint_name).toBe('companies_logo_owner_fk');
  });
  it('COLLABORATOR e MANAGER recebem 403 no PUT; a empresa não muda', async () => {
    const first = await activate();
    const next = await ready();
    for (const user of [collaborator, manager]) {
      expect((await http('PUT', '/companies/current/logo', { logoId: next.id }, user)).statusCode).toBe(403);
      expect((await http('PUT', '/companies/current/logo', { logoId: null }, user)).statusCode).toBe(403);
    }
    expect((await companyRow()).logoId).toBe(first.id);
    expect((await fileRow(first.id)).status).toBe('ACTIVE');
    expect((await fileRow(next.id)).status).toBe('READY');
  });
  it('foto atual inconsistente (não ACTIVE) dá 409 e não altera nada', async () => {
    const orphan = await ready();
    await db.update(s.companies).set({ logoId: orphan.id }).where(eq(s.companies.id, company));
    const next = await ready();
    const swap = await http('PUT', '/companies/current/logo', { logoId: next.id });
    expect(swap.statusCode).toBe(409);
    expect(swap.json().message).toBe('Foto atual inconsistente. Recarregue a empresa.');
    expect((await http('PUT', '/companies/current/logo', { logoId: null })).statusCode).toBe(409);
    expect((await companyRow()).logoId).toBe(orphan.id);
    expect((await fileRow(next.id)).status).toBe('READY');
    expect((await fileRow(orphan.id)).status).toBe('READY');
  });
  it('não pronta dá 409, expirada dá 410, sem papel dá 403', async () => {
    const notReady = await pending();
    expect((await http('PUT', '/companies/current/logo', { logoId: notReady.id })).statusCode).toBe(409);
    const old = await ready();
    await db.update(s.companyLogoFiles).set({ unattachedExpiresAt: new Date(Date.now() - 1000) }).where(eq(s.companyLogoFiles.id, old.id));
    expect((await http('PUT', '/companies/current/logo', { logoId: old.id })).statusCode).toBe(410);
    expect((await http('PUT', '/companies/current/logo', { logoId: null }, collaborator)).statusCode).toBe(403);
    expect((await http('PUT', '/companies/current/logo', { logoId: 'x' })).statusCode).toBe(400);
  });
});

describe('foto da empresa: links em lote', () => {
  it('devolve só a miniatura das empresas com vínculo ativo e foto ACTIVE', async () => {
    expect((await http('GET', '/companies/logos/access', undefined, owner, null)).json()).toEqual({ items: [] });
    const a = await activate();
    const b = await activate(png, outsider, companyB);
    const mine = await http('GET', '/companies/logos/access', undefined, owner, null);
    expect(mine.statusCode).toBe(200);
    expect(mine.headers['cache-control']).toBe('private, no-store');
    const items = mine.json().items as { companyId: string; logoId: string; url: string; expiresAt: string }[];
    expect(items.map(i => i.companyId).sort()).toEqual([company, companyB].sort());
    const rowA = await fileRow(a.id);
    expect(items.find(i => i.companyId === company)).toMatchObject({ logoId: a.id, url: `https://download.example.test/${encodeURIComponent(rowA.thumbObjectKey)}`, expiresInSeconds: 120 });
    expect(storage.signDownload).toHaveBeenCalledWith(rowA.bucket, rowA.thumbObjectKey, 'logo-128.webp', 'image/webp', false, 120);
    const theirs = (await http('GET', '/companies/logos/access', undefined, outsider, null)).json().items;
    expect(theirs).toEqual([expect.objectContaining({ companyId: companyB, logoId: b.id })]);
    await db.update(s.companyUsers).set({ status: 'INACTIVE' }).where(and(eq(s.companyUsers.companyId, companyB), eq(s.companyUsers.userId, owner)));
    expect((await http('GET', '/companies/logos/access', undefined, owner, null)).json().items.map((i: { companyId: string }) => i.companyId)).toEqual([company]);
    await db.update(s.companies).set({ status: 'INACTIVE' }).where(eq(s.companies.id, company));
    expect((await http('GET', '/companies/logos/access', undefined, owner, null)).json()).toEqual({ items: [] });
  });
  it('não devolve empresa com contratação indisponível', async () => {
    await activate();
    const before = await http('GET', '/companies/logos/access', undefined, owner, null);
    expect(before.json().items).toHaveLength(1);
    const { accountId } = await companyRow();
    await db.update(s.accountSubscriptions).set({ status: 'SUSPENDED' }).where(eq(s.accountSubscriptions.accountId, accountId));
    expect((await http('GET', '/companies/logos/access', undefined, owner, null)).json()).toEqual({ items: [] });
  });
  it('recusa query desconhecida', async () => {
    expect((await http('GET', '/companies/logos/access?companyId=x', undefined, owner, null)).statusCode).toBe(400);
  });
});

describe('foto da empresa: limpeza', () => {
  const past = (ms: number) => new Date(Date.now() - ms);
  it('apaga substituída, rejeitada e abandonada, sem tocar na ativa', async () => {
    const logos = app.get(CompanyLogoService);
    const old = await activate();
    const current = await activate();
    const abandoned = await ready(png, adminUser);
    await db.update(s.companyLogoFiles).set({ unattachedExpiresAt: past(1000), uploadExpiresAt: past(120_000) }).where(eq(s.companyLogoFiles.id, abandoned.id));
    await db.update(s.companyLogoFiles).set({ uploadExpiresAt: past(120_000) }).where(inArray(s.companyLogoFiles.id, [old.id, current.id]));
    const stats = await logos.cleanup();
    expect(stats.failed).toBe(0);
    const [oldRow, currentRow, abandonedRow] = await Promise.all([fileRow(old.id), fileRow(current.id), fileRow(abandoned.id)]);
    expect(oldRow).toMatchObject({ status: 'DELETED' });
    expect(abandonedRow).toMatchObject({ status: 'EXPIRED' });
    for (const row of [oldRow, abandonedRow]) { expect(row.objectDeletedAt).not.toBeNull(); expect(objects.has(row.objectKey)).toBe(false); expect(objects.has(row.thumbObjectKey)).toBe(false); }
    expect(currentRow).toMatchObject({ status: 'ACTIVE', objectDeletedAt: null });
    expect(currentRow.stagingCleanedAt).not.toBeNull();
    expect(objects.has(currentRow.objectKey)).toBe(true);
    expect(objects.has(currentRow.thumbObjectKey)).toBe(true);
  });
  it('limpeza concorrente com associação não apaga a foto ativa nem deixa estado inválido', async () => {
    const logos = app.get(CompanyLogoService);
    const candidate = await ready();
    await db.update(s.companyLogoFiles).set({ unattachedExpiresAt: past(1000) }).where(eq(s.companyLogoFiles.id, candidate.id));
    const [put] = await Promise.all([http('PUT', '/companies/current/logo', { logoId: candidate.id }), logos.cleanup()]);
    const row = await fileRow(candidate.id);
    // Já vencida: o PUT nunca associa. Se o PUT travar primeiro, responde 410 e a limpeza pula a linha (SKIP LOCKED);
    // se a limpeza travar primeiro, a foto vira EXPIRED e o PUT responde 409.
    expect([409, 410]).toContain(put.statusCode);
    expect((await companyRow()).logoId).toBeNull();
    expect(['READY', 'EXPIRED']).toContain(row.status);
    if (row.status === 'EXPIRED') expect(row.objectDeletedAt).not.toBeNull();
  });
  it('não apaga arquivo ainda referenciado pela empresa, mesmo fora de ACTIVE', async () => {
    const logos = app.get(CompanyLogoService);
    const referenced = await activate();
    // Estado inconsistente de propósito: a empresa ainda aponta para uma foto marcada DELETING.
    await db.update(s.companyLogoFiles).set({ status: 'DELETING' }).where(eq(s.companyLogoFiles.id, referenced.id));
    await logos.cleanup();
    const row = await fileRow(referenced.id);
    expect(row).toMatchObject({ status: 'DELETING', objectDeletedAt: null });
    expect(objects.has(row.objectKey)).toBe(true);
    expect(objects.has(row.thumbObjectKey)).toBe(true);
    expect((await companyRow()).logoId).toBe(referenced.id);
  });
  it('com R2 desligado a limpeza não faz nada', async () => {
    const logos = app.get(CompanyLogoService);
    const old = await activate(); await activate();
    vi.spyOn(storage, 'enabled', 'get').mockReturnValue(false);
    expect(await logos.cleanup()).toEqual({ cleaned: 0, failed: 0 });
    expect(storage.remove).not.toHaveBeenCalled();
    expect((await fileRow(old.id)).status).toBe('DELETING');
  });
  it('falha do R2 conta como failed e o item volta no próximo ciclo', async () => {
    const logos = app.get(CompanyLogoService);
    const old = await activate(); await activate();
    vi.mocked(storage.remove).mockRejectedValueOnce(new Error('r2 down'));
    expect((await logos.cleanup()).failed).toBeGreaterThan(0);
    expect((await fileRow(old.id)).status).toBe('DELETING');
    await logos.cleanup();
    expect((await fileRow(old.id)).status).toBe('DELETED');
  });
});

describe('foto da empresa: contratos', () => {
  it('publica as rotas no Swagger e exige autenticação', async () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    expect(document.paths['/companies/current/logo/uploads'].post?.requestBody).toBeTruthy();
    expect(document.paths['/companies/current/logo'].put?.requestBody).toBeTruthy();
    expect(document.paths['/companies/logos/access'].get).toBeTruthy();
    expect((await app.inject({ method: 'GET', url: '/companies/logos/access' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'PUT', url: '/companies/current/logo', payload: { logoId: null } })).statusCode).toBe(401);
  });
});
