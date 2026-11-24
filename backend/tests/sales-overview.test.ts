import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { grantLegacyMembers } from './permission-fixtures.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { SignJWT } from 'jose';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { SalesModule } from '../src/sales/sales.module.js';
import { listSalesOverviewSchema } from '../src/sales/sales.schemas.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_overview_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const secret = 'sales-overview-isolated-test-secret-with-32-chars-min';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication;
// U: membro ativo de A (conta 1) e B (conta 2); vínculo INATIVO em C; membro de E (conta suspensa); sem vínculo com D.
let user: string, companyA: string, companyB: string, companyC: string, companyD: string, companyE: string, customerA: string, customerB: string;
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] }) class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, SalesModule] }) class TestAppModule {}

async function http(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, companyId?: string, userId = user) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, ...(companyId ? { 'x-company-id': companyId } : {}) } });
}
type SeedStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELED';
async function seedSale(companyId: string, customerId: string, values: { orderCode: string; status?: SeedStatus; total?: string; createdAt?: Date; customerName?: string; workOrderNumber?: string }) {
  const status = values.status ?? 'CONFIRMED', total = values.total ?? '100.00', at = values.createdAt ?? new Date();
  const [row] = await db.insert(s.sales).values({ companyId, customerId, orderCode: values.orderCode, customerKindSnapshot: 'PF', customerNameSnapshot: values.customerName ?? 'Cliente',
    status, soldOn: '2026-11-10', subtotalAmount: total, discountAmount: '0.00', totalAmount: total, createdByUserId: user, idempotencyKey: randomUUID(), requestHash: 'a'.repeat(64),
    workOrderNumber: values.workOrderNumber ?? null, confirmedAt: status === 'CONFIRMED' ? at : null, canceledAt: status === 'CANCELED' ? at : null, createdAt: at, updatedAt: at }).returning();
  return row;
}
const codes = (body: { items: { orderCode: string }[] }) => body.items.map(i => i.orderCode);

beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco isolado');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s });
  vi.stubEnv('JWT_SECRET', secret); vi.stubEnv('R2_ENABLED', 'false');
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
}, 60_000);
beforeEach(async () => {
  const users = await db.insert(s.users).values(['Usuário', 'Dono B', 'Outro', 'Dono E'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning();
  const [u, x, o, y] = users.map(row => row.id); user = u;
  const [accU, accX, accO, accY] = [await testAccount(db, u), await testAccount(db, x), await testAccount(db, o), await testAccount(db, y)];
  [companyA, companyC, companyB, companyD, companyE] = (await db.insert(s.companies).values([
    { accountId: accU, tradeName: 'Alfa' }, { accountId: accU, tradeName: 'Cinza' }, { accountId: accX, tradeName: 'Beta' }, { accountId: accO, tradeName: 'Delta' }, { accountId: accY, tradeName: 'Épsilon' },
  ]).returning()).map(c => c.id);
  await db.insert(s.companyUsers).values([
    { companyId: companyA, userId: u, role: 'OWNER' }, { companyId: companyC, userId: u, role: 'COLLABORATOR', status: 'INACTIVE' },
    { companyId: companyB, userId: x, role: 'OWNER' }, { companyId: companyB, userId: u, role: 'COLLABORATOR' },
    { companyId: companyD, userId: o, role: 'OWNER' }, { companyId: companyE, userId: y, role: 'OWNER' }, { companyId: companyE, userId: u, role: 'COLLABORATOR' },
  ]);
  await grantLegacyMembers(db);
  await db.update(s.accounts).set({ status: 'SUSPENDED' }).where(eq(s.accounts.id, accY));
  [customerA, customerB] = (await db.insert(s.customers).values([{ companyId: companyA, kind: 'PF', name: 'Cliente A' }, { companyId: companyB, kind: 'PF', name: 'Cliente B' }]).returning()).map(c => c.id);
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_overview_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});

describe('GET /sales (caracterização antes da extração)', () => {
  it('filtra por status e busca, pagina e ordena por created_at desc', async () => {
    const base = Date.parse('2026-11-01T12:00:00Z');
    for (let i = 0; i < 5; i++) await seedSale(companyA, customerA, { orderCode: `1000${i}`, createdAt: new Date(base + i * 60_000),
      status: i === 4 ? 'CANCELED' : i === 3 ? 'DRAFT' : 'CONFIRMED', customerName: i === 1 ? 'Maria Souza' : 'Cliente', workOrderNumber: i === 2 ? 'OS-77' : undefined });
    const all = (await http('GET', '/sales?limit=10', companyA)).json();
    expect(all.total).toBe(5);
    expect(codes(all)).toEqual(['10004', '10003', '10002', '10001', '10000']);
    expect(all.items[0]).toHaveProperty('createdByUserName', 'Usuário');
    expect(all.items[0]).toHaveProperty('companyId', companyA);
    for (const field of ['idempotencyKey', 'requestHash']) expect(all.items[0]).not.toHaveProperty(field);
    const page = (await http('GET', '/sales?limit=2&offset=2', companyA)).json();
    expect([codes(page), page.total, page.limit, page.offset]).toEqual([['10002', '10001'], 5, 2, 2]);
    expect((await http('GET', '/sales?status=CONFIRMED', companyA)).json().total).toBe(3);
    expect(codes((await http('GET', '/sales?status=DRAFT', companyA)).json())).toEqual(['10003']);
    expect(codes((await http('GET', '/sales?search=10001', companyA)).json())).toEqual(['10001']);
    expect(codes((await http('GET', '/sales?search=OS-7', companyA)).json())).toEqual(['10002']);
    expect(codes((await http('GET', '/sales?search=maria', companyA)).json())).toEqual(['10001']);
  });
  it('desempata created_at igual pelo id desc', async () => {
    const at = new Date('2026-11-02T12:00:00Z');
    const rows = [await seedSale(companyA, customerA, { orderCode: '20001', createdAt: at }), await seedSale(companyA, customerA, { orderCode: '20002', createdAt: at }), await seedSale(companyA, customerA, { orderCode: '20003', createdAt: at })];
    const expected = rows.map(r => r.id).sort().reverse();
    expect((await http('GET', '/sales', companyA)).json().items.map((i: { id: string }) => i.id)).toEqual(expected);
  });
});

describe('GET /sales/overview: escopo e isolamento', () => {
  beforeEach(async () => {
    await seedSale(companyA, customerA, { orderCode: '14872', createdAt: new Date('2026-11-03T10:00:00Z') });
    await seedSale(companyB, customerB, { orderCode: '14872', createdAt: new Date('2026-11-03T11:00:00Z') });
  });
  it('all devolve só empresas com vínculo ativo e contratação disponível', async () => {
    const res = await http('GET', '/sales/overview?companies=all');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const body = res.json();
    expect(body.companyIds).toEqual([companyA, companyB].sort());
    expect(body.items.map((i: { companyId: string }) => i.companyId)).toEqual([companyB, companyA]);
    expect(body.total).toBe(2);
    for (const field of ['idempotencyKey', 'requestHash']) expect(body.items[0]).not.toHaveProperty(field);
  });
  it('companyIds com empresa não autorizada dá 403 sem dados', async () => {
    for (const ids of [[companyA, companyD], [companyA, companyC], [companyA, companyE]]) {
      const res = await http('GET', `/sales/overview?companyIds=${ids.join(',')}`);
      expect(res.statusCode).toBe(403);
      expect(res.json()).not.toHaveProperty('items');
    }
    expect((await http('GET', `/sales/overview?companyIds=${companyA},${companyB}`)).statusCode).toBe(200);
  });
  it('revalida a cada requisição', async () => {
    await db.update(s.companyUsers).set({ status: 'INACTIVE' }).where(and(eq(s.companyUsers.companyId, companyB), eq(s.companyUsers.userId, user)));
    expect((await http('GET', '/sales/overview?companies=all')).json().companyIds).toEqual([companyA]);
    expect((await http('GET', `/sales/overview?companyIds=${companyA},${companyB}`)).statusCode).toBe(403);
  });
  it('usuário sem empresas disponíveis recebe 403 em all', async () => {
    const [lonely] = await db.insert(s.users).values({ name: 'Sem empresa', email: `${randomUUID()}@example.test` }).returning();
    expect((await http('GET', '/sales/overview?companies=all', undefined, lonely.id)).statusCode).toBe(403);
  });
  it('recusa entrada inválida com 400', async () => {
    const ids51 = Array.from({ length: 51 }, () => randomUUID()).join(',');
    for (const query of ['', `companies=all&companyIds=${companyA}`, 'companies=some', 'companyIds=x', `companyIds=${companyA},${companyA}`, `companyIds=${ids51}`, 'companies=all&customerId=' + randomUUID(), 'companies=all&foo=1', 'companies=all&limit=101'])
      expect((await http('GET', `/sales/overview?${query}`)).statusCode, query).toBe(400);
  });
  it('all acima de 50 empresas dá 400', async () => {
    const [extraOwner] = await db.insert(s.users).values({ name: 'Dono extra', email: `${randomUUID()}@example.test` }).returning();
    const accountId = await testAccount(db, extraOwner.id);
    const many = await db.insert(s.companies).values(Array.from({ length: 49 }, (_, i) => ({ accountId, tradeName: `Extra ${i}` }))).returning();
    await db.insert(s.companyUsers).values(many.map(c => ({ companyId: c.id, userId: user, role: 'OWNER' })));
    await grantLegacyMembers(db);
    expect((await http('GET', '/sales/overview?companies=all')).statusCode).toBe(400);
  });
  it('é somente leitura: escrita em /sales/overview não tem rota própria e não altera nada', async () => {
    const before = await db.select().from(s.sales).orderBy(s.sales.id);
    for (const method of ['POST', 'DELETE'] as const) expect([404, 405]).toContain((await http(method, '/sales/overview?companies=all')).statusCode);
    // PATCH cai em PATCH /sales/:id (SalesController) e é recusado antes de qualquer escrita.
    expect((await http('PATCH', '/sales/overview?companies=all')).statusCode).toBe(403);
    expect((await http('PATCH', '/sales/overview', companyA)).statusCode).toBe(400);
    expect(await db.select().from(s.sales).orderBy(s.sales.id)).toEqual(before);
    expect((await app.inject({ method: 'GET', url: '/sales/overview?companies=all' })).statusCode).toBe(401);
  });
  it('contratação vencida (BILLING) e empresa inativa ficam fora de all e dão 403 em companyIds', async () => {
    const [ownerF] = await db.insert(s.users).values({ name: 'Dono F', email: `${randomUUID()}@example.test` }).returning();
    const accountF = await testAccount(db, ownerF.id);
    await db.update(s.accountSubscriptions).set({ source: 'BILLING', currentPeriodEndsAt: new Date(Date.now() - 60_000) }).where(eq(s.accountSubscriptions.accountId, accountF));
    const [{ accountId: accountU }] = await db.select({ accountId: s.companies.accountId }).from(s.companies).where(eq(s.companies.id, companyA));
    const [companyF, companyG] = (await db.insert(s.companies).values([{ accountId: accountF, tradeName: 'Fóton' }, { accountId: accountU, tradeName: 'Gama', status: 'INACTIVE' }]).returning()).map(c => c.id);
    await db.insert(s.companyUsers).values([
      { companyId: companyF, userId: ownerF.id, role: 'OWNER' }, { companyId: companyF, userId: user, role: 'COLLABORATOR' }, { companyId: companyG, userId: user, role: 'OWNER' },
    ]);
    await grantLegacyMembers(db);
    expect((await http('GET', '/sales/overview?companies=all')).json().companyIds).toEqual([companyA, companyB].sort());
    for (const id of [companyF, companyG]) {
      const res = await http('GET', `/sales/overview?companyIds=${companyA},${id}`);
      expect(res.statusCode, id).toBe(403);
      expect(res.json()).not.toHaveProperty('items');
    }
  });
  it('o input de overview não carrega o escopo cru da query', () => {
    const input = listSalesOverviewSchema.parse({ companyIds: randomUUID(), status: 'ALL' });
    expect(input).not.toHaveProperty('companyIds');
    expect(input).not.toHaveProperty('companies');
  });
  it('mesmo nº em empresas diferentes aparece duas vezes na busca', async () => {
    expect(codes((await http('GET', '/sales/overview?companies=all&search=14872')).json())).toEqual(['14872', '14872']);
  });
  it('com uma empresa, traz os mesmos itens de GET /sales', async () => {
    const single = (await http('GET', '/sales?limit=10', companyA)).json();
    const overview = (await http('GET', `/sales/overview?companyIds=${companyA}&limit=10`)).json();
    expect(overview.items).toEqual(single.items);
    expect(overview.total).toBe(single.total);
  });
});

describe('GET /sales/overview: total e paginação', () => {
  const sum = async (query: string) => (await http('GET', `/sales/overview?companies=all${query}`)).json();
  it('soma exata em centavos, sem cancelados em Todos', async () => {
    await seedSale(companyA, customerA, { orderCode: '30001', total: '0.10' });
    await seedSale(companyB, customerB, { orderCode: '30002', total: '0.20' });
    await seedSale(companyA, customerA, { orderCode: '30003', total: '1234.56' });
    await seedSale(companyB, customerB, { orderCode: '30004', total: '999.00', status: 'CANCELED' });
    await seedSale(companyA, customerA, { orderCode: '30005', total: '50.00', status: 'DRAFT', customerName: 'Rascunho Ltda' });
    expect((await sum('')).summary).toEqual({ amount: '1284.86', excludesCanceled: true });
    expect((await sum('')).total).toBe(5);
    expect((await sum('&status=CONFIRMED')).summary).toEqual({ amount: '1234.86', excludesCanceled: false });
    expect((await sum('&status=CANCELED')).summary.amount).toBe('999.00');
    expect((await sum('&status=DRAFT')).summary.amount).toBe('50.00');
    expect((await sum('&search=rascunho')).summary.amount).toBe('50.00');
    expect((await sum('&search=nada-encontrado')).summary).toEqual({ amount: '0.00', excludesCanceled: true });
  });
  it('ordem estável entre empresas e total igual em todas as páginas', async () => {
    const at = new Date('2026-11-04T12:00:00Z');
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(await seedSale(i % 2 ? companyB : companyA, i % 2 ? customerB : customerA, { orderCode: `4000${i}`, createdAt: at, total: '10.00' }));
    const expected = rows.map(r => r.id).sort().reverse();
    const pages = await Promise.all([0, 2, 4].map(offset => sum(`&limit=2&offset=${offset}`)));
    expect(pages.flatMap(p => p.items.map((i: { id: string }) => i.id))).toEqual(expected);
    for (const p of pages) { expect(p.total).toBe(6); expect(p.summary.amount).toBe('60.00'); }
  });
  it('GET /sales por empresa não ganha summary (contrato inalterado)', async () => {
    await seedSale(companyA, customerA, { orderCode: '50001' });
    expect((await http('GET', '/sales', companyA)).json()).not.toHaveProperty('summary');
  });
});

describe('GET /sales/overview: contrato', () => {
  it('aparece no Swagger com os parâmetros de escopo', () => {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth().build());
    const names = (document.paths['/sales/overview'].get?.parameters ?? []).map(p => ('name' in p ? p.name : ''));
    expect(names).toEqual(expect.arrayContaining(['companies', 'companyIds']));
  });
});
