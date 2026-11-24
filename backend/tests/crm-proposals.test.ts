import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { grantLegacyMembers, grantMember } from './permission-fixtures.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Global, Module, type HttpException } from '@nestjs/common';
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
import { ServicesModule } from '../src/services/services.module.js';
import { LeadCaptureService } from '../src/crm/lead-capture.service.js';
import { ProposalsService } from '../src/crm/proposals.service.js';
import { ProposalReadService } from '../src/crm/proposal-read.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import type { Actor } from '../src/permissions/actor.js';
import { closure, type PermissionKey } from '@gestaonf/permissions';
import { resolveActor } from '../src/permissions/permission-resolver.js';
import * as codes from '../src/sales/sales-codes.js';
import { createLeadSchema } from '../src/crm/crm.schemas.js';
import { createProposalSchema, proposalListSchema } from '../src/crm/proposal.schemas.js';
import { effectiveProposalStatus } from '../src/crm/proposal-money.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });
const databaseName = `gestaonf_proposals_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
const secret = 'proposals-isolated-test-secret-with-at-least-32-characters';
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>, db: ReturnType<typeof drizzle<typeof s>>;
let app: NestFastifyApplication, proposals: ProposalsService, capture: LeadCaptureService, read: ProposalReadService, sales: SalesService;
let owner: string, seller: string, other: string, company: string, companyB: string, service: string;
let ownerActor: Actor, account: string;
const ctx = (userId = owner, companyId = company) => ({ userId, companyId });
@Global() @Module({ providers: [{ provide: DatabaseService, useFactory: () => ({ db }) }], exports: [DatabaseService] })
class TestDatabaseModule {}
@Module({ imports: [TestDatabaseModule, CrmModule, ServicesModule] }) class TestAppModule {}
const item = () => ({ serviceId: service, quantity: '2.0000', unitPrice: '2500.00', discountType: 'PERCENT' as const, discountInput: '10.00' });
async function lead(extra: Record<string, unknown> = {}) {
  return capture.create(ctx(), createLeadSchema.parse({ lead: { name: 'João', email: 'joao@example.test', ...extra }, interest: { primaryServiceId: service } }), randomUUID());
}
async function create(extra: Record<string, unknown> = {}, leadExtra: Record<string, unknown> = {}) {
  const l = await lead(leadExtra);
  const input = createProposalSchema.parse({ opportunityId: l.opportunityId, newCustomer: { kind: 'PF' }, items: [item()], ...extra });
  const p = await proposals.create(ctx(), input, randomUUID());
  return { ...l, id: String(p.proposalId), customerId: String(p.customerId), input };
}
async function accepted(extra: Record<string, unknown> = {}) {
  const p = await create(extra); await proposals.transition(ctx(), p.id, 'send', { expectedVersion: 1 }, randomUUID());
  await proposals.transition(ctx(), p.id, 'accept', { expectedVersion: 2 }, randomUUID()); return p;
}
async function customerCount() { const [r] = await db.select({ n: count() }).from(s.customers).where(eq(s.customers.companyId, company)); return r.n; }
async function http(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, userId = owner, companyId = company, key?: string) {
  const token = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuer('gestaonf').setAudience('gestaonf-api').setIssuedAt().setExpirationTime('5m').sign(new TextEncoder().encode(secret));
  return app.inject({ method, url, headers: { authorization: `Bearer ${token}`, 'x-company-id': companyId, ...(key ? { 'idempotency-key': key } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { payload: JSON.stringify(body) } : {}) });
}
beforeAll(async () => {
  const databaseUrl = process.env.CRM_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL requerida para banco de testes isolado');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} }); await admin.unsafe(`CREATE DATABASE "${databaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${databaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  for (const migration of readMigrationFiles({ migrationsFolder: fileURLToPath(new URL('../database/drizzle', import.meta.url)) })) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema: s }); vi.stubEnv('JWT_SECRET', secret);
  app = await NestFactory.create<NestFastifyApplication>(TestAppModule, new FastifyAdapter(), { logger: false });
  await app.register(cookie); await app.init(); await app.getHttpAdapter().getInstance().ready();
  proposals = app.get(ProposalsService); capture = app.get(LeadCaptureService); read = app.get(ProposalReadService); sales = app.get(SalesService);
}, 60_000);
afterAll(async () => {
  if (app) await app.close(); if (client) await client.end();
  if (admin) { if (!/^gestaonf_proposals_test_[a-f0-9]{12}$/.test(databaseName)) throw new Error('Banco isolado inválido'); await admin.unsafe(`DROP DATABASE IF EXISTS "${databaseName}" WITH (FORCE)`); await admin.end(); }
  vi.unstubAllEnvs();
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
beforeEach(async () => {
  const users = await db.insert(s.users).values(['Gestor', 'Vendedor', 'Outro'].map(name => ({ name, email: `${randomUUID()}@example.test` }))).returning(); [owner, seller, other] = users.map(u => u.id);
  const accountId = await testAccount(db, owner); account = accountId;
  const companies = await db.insert(s.companies).values([{ accountId, tradeName: 'Empresa A' }, { accountId, tradeName: 'Empresa B' }]).returning(); [company, companyB] = companies.map(c => c.id);
  await db.insert(s.companyUsers).values([{ companyId: company, userId: owner, role: 'OWNER' }, { companyId: companyB, userId: owner, role: 'OWNER' }, { companyId: company, userId: seller, role: 'COLLABORATOR' }, { companyId: company, userId: other, role: 'COLLABORATOR' }]);
  await grantLegacyMembers(db);
  const actor = await resolveActor(db, owner, company);
  if (!actor) throw new Error('Vínculo do titular inválido no teste de propostas');
  ownerActor = actor;
  const [v] = await db.insert(s.services).values({ companyId: company, name: 'Venda de CRM', suggestedUnitPrice: '2500.00' }).returning(); service = v.id;
});

describe('propostas comerciais: HTTP e PostgreSQL', () => {
  it('capta sem cliente e cria cadastro/vínculo automaticamente apenas ao salvar proposta', async () => {
    const l = await lead(); expect(await customerCount()).toBe(0);
    const prefill = await read.prefill(ctx(), { opportunityId: l.opportunityId });
    expect('requiresCustomerDetails' in prefill && prefill.requiresCustomerDetails).toBe(true); expect(await customerCount()).toBe(0);
    const r = await http('POST', '/crm/proposals', { opportunityId: l.opportunityId, items: [item()], newCustomer: { kind: 'PF' } }, owner, company, randomUUID());
    expect(r.statusCode).toBe(201); expect(r.json().proposalCode).toBe('P-000001'); expect(await customerCount()).toBe(1);
    const [contact] = await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, l.leadId)); expect(contact.customerId).toBe(r.json().customerId);
    const detail = await proposals.get(ctx(), r.json().proposalId); expect(detail.totalAmount).toBe('4500.00'); expect(detail.items[0].discountAmount).toBe('500.00');
    expect((await db.select().from(s.services).where(eq(s.services.id, service)))[0].suggestedUnitPrice).toBe('2500.00');
  });
  it('exige tipo quando desconhecido, impede proposta vazia e permite serviço novo pela API existente', async () => {
    const l = await capture.create(ctx(), createLeadSchema.parse({ lead: { name: 'Lead externo' }, interest: { description: 'Produto do formulário' } }), randomUUID());
    expect(await read.prefill(ctx(), { opportunityId: l.opportunityId })).toMatchObject({ requiresServiceSelection: true, interestDescription: 'Produto do formulário' });
    const missing = await http('POST', '/crm/proposals', { opportunityId: l.opportunityId, items: [item()] }, owner, company, randomUUID());
    expect(missing.statusCode).toBe(422); expect(missing.json().code).toBe('PROPOSAL_CUSTOMER_DETAILS_REQUIRED');
    const empty = await http('POST', '/crm/proposals', { opportunityId: l.opportunityId, items: [], newCustomer: { kind: 'PF' } }, owner, company, randomUUID()); expect(empty.statusCode).toBe(400);
    const created = await http('POST', '/services', { name: 'Consultoria rápida' }); expect(created.statusCode).toBe(201);
    const p = await http('POST', '/crm/proposals', { opportunityId: l.opportunityId, items: [{ ...item(), serviceId: created.json().id }], newCustomer: { kind: 'PF' } }, owner, company, randomUUID()); expect(p.statusCode).toBe(201);
  });
  it('desfaz cliente e vínculo se qualquer serviço ou desconto falhar', async () => {
    const l = await lead();
    const bad = createProposalSchema.parse({ opportunityId: l.opportunityId, newCustomer: { kind: 'PF' }, items: [{ ...item(), discountType: 'AMOUNT', discountInput: '999999.00' }] });
    await expect(proposals.create(ctx(), bad, randomUUID())).rejects.toMatchObject({ status: 422 }); expect(await customerCount()).toBe(0);
    expect((await db.select().from(s.crmContacts).where(eq(s.crmContacts.id, l.leadId)))[0].customerId).toBeNull();
  });
  it('duas propostas simultâneas do mesmo lead criam um só cliente', async () => {
    const l = await lead(), input = createProposalSchema.parse({ opportunityId: l.opportunityId, newCustomer: { kind: 'PF' }, items: [item()] });
    const results = await Promise.all([proposals.create(ctx(), input, randomUUID()), proposals.create(ctx(), input, randomUUID())]);
    expect(results[0].customerId).toBe(results[1].customerId); expect(results[0].proposalId).not.toBe(results[1].proposalId); expect(await customerCount()).toBe(1);
  });
  it('replay da criação não duplica e reutilização de chave com novos dados é conflito', async () => {
    const l = await lead(), key = randomUUID(), input = createProposalSchema.parse({ opportunityId: l.opportunityId, newCustomer: { kind: 'PF' }, items: [item()] });
    const results = await Promise.all(Array.from({ length: 4 }, () => proposals.create(ctx(), input, key)));
    for (const r of results) expect(r).toEqual(results[0]);
    await expect(proposals.create(ctx(), { ...input, title: 'Outro título' }, key)).rejects.toMatchObject({ status: 409 }); expect(await customerCount()).toBe(1);
  });
  it('CPF existente exige confirmação, reaproveita cadastro e não cria duplicata', async () => {
    const [c] = await db.insert(s.customers).values({ companyId: company, kind: 'PF', name: 'João', taxId: '52998224725' }).returning();
    const l = await lead({ taxId: '52998224725', taxIdKind: 'PF' }), input = createProposalSchema.parse({ opportunityId: l.opportunityId, items: [item()] });
    await expect(proposals.create(ctx(), input, randomUUID())).rejects.toMatchObject({ status: 409 });
    const p = await proposals.create(ctx(), { ...input, customerId: c.id }, randomUUID()); expect(p.customerId).toBe(c.id); expect(await customerCount()).toBe(1);
  });
  it('origem em cliente cria entrada/card e reusa contato nas próximas propostas', async () => {
    const [c] = await db.insert(s.customers).values({ companyId: company, kind: 'PJ', name: 'Empresa Cliente' }).returning();
    const input = createProposalSchema.parse({ customerId: c.id, createOpportunity: true, items: [item()] });
    const a = await proposals.create(ctx(), input, randomUUID()), b = await proposals.create(ctx(), input, randomUUID());
    const da = await proposals.get(ctx(), String(a.proposalId)), dbb = await proposals.get(ctx(), String(b.proposalId));
    expect(da.contactId).toBe(dbb.contactId); expect(da.opportunityId).not.toBe(dbb.opportunityId); expect(await customerCount()).toBe(1);
  });
  it('concorrência de edição usa versão e registra conteúdo anterior', async () => {
    const p = await create();
    const results = await Promise.allSettled([proposals.update(ctx(), p.id, { expectedVersion: 1, title: 'Oferta A' }), proposals.update(ctx(), p.id, { expectedVersion: 1, title: 'Oferta B' })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const events = await proposals.events(ctx(), p.id, 20, 0); expect(events.total).toBe(2); expect(JSON.stringify(events)).toContain('Venda de CRM');
    await expect(db.delete(s.crmProposalItems).where(eq(s.crmProposalItems.proposalId, p.id))).rejects.toBeDefined();
  });
  it('envio congela oferta, catálogo novo não muda PDF nem os itens copiados ao pedido', async () => {
    const p = await accepted(); const original = await proposals.preview(ctx(), p.id);
    await db.update(s.services).set({ name: 'Nome novo', suggestedUnitPrice: '9999.00' }).where(eq(s.services.id, service));
    await db.update(s.crmContacts).set({ name: 'Outro nome' }).where(eq(s.crmContacts.id, p.leadId));
    expect(await proposals.preview(ctx(), p.id)).toEqual(original);
    await expect(proposals.update(ctx(), p.id, { expectedVersion: 3, title: 'Mudança' })).rejects.toMatchObject({ status: 409 });
    await expect(db.update(s.crmProposals).set({ title: 'Mudança direta' }).where(eq(s.crmProposals.id, p.id))).rejects.toBeDefined();
    const r = await proposals.convert(ctx(), p.id, { expectedVersion: 3 }, randomUUID(), ownerActor);
    const sale = await sales.get(company, String(r.saleId)); expect(sale.items[0].serviceNameSnapshot).toBe('Venda de CRM'); expect(sale.totalAmount).toBe('4500.00');
  });
  it('aceite não gera venda e conversões concorrentes geram um único pedido DRAFT sem financeiro', async () => {
    const p = await accepted();
    expect((await db.select({ n: count() }).from(s.sales).where(eq(s.sales.companyId, company)))[0].n).toBe(0);
    const results = await Promise.all(Array.from({ length: 4 }, () => proposals.convert(ctx(), p.id, { expectedVersion: 3 }, randomUUID(), ownerActor)));
    for (const r of results) expect(r.saleId).toBe(results[0].saleId);
    const sale = await sales.get(company, String(results[0].saleId)); expect(sale.status).toBe('DRAFT'); expect(sale.orderCode).toMatch(/^\d{5}$/); expect(sale.installments).toEqual([]);
    expect((await db.select().from(s.receivables).where(eq(s.receivables.companyId, company)))).toEqual([]);
    expect((await db.select().from(s.crmOpportunities).where(eq(s.crmOpportunities.id, p.opportunityId)))[0].commercialStatus).toBe('WON');
  });
  it('falha após INSERT do pedido reverte pedido, status e histórico de conversão', async () => {
    const p = await accepted(), original = sales.createDraftInTx.bind(sales);
    vi.spyOn(sales, 'createDraftInTx').mockImplementationOnce(async (...args) => { await original(...args); throw new Error('Falha simulada'); });
    await expect(proposals.convert(ctx(), p.id, { expectedVersion: 3 }, randomUUID(), ownerActor)).rejects.toThrow('Falha simulada');
    expect((await proposals.get(ctx(), p.id)).status).toBe('ACCEPTED');
    expect((await db.select().from(s.sales).where(eq(s.sales.companyId, company)))).toEqual([]);
    expect((await proposals.events(ctx(), p.id, 20, 0)).total).toBe(3);
  });
  it('pedido convertido exige revisão e só gera recebíveis quando confirmado no Portal', async () => {
    const p = await accepted(), result = await proposals.convert(ctx(), p.id, { expectedVersion: 3 }, randomUUID(), ownerActor), id = String(result.saleId);
    await expect(sales.confirm(ownerActor, id, { expectedVersion: 1, initialReceipts: [] }, 'test:proposal-confirm')).rejects.toMatchObject({ status: 400 });
    const updated = await sales.update(ownerActor, id, { expectedVersion: 1, customerId: p.customerId, soldOn: '2026-10-13',
      items: [{ serviceId: service, quantity: '2.0000', unitPrice: '2500.00', discountAmount: '500.00' }],
      installments: [{ paymentMethod: 'PIX', amount: '4500.00', dueOn: '2026-11-13' }] }, 'test:proposal-update');
    expect(updated.status).toBe('DRAFT');
    const confirmed = await sales.confirm(ownerActor, id, { expectedVersion: 2, initialReceipts: [] }, 'test:proposal-confirm');
    expect(confirmed.status).toBe('CONFIRMED'); expect(confirmed.sourceProposalId).toBe(p.id); expect(confirmed.installments).toHaveLength(1);
    expect(confirmed.installments[0].paycode).toMatch(/^\d{4}$/);
    expect((await db.select().from(s.receivables).where(eq(s.receivables.saleId, id)))).toHaveLength(1);
  });
  it('filtros combinados respeitam serviço, responsável, período e cliente', async () => {
    const p = await create();
    const result = await read.list(ctx(), proposalListSchema.parse({ serviceId: service, assignedUserId: owner, customerId: p.customerId, search: 'P-000001', from: '2000-01-01', to: '2100-01-01' }));
    expect(result.total).toBe(1); expect(result.items[0].id).toBe(p.id);
    expect((await read.list(ctx(), proposalListSchema.parse({ serviceId: randomUUID() }))).total).toBe(0);
  });
  it('automação de etapa ocorre no envio, respeita configuração e mantém status comercial', async () => {
    const p = await create(), [opportunity] = await db.select().from(s.crmOpportunities).where(eq(s.crmOpportunities.id, p.opportunityId));
    const [stage] = await db.insert(s.crmPipelineStages).values({ companyId: company, pipelineId: opportunity.pipelineId, name: 'Proposta enviada', position: 2 }).returning();
    const settings = await proposals.settings(ctx());
    await proposals.updateSettings(ctx(), { expectedVersion: settings.version, proposalSentStageId: stage.id });
    await proposals.transition(ctx(), p.id, 'send', { expectedVersion: 1 }, randomUUID());
    const [updated] = await db.select().from(s.crmOpportunities).where(eq(s.crmOpportunities.id, p.opportunityId));
    expect(updated.stageId).toBe(stage.id); expect(updated.commercialStatus).toBe('NEW');
  });
  it('conversão sem sales.change_price: converte com desconto e edita o rascunho mantendo os itens (D6)', async () => {
    await grantMember(db, account, seller, [...closure(['proposals.convert'])]);
    const sellerActor = (await resolveActor(db, seller, company))!;
    const p = await create({}, { assignedUserId: seller });
    await proposals.transition(ctx(), p.id, 'send', { expectedVersion: 1 }, randomUUID());
    await proposals.transition(ctx(), p.id, 'accept', { expectedVersion: 2 }, randomUUID());
    const id = String((await proposals.convert(ctx(seller), p.id, { expectedVersion: 3 }, randomUUID(), sellerActor)).saleId);
    const body = (quantity: string, discountAmount: string, amount: string) => ({ expectedVersion: 1, customerId: p.customerId, soldOn: '2026-10-13',
      items: [{ serviceId: service, quantity, unitPrice: '2500.00', discountAmount }], installments: [{ paymentMethod: 'PIX' as const, amount, dueOn: '2026-11-13' }] });
    const denied = await sales.update(sellerActor, id, body('1.0000', '500.00', '2000.00'), 'test:proposal-update').then(() => null, (e: HttpException) => e.getResponse());
    expect(denied).toMatchObject({ permission: 'sales.change_price' });
    await expect(sales.update(sellerActor, id, body('2.0000', '500.00', '4500.00'), 'test:proposal-update')).resolves.toMatchObject({ status: 'DRAFT' });
  });
  it('colisão do código de pedido refaz a transação sem duplicar histórico', async () => {
    const p = await accepted();
    const existing = await sales.create(ownerActor, randomUUID(), { customerId: p.customerId, items: [], installments: [] }, 'test:proposal-create');
    const free = existing.orderCode === '99999' ? '99998' : '99999'; vi.spyOn(codes, 'orderCode').mockReturnValueOnce(existing.orderCode).mockReturnValueOnce(free);
    const r = await proposals.convert(ctx(), p.id, { expectedVersion: 3 }, randomUUID(), ownerActor); expect(r.orderCode).toBe(free);
    expect((await proposals.events(ctx(), p.id, 20, 0)).items.filter(e => e.eventType === 'CONVERTED')).toHaveLength(1);
  });
  it('vencimento inclui o dia local e filtros usam o mesmo status efetivo', async () => {
    expect(effectiveProposalStatus({ status: 'SENT', validUntil: '2026-10-13' }, 'America/Sao_Paulo', new Date('2026-10-14T02:59:59Z'))).toBe('SENT');
    expect(effectiveProposalStatus({ status: 'SENT', validUntil: '2026-10-13' }, 'America/Sao_Paulo', new Date('2026-10-14T03:00:00Z'))).toBe('EXPIRED');
    const p = await create({ validUntil: '2000-01-01' });
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2000-01-01T12:00:00-03:00'));
    await proposals.transition(ctx(), p.id, 'send', { expectedVersion: 1 }, randomUUID()); vi.useRealTimers();
    expect((await proposals.get(ctx(), p.id)).effectiveStatus).toBe('EXPIRED');
    expect((await read.list(ctx(), proposalListSchema.parse({ status: 'EXPIRED' }))).total).toBe(1);
    await expect(proposals.transition(ctx(), p.id, 'accept', { expectedVersion: 2 }, randomUUID())).rejects.toMatchObject({ status: 409 });
    const copy = await proposals.duplicate(ctx(), p.id, { expectedVersion: 2 }, randomUUID()); expect(copy.status).toBe('DRAFT');
  });
  it('recusa preserva oportunidade, duplicação cria nova oferta e configurações podem desligar ganho', async () => {
    const p = await create(); await proposals.transition(ctx(), p.id, 'send', { expectedVersion: 1 }, randomUUID());
    await proposals.transition(ctx(), p.id, 'decline', { expectedVersion: 2, reason: 'Prazo incompatível' }, randomUUID());
    expect((await db.select().from(s.crmOpportunities).where(eq(s.crmOpportunities.id, p.opportunityId)))[0].commercialStatus).toBe('NEW');
    const clone = await proposals.duplicate(ctx(), p.id, { expectedVersion: 3 }, randomUUID()); expect(clone.proposalId).not.toBe(p.id);
    const settings = await proposals.settings(ctx()); await proposals.updateSettings(ctx(), { expectedVersion: settings.version, winOpportunityOnProposalConversion: false });
    const a = await accepted(); await proposals.convert(ctx(), a.id, { expectedVersion: 3 }, randomUUID(), ownerActor);
    expect((await db.select().from(s.crmOpportunities).where(eq(s.crmOpportunities.id, a.opportunityId)))[0].commercialStatus).toBe('NEW');
  });
  it('empresa isola consulta, PDF e replay; a visibilidade dentro dela é da empresa inteira (Spec 10)', async () => {
    const l = await lead({ assignedUserId: seller }); const key = randomUUID();
    const input = createProposalSchema.parse({ opportunityId: l.opportunityId, newCustomer: { kind: 'PF' }, items: [item()] });
    const p = await proposals.create(ctx(seller), input, key), id = String(p.proposalId);
    expect((await http('GET', `/crm/proposals/${id}/pdf`, undefined, other)).statusCode).toBe(200); // Spec 10
    expect((await http('GET', `/crm/proposals/${id}`, undefined, owner, companyB)).statusCode).toBe(404);
    expect((await read.list(ctx(other), proposalListSchema.parse({}))).total).toBe(1); // Spec 10
    await db.update(s.crmOpportunities).set({ assignedUserId: other }).where(eq(s.crmOpportunities.id, l.opportunityId));
    await expect(proposals.create(ctx(seller), input, key)).resolves.toMatchObject({ proposalId: p.proposalId }); // Spec 10: o replay devolve o mesmo resultado, a proposta segue visível
  });
  it('PDF autenticado é documento binário e contratos constam no Swagger', async () => {
    const p = await accepted(), response = await http('GET', `/crm/proposals/${p.id}/pdf`);
    expect(response.statusCode).toBe(200); expect(response.headers['content-type']).toContain('application/pdf'); expect(response.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    const preview = await http('GET', `/crm/proposals/${p.id}/preview`); expect(preview.json().snapshot.recipient.name).toBe('João');
    const document = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('API').setVersion('1').addBearerAuth().build());
    expect(document.paths['/crm/proposals/{id}/convert']?.post).toBeDefined(); expect(document.paths['/crm/proposals']?.post?.requestBody).toBeDefined();
  });
});

describe('permissões das propostas (D6, Spec 7.2)', () => {
  const as = (keys: PermissionKey[]) => grantMember(db, account, seller, [...closure(keys)]);
  const denied = (work: Promise<unknown>) => work.then(() => null, (e: HttpException) => e.getResponse());
  const catalogItem = () => ({ ...item(), discountInput: '0.00' });
  const fresh = async () => (await lead({ email: `${randomUUID()}@example.test` })).opportunityId;
  const input = (opportunityId: string, items: unknown[]) => createProposalSchema.parse({ opportunityId, newCustomer: { kind: 'PF' }, items });

  it('sem proposals.change_price: preço do catálogo passa; desconto ou outro preço devolvem 403', async () => {
    await as(['proposals.manage', 'customers.create']);
    expect(await denied(proposals.create(ctx(seller), input(await fresh(), [item()]), randomUUID()))).toMatchObject({ code: 'PERMISSION_DENIED', permission: 'proposals.change_price' });
    expect(await denied(proposals.create(ctx(seller), input(await fresh(), [{ ...catalogItem(), unitPrice: '2400.00' }]), randomUUID()))).toMatchObject({ permission: 'proposals.change_price' });
    await expect(proposals.create(ctx(seller), input(await fresh(), [catalogItem()]), randomUUID())).resolves.toMatchObject({ status: 'DRAFT' });
  });
  it('rascunho: manter os termos gravados passa; aumentar o desconto exige a chave; duplicar mantém', async () => {
    const p = await create();
    await as(['proposals.manage']);
    await expect(proposals.update(ctx(seller), p.id, { expectedVersion: 1, items: [item()] })).resolves.toMatchObject({ version: 2 });
    await expect(proposals.update(ctx(seller), p.id, { expectedVersion: 2, items: [{ ...item(), quantity: '3.0000' }] })).resolves.toMatchObject({ version: 3 });
    expect(await denied(proposals.update(ctx(seller), p.id, { expectedVersion: 3, items: [{ ...item(), discountInput: '15.00' }] }))).toMatchObject({ permission: 'proposals.change_price' });
    expect(await denied(proposals.update(ctx(seller), p.id, { expectedVersion: 3, items: [{ ...item(), discountType: 'AMOUNT' as const }] }))).toMatchObject({ permission: 'proposals.change_price' });
    await expect(proposals.duplicate(ctx(seller), p.id, { expectedVersion: 3 }, randomUUID())).resolves.toMatchObject({ status: 'DRAFT' });
  });
  it('desconto em R$: reduzir a quantidade com o mesmo valor exige a chave; reduzir o desconto passa (5.9)', async () => {
    const amountItem = { ...item(), discountType: 'AMOUNT' as const, discountInput: '500.00' };
    const p = await create({ items: [amountItem] });
    await as(['proposals.manage']);
    expect(await denied(proposals.update(ctx(seller), p.id, { expectedVersion: 1, items: [{ ...amountItem, quantity: '1.0000' }] }))).toMatchObject({ permission: 'proposals.change_price' });
    await expect(proposals.update(ctx(seller), p.id, { expectedVersion: 1, items: [{ ...amountItem, quantity: '1.0000', discountInput: '250.00' }] })).resolves.toMatchObject({ version: 2 });
  });
  it('cliente novo exige customers.create; negociação nova exige crm.create', async () => {
    await as(['proposals.manage', 'proposals.change_price']);
    const before = await customerCount();
    expect(await denied(proposals.create(ctx(seller), input(await fresh(), [item()]), randomUUID()))).toMatchObject({ permission: 'customers.create' });
    expect(await customerCount()).toBe(before);
    const p = await create();
    const withOpportunity = () => createProposalSchema.parse({ customerId: p.customerId, createOpportunity: true, items: [item()] });
    expect(await denied(proposals.create(ctx(seller), withOpportunity(), randomUUID()))).toMatchObject({ permission: 'crm.create' });
    await as(['proposals.manage', 'proposals.change_price', 'crm.create']);
    await expect(proposals.create(ctx(seller), withOpportunity(), randomUUID())).resolves.toMatchObject({ customerId: p.customerId });
  });
});
