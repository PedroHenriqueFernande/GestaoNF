import 'reflect-metadata';
import { testAccount } from './account-fixture.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { and, eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { DatabaseService } from '../src/database/database.module.js';
import { WhatsAppLinkService } from '../src/whatsapp/whatsapp-link.service.js';
import { WhatsAppOutboundService } from '../src/whatsapp/whatsapp-outbound.service.js';
import { CompanyRequestService } from '../src/assistant/company-request.service.js';
import { NiloService } from '../src/assistant/nilo.service.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const testDatabaseName = `gestaonf_nero_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
let admin: ReturnType<typeof postgres>, client: ReturnType<typeof postgres>;
let db: ReturnType<typeof drizzle<typeof schema>>, links: WhatsAppLinkService, outbound: WhatsAppOutboundService, requests: CompanyRequestService, nero: NiloService;
let connectionId: string, userId: string, companyA: string, companyB: string, companyC: string;
const phone = () => '55' + BigInt('0x' + randomUUID().replace(/-/g, '').slice(0, 10)).toString().padStart(12, '0');
const legacy = { user: randomUUID(), a: randomUUID(), b: randomUUID(), link: randomUUID(), orphanUser: randomUUID(), orphanLink: randomUUID() };

beforeAll(async () => {
  const databaseUrl = process.env.NERO_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina DATABASE_URL ou NERO_TEST_DATABASE_URL para executar os testes isolados');
  admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${testDatabaseName}"`);
  const url = new URL(databaseUrl); url.pathname = `/${testDatabaseName}`;
  client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  const migrationsFolder = fileURLToPath(new URL('../../../packages/database/drizzle', import.meta.url));
  const migrations = readMigrationFiles({ migrationsFolder });
  const journal = JSON.parse(readFileSync(`${migrationsFolder}/meta/_journal.json`, 'utf8')) as { entries: { tag: string }[] };
  const revisionIndex = journal.entries.findIndex((entry) => entry.tag === '0015_nero_company_links');
  if (revisionIndex < 0) throw new Error('Migration dos vínculos não encontrada');
  for (const migration of migrations.slice(0, revisionIndex)) for (const statement of migration.sql) await client.unsafe(statement);
  const [connection] = await client`INSERT INTO whatsapp_connections (ownership, environment, meta_app_id, messaging_account_id, phone_number_id, display_phone_number) VALUES ('PLATFORM', 'DEVELOPMENT', 'nero-test-app', 'nero-test-waba', 'nero-test-phone', '15550000000') RETURNING id`;
  connectionId = connection.id;
  const proofTime = new Date('2026-10-01T15:00:00.000Z');
  await client`INSERT INTO users (id, name, email) VALUES (${legacy.user}, 'Legacy', 'legacy@example.test'), (${legacy.orphanUser}, 'Orphan', 'orphan@example.test')`;
  await client`INSERT INTO companies (id, name) VALUES (${legacy.a}, 'Original do QR'), (${legacy.b}, 'Empresa trocada no site')`;
  await client`INSERT INTO company_users (company_id, user_id, role) VALUES (${legacy.a}, ${legacy.user}, 'OWNER'), (${legacy.b}, ${legacy.user}, 'OWNER')`;
  await client`INSERT INTO whatsapp_links (id, connection_id, user_id, sender_id, verified_at) VALUES (${legacy.link}, ${connectionId}, ${legacy.user}, '5511000000001', ${proofTime}), (${legacy.orphanLink}, ${connectionId}, ${legacy.orphanUser}, '5511000000002', ${proofTime})`;
  await client`INSERT INTO whatsapp_link_challenges (connection_id, user_id, company_id, token_hash, candidate_sender_id, status, expires_at, confirmed_at) VALUES (${connectionId}, ${legacy.user}, ${legacy.a}, ${'a'.repeat(64)}, '5511000000001', 'CONFIRMED', ${new Date(proofTime.getTime() + 600000)}, ${proofTime})`;
  await client`INSERT INTO whatsapp_sessions (link_id, user_id, active_company_id) VALUES (${legacy.link}, ${legacy.user}, ${legacy.b})`;
  for (const migration of migrations.slice(revisionIndex)) for (const statement of migration.sql) await client.unsafe(statement);
  db = drizzle(client, { schema });
  const database = { db } as DatabaseService;
  links = new WhatsAppLinkService(database); outbound = new WhatsAppOutboundService(database);
  requests = new CompanyRequestService(database, links, outbound);
  nero = new NiloService(database, links, outbound, requests);
  vi.stubEnv('META_WHATSAPP_ENABLED', 'true'); vi.stubEnv('META_APP_ID', 'nero-test-app'); vi.stubEnv('META_WABA_ID', 'nero-test-waba'); vi.stubEnv('META_PHONE_NUMBER_ID', 'nero-test-phone'); vi.stubEnv('META_DISPLAY_PHONE_NUMBER', '15550000000');
  vi.stubEnv('NILO_ENABLED', 'false'); vi.stubEnv('OPENAI_API_KEY', '');
}, 60000);

afterAll(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  if (client) await client.end();
  if (admin) {
    if (!/^gestaonf_nero_test_[a-f0-9]{12}$/.test(testDatabaseName)) throw new Error('Banco de teste inválido');
    await admin.unsafe(`DROP DATABASE IF EXISTS "${testDatabaseName}" WITH (FORCE)`);
    await admin.end();
  }
});

beforeEach(async () => {
  vi.restoreAllMocks();
  [ { id: userId } ] = await db.insert(schema.users).values({ name: 'Operador', email: `${randomUUID()}@example.test` }).returning();
  const accountId = await testAccount(db, userId);
  const companies = await db.insert(schema.companies).values([{ accountId, name: 'Empresa A' }, { accountId, name: 'Empresa B' }, { accountId, name: 'Empresa C' }]).returning();
  [companyA, companyB, companyC] = companies.map((company) => company.id);
  await db.insert(schema.companyUsers).values(companies.map((company) => ({ companyId: company.id, userId, role: 'OWNER' })));
});

async function pair(companyId: string, senderId: string, existingLinkId?: string) {
  const challenge = await links.createChallenge(userId, companyId, existingLinkId ? { mode: 'EXISTING_NUMBER', linkId: existingLinkId } : {});
  const text = new URL(challenge.waLink).searchParams.get('text')!;
  expect((await links.captureCandidate(connectionId, senderId, senderId, text))?.accepted).toBe(true);
  await links.confirm(userId, companyId, challenge.challengeId);
  return (await links.status(userId, companyId)).link!;
}

async function inbound(senderId: string, text: string, payload: Record<string, unknown> = {}) {
  const [event] = await db.insert(schema.whatsappInboxEvents).values({ connectionId, providerMessageId: `test:${randomUUID()}`, senderId, eventType: 'MESSAGE', messageType: 'text', messageText: text, payload }).returning();
  await nero.processInboxEvent(event.id);
  return event;
}

describe('vínculos por empresa', () => {
  it('migra pela prova do QR e não pela empresa mutável da sessão; origem desconhecida não ganha empresas', async () => {
    const migrated = await db.select().from(schema.whatsappLinkCompanies).where(eq(schema.whatsappLinkCompanies.linkId, legacy.link));
    expect(migrated.map((item) => item.companyId)).toEqual([legacy.a]);
    expect(await db.select().from(schema.whatsappLinkCompanies).where(eq(schema.whatsappLinkCompanies.linkId, legacy.orphanLink))).toHaveLength(0);
  });

  it('mantém o mesmo número em duas empresas, e acesso no site sozinho não cria vínculo', async () => {
    const sender = phone(), a = await pair(companyA, sender);
    expect((await links.status(userId, companyB)).linked).toBe(false);
    const b = await pair(companyB, sender, a.linkId);
    expect(b.linkId).toBe(a.linkId);
    expect((await links.eligibleCompanies(a.linkId, userId)).map((item) => item.companyId)).toEqual([companyA, companyB]);
    expect((await links.status(userId, companyC)).linked).toBe(false);
  });

  it('permite números distintos por empresa e desconectar B preserva A', async () => {
    const a = await pair(companyA, phone()), b = await pair(companyB, phone());
    expect(a.linkId).not.toBe(b.linkId);
    await links.disconnect(userId, companyB);
    expect((await links.status(userId, companyA)).linked).toBe(true);
    expect((await links.status(userId, companyB)).linked).toBe(false);
    expect((await links.status(userId, companyA)).verifiedNumbers.map((item) => item.id)).toEqual([a.linkId]);
  });

  it('desconexão do número compartilhado revoga só a associação selecionada', async () => {
    const sender = phone(), a = await pair(companyA, sender);
    await pair(companyB, sender, a.linkId);
    await links.disconnect(userId, companyB);
    expect((await links.status(userId, companyA)).linked).toBe(true);
    expect(await links.eligibleCompanies(a.linkId, userId)).toHaveLength(1);
    await links.disconnect(userId, companyA);
    expect((await links.status(userId, companyA)).verifiedNumbers).toHaveLength(0);
  });

  it('recusa número inesperado no modo reutilizar e challenge de outra empresa', async () => {
    const sender = phone(), a = await pair(companyA, sender);
    const challenge = await links.createChallenge(userId, companyB, { mode: 'EXISTING_NUMBER', linkId: a.linkId });
    const text = new URL(challenge.waLink).searchParams.get('text')!;
    expect((await links.captureCandidate(connectionId, phone(), null, text))?.accepted).toBe(false);
    await expect(links.confirm(userId, companyA, challenge.challengeId)).rejects.toThrow();
    await expect(links.challengeStatus(userId, companyA, challenge.challengeId)).rejects.toThrow();
    expect((await links.status(userId, companyB)).linked).toBe(false);
  });

  it('não permite apropriar número nem reutilizar identidade de outro usuário', async () => {
    const sender = phone(), a = await pair(companyA, sender);
    const [other] = await db.insert(schema.users).values({ name: 'Outro', email: `${randomUUID()}@example.test` }).returning();
    await db.insert(schema.companyUsers).values({ userId: other.id, companyId: companyB, role: 'OWNER' });
    await expect(links.createChallenge(other.id, companyB, { mode: 'EXISTING_NUMBER', linkId: a.linkId })).rejects.toThrow();
    const challenge = await links.createChallenge(other.id, companyB);
    expect((await links.captureCandidate(connectionId, sender, sender, new URL(challenge.waLink).searchParams.get('text')!))?.accepted).toBe(false);
    await expect(links.confirm(other.id, companyB, challenge.challengeId)).rejects.toThrow();
  });

  it('QRs de empresas distintas não se cancelam e confirmação concorrente é idempotente', async () => {
    const a = await links.createChallenge(userId, companyA), b = await links.createChallenge(userId, companyB);
    expect((await links.challengeStatus(userId, companyA, a.challengeId)).status).toBe('PENDING');
    const sender = phone();
    await links.captureCandidate(connectionId, sender, sender, new URL(a.waLink).searchParams.get('text')!);
    await Promise.all([links.confirm(userId, companyA, a.challengeId), links.confirm(userId, companyA, a.challengeId)]);
    expect(await db.select().from(schema.whatsappLinkCompanies).where(eq(schema.whatsappLinkCompanies.challengeId, a.challengeId))).toHaveLength(1);
    expect((await links.challengeStatus(userId, companyB, b.challengeId)).status).toBe('PENDING');
  });

  it('não aceita token expirado ou confirmação após remoção de acesso', async () => {
    const challenge = await links.createChallenge(userId, companyA), sender = phone();
    const text = new URL(challenge.waLink).searchParams.get('text')!;
    await db.update(schema.whatsappLinkChallenges).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.whatsappLinkChallenges.id, challenge.challengeId));
    expect((await links.captureCandidate(connectionId, sender, sender, text))?.accepted).toBe(false);
    const next = await links.createChallenge(userId, companyA);
    await links.captureCandidate(connectionId, sender, sender, new URL(next.waLink).searchParams.get('text')!);
    await db.update(schema.companyUsers).set({ status: 'INACTIVE' }).where(and(eq(schema.companyUsers.userId, userId), eq(schema.companyUsers.companyId, companyA)));
    await expect(links.confirm(userId, companyA, next.challengeId)).rejects.toThrow();
  });

  it('remetente já conhecido pode enviar um novo challenge sem chamar IA', async () => {
    const sender = phone(), a = await pair(companyA, sender);
    const challenge = await links.createChallenge(userId, companyB, { mode: 'EXISTING_NUMBER', linkId: a.linkId });
    const event = await inbound(sender, new URL(challenge.waLink).searchParams.get('text')!);
    expect((await links.challengeStatus(userId, companyB, challenge.challengeId)).status).toBe('CANDIDATE');
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, event.id))).toHaveLength(0);
    await links.confirm(userId, companyB, challenge.challengeId);
  });
});

describe('seleção da empresa por solicitação', () => {
  it('pergunta em cada pedido, preserva o original e não usa a empresa do cabeçalho', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    await db.update(schema.whatsappSessions).set({ activeCompanyId: companyC }).where(eq(schema.whatsappSessions.linkId, a.linkId));
    const first = await inbound(sender, 'Mostre as vendas deste mês');
    const [request] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, first.id));
    expect(request.status).toBe('AWAITING_COMPANY'); expect(request.companyId).toBeNull();
    expect(request.options.map((item) => item.companyId)).toEqual([companyA, companyB]);
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, first.id))).toHaveLength(0);
    const answer = await inbound(sender, '1');
    const [run] = await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, answer.id));
    expect(run.companyId).toBe(companyA); expect(run.status).toBe('COMPLETED');
    const second = await inbound(sender, 'Mostre as vendas do mês passado');
    const [next] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, second.id));
    expect(next.status).toBe('AWAITING_COMPANY'); expect(next.companyId).toBeNull();
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, second.id))).toHaveLength(0);
  });

  it('seleciona automaticamente apenas para o número com uma empresa', async () => {
    const aSender = phone(), bSender = phone();
    await pair(companyA, aSender); await pair(companyB, bSender);
    const event = await inbound(bSender, 'vendas deste mês');
    const [run] = await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, event.id));
    expect(run.companyId).toBe(companyB); expect(run.status).toBe('COMPLETED');
  });

  it('seleção expirada, de outro remetente ou associação revogada não consulta dados', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    const event = await inbound(sender, 'vendas deste mês');
    const [request] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, event.id));
    const foreign = await inbound(phone(), `${request.selectionCode}-1`);
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, foreign.id))).toHaveLength(0);
    await links.disconnect(userId, companyB);
    const revoked = await inbound(sender, '2');
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, revoked.id))).toHaveLength(0);
    await pair(companyB, sender, a.linkId);
    const nextEvent = await inbound(sender, 'vendas deste mês');
    const [next] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, nextEvent.id));
    await db.update(schema.whatsappRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.whatsappRequests.id, next.id));
    const expired = await inbound(sender, `${next.selectionCode}-1`);
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, expired.id))).toHaveLength(0);
  });

  it('pedidos pendentes distintos exigem uma escolha referente ao pedido correto', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    const first = await inbound(sender, 'vendas deste mês'); await inbound(sender, 'vendas do mês passado');
    const ambiguous = await inbound(sender, '1');
    expect(await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, ambiguous.id))).toHaveLength(0);
    const [request] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, first.id));
    const selected = await inbound(sender, `${request.selectionCode}-2`);
    const [run] = await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, selected.id));
    expect(run.companyId).toBe(companyB);
  });

  it('revalida o vínculo antes do envio e preserva o contexto empresarial da resposta', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    await inbound(sender, 'vendas deste mês'); const event = await inbound(sender, '2');
    const [message] = await db.select().from(schema.whatsappOutboundMessages).where(eq(schema.whatsappOutboundMessages.logicalKey, `nilo:${event.id}`));
    expect(message.companyId).toBe(companyB); expect(await links.canSend(message)).toBe(true);
    await links.disconnect(userId, companyB);
    expect(await links.canSend(message)).toBe(false);
    expect((await links.status(userId, companyA)).linked).toBe(true);
  });

  it('esclarecimento mantém a empresa do mesmo pedido; pedido seguinte pergunta novamente', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    const answer = vi.spyOn(nero as any, 'answerWithOpenAI').mockResolvedValueOnce({ text: 'Qual período?', toolCallCount: 1, usage: null, needsFollowUp: true, conversation: [{ role: 'user', content: 'vendas' }] })
      .mockResolvedValueOnce({ text: 'Relatório', toolCallCount: 1, usage: null, needsFollowUp: false, conversation: [] });
    const first = await inbound(sender, 'Mostre minhas vendas'); await inbound(sender, '2');
    const [original] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, first.id));
    const followup = await inbound(sender, `${original.selectionCode}: mês passado`);
    expect(answer.mock.calls[1][0]).toMatchObject({ companyId: companyB, text: 'mês passado' });
    const [run] = await db.select().from(schema.assistantRuns).where(eq(schema.assistantRuns.inboxEventId, followup.id));
    expect(run.companyId).toBe(companyB);
    const next = await inbound(sender, 'vendas deste mês');
    const [request] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, next.id));
    expect(request.status).toBe('AWAITING_COMPANY');
  });

  it('novo pedido durante um esclarecimento não herda a empresa anterior', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    const answer = vi.spyOn(nero as any, 'answerWithOpenAI').mockResolvedValue({ text: 'Qual período?', toolCallCount: 1, usage: null, needsFollowUp: true, conversation: [{ role: 'user', content: 'vendas' }] });
    await inbound(sender, 'Mostre minhas vendas'); await inbound(sender, '1');
    const next = await inbound(sender, 'Quantas vendas foram feitas neste mês?');
    const [request] = await db.select().from(schema.whatsappRequests).where(eq(schema.whatsappRequests.sourceInboxEventId, next.id));
    expect(request.status).toBe('AWAITING_COMPANY'); expect(request.companyId).toBeNull();
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it('opt-out global desconecta as empresas do remetente, preservando outro número do usuário', async () => {
    const sender = phone(), a = await pair(companyA, sender); await pair(companyB, sender, a.linkId);
    const c = await pair(companyC, phone());
    await inbound(sender, 'parar todas as mensagens');
    expect((await links.status(userId, companyA)).linked).toBe(false);
    expect((await links.status(userId, companyB)).linked).toBe(false);
    expect((await links.status(userId, companyC)).link?.linkId).toBe(c.linkId);
  });
});
