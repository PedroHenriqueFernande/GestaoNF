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
import { and, count, eq, sql } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { CrmModule } from '../src/crm/crm.module.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import { CrmHistoryService } from '../src/crm/crm-history.service.js';
import { LeadCaptureService } from '../src/crm/lead-capture.service.js';
import { LeadsService } from '../src/crm/leads.service.js';
import { OpportunitiesService } from '../src/crm/opportunities.service.js';
import { createEntrySchema, createLeadSchema, listSchema, pageSchema, statusSchema } from '../src/crm/crm.schemas.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
const testDatabaseName = `gestaonf_crm_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, capture: LeadCaptureService, leads: LeadsService, cards: OpportunitiesService, history: CrmHistoryService;
let owner: string, collaborator: string, otherCollaborator: string, companyA: string, companyB: string;
const jwtSecret = 'crm-isolated-test-secret-with-at-least-32-characters';
@Global()
@Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] })
class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, CrmModule] })
class TestAppModule {}
const context = (userId = owner, companyId = companyA) => ({ userId, companyId });
const leadInput = (name = 'João', campaign?: string) => createLeadSchema.parse({ lead: { name }, ...(campaign ? { capture: { utmCampaign: campaign } } : {}) });
const listInput = (query: Record<string, unknown> = {}) => listSchema.parse(query);
const page = pageSchema.parse({});
async function counts() {
  const [row] = await client`SELECT (SELECT count(*)::int FROM crm_contacts WHERE company_id = ${companyA}) contacts, (SELECT count(*)::int FROM crm_lead_entries WHERE company_id = ${companyA}) entries, (SELECT count(*)::int FROM crm_opportunities WHERE company_id = ${companyA}) cards, (SELECT count(*)::int FROM customers WHERE company_id = ${companyA}) customers, (SELECT count(*)::int FROM sales WHERE company_id = ${companyA}) sales`;
  return row;
}
async function token(userId = owner) {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(jwtSecret));
}
async function http(method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, body?: unknown, options: { userId?: string; companyId?: string; key?: string; unauthenticated?: boolean } = {}) {
  return app.inject({ method, url, headers: {
    ...(options.unauthenticated ? {} : { authorization: `Bearer ${await token(options.userId)}` }),
    'x-company-id': options.companyId ?? companyA,
    ...(options.key ? { 'idempotency-key': options.key } : {}),
  }, ...(body === undefined ? {} : { payload: JSON.stringify(body), headers: {
    ...(options.unauthenticated ? {} : { authorization: `Bearer ${await token(options.userId)}` }),
    'x-company-id': options.companyId ?? companyA, 'content-type': 'application/json', ...(options.key ? { 'idempotency-key': options.key } : {}),
  } }) });
}
beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina CRM_TEST_DATABASE_URL ou DATABASE_URL para os testes isolados');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${testDatabaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../../../packages/database/drizzle', import.meta.url)) });
  for (const migration of migrations) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s });
  const database = { db } as DatabaseService, policy = new CrmPolicyService(database);
  history = new CrmHistoryService(database, policy); capture = new LeadCaptureService(database, policy, history);
  leads = new LeadsService(database, policy, history); cards = new OpportunitiesService(database, policy, history);
  vi.stubEnv('JWT_SECRET', jwtSecret);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
}, 60000);
afterAll(async () => {
  if (app) await app.close();
  if (client) await client.end();
  if (admin) {
    if (!/^gestaonf_crm_test_[a-f0-9]{12}$/.test(testDatabaseName)) throw new Error('Banco de teste inválido');
    await admin.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`); await admin.end();
  }
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  const users = await db.insert(s.users).values(['Gestor', 'Vendedor', 'Outro vendedor'].map((name) => ({ name, email: `${randomUUID()}@example.test` }))).returning();
  [owner, collaborator, otherCollaborator] = users.map((u) => u.id);
  const accountId = await testAccount(db, owner);
  const companies = await db.insert(s.companies).values([{ accountId, name: 'Empresa A', timezone: 'America/Sao_Paulo' }, { accountId, name: 'Empresa B' }]).returning();
  [companyA, companyB] = companies.map((c) => c.id);
  await db.insert(s.companyUsers).values([
    { companyId: companyA, userId: owner, role: 'OWNER' }, { companyId: companyB, userId: owner, role: 'OWNER' },
    { companyId: companyA, userId: collaborator, role: 'COLLABORATOR' }, { companyId: companyA, userId: otherCollaborator, role: 'COLLABORATOR' },
  ]);
});

describe('núcleo CRM em PostgreSQL e HTTP', () => {
  it('cria somente contato, captação, card NEW e histórico com nome mínimo', async () => {
    const result = await capture.create(context(), leadInput(), randomUUID());
    expect(await counts()).toEqual({ contacts: 1, entries: 1, cards: 1, customers: 0, sales: 0 });
    const card = await cards.get(context(), result.opportunityId);
    expect(card.commercialStatus).toBe('NEW'); expect(card.estimatedAmount).toBeNull();
    expect(card.origin.utmCampaign).toBeNull(); expect(card.lead.customerId).toBeNull();
    const pipelines = await cards.pipelines(context());
    expect(pipelines.items).toHaveLength(1); expect(pipelines.items[0].stages[0].id).toBe(card.stageId);
    expect((await history.list(context(), result.leadId, page)).items).toHaveLength(3);
  });
  it('serializa reenvios concorrentes e rejeita a mesma chave com outro corpo', async () => {
    const key = randomUUID(), input = leadInput();
    const results = await Promise.all(Array.from({ length: 5 }, () => capture.create(context(), input, key)));
    expect(results.every((r) => r.leadId === results[0].leadId && r.opportunityId === results[0].opportunityId)).toBe(true);
    expect((await counts()).contacts).toBe(1);
    await expect(capture.create(context(), leadInput('Outra pessoa'), key)).rejects.toMatchObject({ status: 409 });
  });
  it('deduplica evento externo com outra chave técnica e mantém eventos legítimos separados', async () => {
    const source = { kind: 'FORM' as const, namespace: 'verified-form:abc', eventId: 'submission-1' };
    const a = await capture.capture(context(), leadInput(), 'first', undefined, source);
    const b = await capture.capture(context(), leadInput(), 'second', undefined, source);
    expect(b).toEqual(a);
    await capture.capture(context(), leadInput(), 'third', undefined, { ...source, eventId: 'submission-2' });
    expect((await counts()).cards).toBe(2);
  });
  it('provisiona um único destino padrão com captações distintas simultâneas', async () => {
    await Promise.all(Array.from({ length: 4 }, (_, i) => capture.create(context(), leadInput(`Pessoa ${i}`), randomUUID())));
    expect((await cards.pipelines(context())).items).toHaveLength(1);
    expect((await counts()).cards).toBe(4);
  });
  it('desfaz todos os registros quando a inserção do card falha', async () => {
    await client.unsafe(`CREATE FUNCTION crm_test_reject_card() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.company_id = '${companyA}'::uuid THEN RAISE EXCEPTION 'forced card failure'; END IF; RETURN NEW; END $$`);
    await client.unsafe('CREATE TRIGGER crm_test_reject_card BEFORE INSERT ON crm_opportunities FOR EACH ROW EXECUTE FUNCTION crm_test_reject_card()');
    try { await expect(capture.create(context(), leadInput(), randomUUID())).rejects.toThrow(); }
    finally { await client.unsafe('DROP TRIGGER crm_test_reject_card ON crm_opportunities'); await client.unsafe('DROP FUNCTION crm_test_reject_card()'); }
    expect(await counts()).toEqual({ contacts: 0, entries: 0, cards: 0, customers: 0, sales: 0 });
    const [{ value }] = await db.select({ value: count() }).from(s.crmActivities).where(eq(s.crmActivities.companyId, companyA));
    expect(value).toBe(0); expect((await cards.pipelines(context())).items).toHaveLength(0);
  });
  it('nova manifestação preserva perfil e UTMs, e situações permanecem independentes', async () => {
    const a = await capture.create(context(), leadInput('João', 'Campanha A'), randomUUID());
    const b = await capture.addEntry(context(), a.leadId, createEntrySchema.parse({ capture: { utmCampaign: 'Campanha B' } }), randomUUID());
    await cards.status(context(), a.opportunityId, statusSchema.parse({ expectedVersion: 1, status: 'WON' }));
    expect((await cards.get(context(), b.opportunityId)).commercialStatus).toBe('NEW');
    expect((await leads.entries(context(), a.leadId, page)).items.map((e) => e.utmCampaign).sort()).toEqual(['Campanha A', 'Campanha B']);
    expect((await leads.list(context(), listInput({ status: 'WON', utmCampaign: 'campanha b' }))).total).toBe(0);
    expect((await leads.list(context(), listInput({ status: 'WON', utmCampaign: 'campanha a' }))).total).toBe(1);
    expect(await counts()).toEqual({ contacts: 1, entries: 2, cards: 2, customers: 0, sales: 0 });
  });
  it('verifica empresa na API e em chaves estrangeiras compostas', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    await expect(leads.get(context(owner, companyB), a.leadId)).rejects.toMatchObject({ status: 404 });
    const b = await capture.create(context(owner, companyB), leadInput(), randomUUID());
    await expect(db.update(s.crmOpportunities).set({ contactId: b.leadId }).where(eq(s.crmOpportunities.id, a.opportunityId))).rejects.toThrow();
    await expect(db.update(s.crmOpportunities).set({ originEntryId: b.entryId }).where(eq(s.crmOpportunities.id, a.opportunityId))).rejects.toThrow();
    await expect(db.update(s.crmContacts).set({ version: 0 }).where(eq(s.crmContacts.id, a.leadId))).rejects.toThrow();
  });
  it('não permite dois cards para uma entrada nem coluna de outro funil', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID()), existing = await cards.get(context(), a.opportunityId);
    await expect(db.insert(s.crmOpportunities).values({ companyId: companyA, contactId: a.leadId, originEntryId: a.entryId, pipelineId: existing.pipelineId, stageId: existing.stageId, title: 'Duplicado' })).rejects.toThrow();
    const [pipeline] = await db.insert(s.crmPipelines).values({ companyId: companyA, name: 'Outro funil' }).returning();
    const [stage] = await db.insert(s.crmPipelineStages).values({ companyId: companyA, pipelineId: pipeline.id, name: 'Coluna', position: 1, isEntry: true }).returning();
    await expect(cards.stage(context(), a.opportunityId, { expectedVersion: 1, stageId: stage.id })).rejects.toMatchObject({ status: 400 });
    await expect(db.update(s.crmOpportunities).set({ stageId: stage.id }).where(eq(s.crmOpportunities.id, a.opportunityId))).rejects.toThrow();
  });
  it('colaborador vê perfil compartilhado, mas somente suas negociações, origens e históricos', async () => {
    const a = await capture.create(context(), createLeadSchema.parse({ lead: { name: 'Compartilhado', assignedUserId: collaborator }, capture: { utmCampaign: 'Minha campanha' } }), randomUUID());
    const b = await capture.addEntry(context(), a.leadId, createEntrySchema.parse({ assignedUserId: otherCollaborator, capture: { utmCampaign: 'Campanha privada' } }), randomUUID());
    await leads.addNote(context(), a.leadId, { opportunityId: b.opportunityId, note: 'Nota privada' }, randomUUID());
    expect((await cards.list(context(collaborator), listInput())).items.map((c) => c.id)).toEqual([a.opportunityId]);
    expect((await leads.entries(context(collaborator), a.leadId, page)).items.map((e) => e.id)).toEqual([a.entryId]);
    expect((await history.list(context(collaborator), a.leadId, page)).items.some((h) => h.note === 'Nota privada')).toBe(false);
    expect((await leads.list(context(collaborator), listInput({ utmCampaign: 'Campanha privada' }))).total).toBe(0);
    await expect(cards.get(context(collaborator), b.opportunityId)).rejects.toMatchObject({ status: 404 });
    await expect(leads.update(context(otherCollaborator), a.leadId, { expectedVersion: 1, name: 'Indevido' })).rejects.toMatchObject({ status: 403 });
    await expect(cards.update(context(collaborator), a.opportunityId, { expectedVersion: 1, assignedUserId: otherCollaborator })).rejects.toMatchObject({ status: 403 });
  });
  it('bloqueia reenvio após desativação de acesso e atribuição a usuário inativo', async () => {
    const key = randomUUID(), a = await capture.create(context(collaborator), leadInput(), key);
    await db.update(s.companyUsers).set({ status: 'INACTIVE' }).where(and(eq(s.companyUsers.companyId, companyA), eq(s.companyUsers.userId, collaborator)));
    await expect(capture.create(context(collaborator), leadInput(), key)).rejects.toMatchObject({ status: 403 });
    await expect(cards.update(context(), a.opportunityId, { expectedVersion: 1, assignedUserId: collaborator })).rejects.toMatchObject({ status: 400 });
  });
  it('controle de versão evita sobrescrita entre alterações concorrentes', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    const outcomes = await Promise.allSettled([
      cards.status(context(), a.opportunityId, { expectedVersion: 1, status: 'QUALIFIED' }),
      cards.status(context(), a.opportunityId, { expectedVersion: 1, status: 'CONTACTING' }),
    ]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
    expect((await cards.get(context(), a.opportunityId)).version).toBe(2);
  });
  it('encerra e reabre negociação com motivos preservados no histórico; status idêntico não altera versão', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    const lost = await cards.status(context(), a.opportunityId, { expectedVersion: 1, status: 'LOST', reasonText: 'Preço' });
    expect(lost.closedAt).not.toBeNull();
    const same = await cards.status(context(), a.opportunityId, { expectedVersion: 2, status: 'LOST' }); expect(same.version).toBe(2);
    const reopened = await cards.status(context(), a.opportunityId, { expectedVersion: 2, status: 'CONTACTING' });
    expect(reopened.closedAt).toBeNull(); expect(reopened.reasonText).toBeNull();
    const activities = await history.list(context(), a.leadId, page);
    expect(JSON.stringify(activities.items)).toContain('Preço');
  });
  it('notas concorrentes repetidas geram uma atividade e uma atualização do card', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID()), key = randomUUID();
    const results = await Promise.all(Array.from({ length: 3 }, () => leads.addNote(context(), a.leadId, { opportunityId: a.opportunityId, note: 'Ligar amanhã' }, key)));
    expect(results.every((r) => r.id === results[0].id)).toBe(true);
    expect((await cards.get(context(), a.opportunityId)).version).toBe(2);
    expect((await history.list(context(), a.leadId, page)).items.filter((h) => h.kind === 'NOTE_ADDED')).toHaveLength(1);
    await expect(leads.addNote(context(), a.leadId, { note: 'Outro conteúdo' }, key)).rejects.toMatchObject({ status: 409 });
  });
  it('arquiva e restaura preservando os status e bloqueia contato com negociação aberta', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    await expect(leads.archive(context(), a.leadId, 1)).rejects.toMatchObject({ status: 409 });
    await cards.status(context(), a.opportunityId, { expectedVersion: 1, status: 'WON' });
    await leads.archive(context(), a.leadId, 1);
    expect((await leads.list(context(), listInput())).total).toBe(0);
    await expect(capture.addEntry(context(), a.leadId, createEntrySchema.parse({}), randomUUID())).rejects.toMatchObject({ status: 400 });
    await leads.archive(context(), a.leadId, 2, true);
    const card = await cards.get(context(), a.opportunityId); expect(card.archivedAt).not.toBeNull(); expect(card.commercialStatus).toBe('WON');
    await cards.archive(context(), a.opportunityId, card.version, true);
    expect((await cards.get(context(), a.opportunityId)).commercialStatus).toBe('WON');
  });
  it('arquivamento e nova entrada concorrentes não deixam card aberto em contato arquivado', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    await cards.archive(context(), a.opportunityId, 1);
    const outcomes = await Promise.allSettled([leads.archive(context(), a.leadId, 1), capture.addEntry(context(), a.leadId, createEntrySchema.parse({}), randomUUID())]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const [{ value }] = await db.select({ value: count() }).from(s.crmOpportunities).innerJoin(s.crmContacts, and(eq(s.crmContacts.companyId, s.crmOpportunities.companyId), eq(s.crmContacts.id, s.crmOpportunities.contactId)))
      .where(and(eq(s.crmContacts.companyId, companyA), sql`${s.crmContacts.archivedAt} IS NOT NULL`, sql`${s.crmOpportunities.archivedAt} IS NULL`, eq(s.crmOpportunities.commercialStatus, 'NEW')));
    expect(value).toBe(0);
  });
  it('cliente só é vinculado explicitamente e somente na mesma empresa', async () => {
    const a = await capture.create(context(), leadInput(), randomUUID());
    const [b] = await db.insert(s.customers).values({ companyId: companyB, kind: 'PF', name: 'Outra empresa' }).returning();
    await expect(leads.linkCustomer(context(), a.leadId, { expectedVersion: 1, customerId: b.id })).rejects.toMatchObject({ status: 400 });
    const [customer] = await db.insert(s.customers).values({ companyId: companyA, kind: 'PF', name: 'Cliente explícito' }).returning();
    expect((await leads.linkCustomer(context(), a.leadId, { expectedVersion: 1, customerId: customer.id })).customerId).toBe(customer.id);
    await expect(db.update(s.crmContacts).set({ customerId: b.id }).where(eq(s.crmContacts.id, a.leadId))).rejects.toThrow();
  });
  it('duplicidade é apenas sugerida e não funde pessoas com dados compartilhados', async () => {
    const input = createLeadSchema.parse({ lead: { name: 'Nome', email: 'TEST@example.test', phone: '(61) 99999-0000' } });
    await capture.create(context(), input, randomUUID()); await capture.create(context(), input, randomUUID());
    expect((await counts()).contacts).toBe(2);
    expect((await leads.candidates(context(), { email: 'test@example.test' })).items).toHaveLength(2);
    expect((await leads.candidates(context(collaborator), { email: 'test@example.test' })).items).toHaveLength(0);
  });
  it('períodos respeitam fuso da empresa e filtros ignoram curingas fornecidos', async () => {
    const a = await capture.create(context(), leadInput('Lead 100%_real'), randomUUID());
    await db.update(s.crmLeadEntries).set({ receivedAt: new Date('2026-10-02T02:30:00Z') }).where(eq(s.crmLeadEntries.id, a.entryId));
    expect((await leads.list(context(), listInput({ from: '2026-10-01', to: '2026-10-01' }))).total).toBe(1);
    expect((await leads.list(context(), listInput({ from: '2026-10-02', to: '2026-10-02' }))).total).toBe(0);
    expect((await leads.list(context(), listInput({ search: '%_'}))).total).toBe(1);
    expect((await leads.list(context(), listInput({ missingField: 'utmCampaign' }))).total).toBe(1);
  });
  it('HTTP aplica autenticação, headers obrigatórios, schema estrito e versionamento', async () => {
    expect((await http('GET', '/crm/leads', undefined, { unauthenticated: true })).statusCode).toBe(401);
    expect((await http('POST', '/crm/leads', { lead: { name: 'Teste' } })).statusCode).toBe(400);
    expect((await http('POST', '/crm/leads', { lead: { name: 'Teste' }, companyId: companyB }, { key: randomUUID() })).statusCode).toBe(400);
    const key = randomUUID(), payload = { lead: { name: 'HTTP' }, interest: { estimatedAmount: '5000.00' } };
    const response = await http('POST', '/crm/leads', payload, { key }); expect(response.statusCode).toBe(201);
    const result = response.json(); expect((await http('POST', '/crm/leads', payload, { key })).json()).toEqual(result);
    expect((await http('GET', `/crm/leads/${result.leadId}`, undefined, { companyId: companyB })).statusCode).toBe(404);
    const candidates = await http('POST', '/crm/leads/duplicate-candidates', { email: 'none@example.test' }); expect(candidates.statusCode).toBe(200);
    expect((await http('PATCH', `/crm/leads/${result.leadId}`, { name: 'Novo nome' })).statusCode).toBe(400);
    expect((await http('PATCH', `/crm/leads/${result.leadId}`, { expectedVersion: 1, name: 'Novo nome' })).statusCode).toBe(200);
    expect((await http('PATCH', `/crm/leads/${result.leadId}`, { expectedVersion: 1, name: 'Versão antiga' })).statusCode).toBe(409);
    expect((await http('GET', '/crm/leads?from=2026-02-30')).statusCode).toBe(400);
    expect((await http('GET', '/crm/leads?from=2026-10-10&to=2026-10-01')).statusCode).toBe(400);
  });
  it('Swagger publica corpos e operações CRM', () => {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('CRM test').setVersion('1').build());
    expect(doc.paths['/crm/leads'].post?.requestBody).toBeDefined();
    expect(doc.paths['/crm/opportunities/{id}/status'].patch).toBeDefined();
    expect(doc.paths['/crm/leads/{id}/notes'].post?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', required: true })]));
    expect(doc.paths['/crm/leads'].get?.parameters).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'utmCampaign' }), expect.objectContaining({ name: 'status' })]));
  });
});
