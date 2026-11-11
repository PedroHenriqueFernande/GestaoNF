// backend/tests/nero-fixture.ts — TEMPORÁRIO (apagar na limpeza da Fase 3)
import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { vi } from 'vitest';
import * as schema from '@gestaonf/database/schema';
import type { DatabaseService } from '../src/database/database.module.js';
import { WhatsAppLinkService } from '../src/whatsapp/whatsapp-link.service.js';
import { WhatsAppOutboundService } from '../src/whatsapp/whatsapp-outbound.service.js';
import { MetaMediaClient } from '../src/whatsapp/meta-media.client.js';
import { ActionService } from '../src/assistant/actions/action.service.js';
import { AgentOrchestrator } from '../src/assistant/agent-orchestrator.service.js';
import { AudioTranscriptionService } from '../src/assistant/audio/audio-transcription.service.js';
import { OpenAITranscriber } from '../src/assistant/audio/transcriber.js';
import { ConversationService } from '../src/assistant/conversation.service.js';
import { loadExecutionContext, type ExecutionContext } from '../src/assistant/execution-context.js';
import type { ModelRequest, ModelResponse, NeroModel } from '../src/assistant/model/nero-model.js';
import { NiloService } from '../src/assistant/nilo.service.js';
import { createToolRegistry, type ReadServices } from '../src/assistant/tools/index.js';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import { FinanceReadService } from '../src/finance/finance-read.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import type { FilesService } from '../src/files/files.service.js';
import type { FiscalService } from '../src/fiscal/fiscal.service.js';
import { testAccount } from './account-fixture.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export type NeroTestEnv = Awaited<ReturnType<typeof createNeroTestEnv>>;

export async function createNeroTestEnv() {
  const databaseUrl = process.env.NERO_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina DATABASE_URL ou NERO_TEST_DATABASE_URL para executar os testes isolados');
  const name = `gestaonf_nero_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(databaseUrl); url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  const migrationsFolder = fileURLToPath(new URL('../database/drizzle', import.meta.url));
  for (const migration of readMigrationFiles({ migrationsFolder })) for (const statement of migration.sql) await client.unsafe(statement);
  const db = drizzle(client, { schema });
  const database = { db } as DatabaseService;
  vi.stubEnv('META_WHATSAPP_ENABLED', 'true'); vi.stubEnv('META_APP_ID', 'nero-test-app'); vi.stubEnv('META_WABA_ID', 'nero-test-waba');
  vi.stubEnv('META_PHONE_NUMBER_ID', 'nero-test-phone'); vi.stubEnv('META_DISPLAY_PHONE_NUMBER', '15550000000');
  vi.stubEnv('NILO_ENABLED', 'false'); vi.stubEnv('OPENAI_API_KEY', '');
  const links = new WhatsAppLinkService(database);
  const connection = await links.ensurePlatformConnection();
  if (!connection) throw new Error('Conexão de teste não criada');
  async function close() {
    vi.unstubAllEnvs();
    await client.end();
    if (!/^gestaonf_nero_test_[a-f0-9]{12}$/.test(name)) throw new Error('Banco de teste inválido');
    await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await admin.end();
  }
  return { db, database, links, connectionId: connection.id, close };
}

export const randomSender = () => '55' + BigInt('0x' + randomUUID().replace(/-/g, '').slice(0, 10)).toString().padStart(12, '0');

export async function seedOperator(env: NeroTestEnv, companyNames: string[], role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'COLLABORATOR' = 'OWNER') {
  const [user] = await env.db.insert(schema.users).values({ name: 'Operador', email: `${randomUUID()}@example.test` }).returning();
  const accountId = await testAccount(env.db, user.id);
  const companies = await env.db.insert(schema.companies).values(companyNames.map((name) => ({ accountId, name }))).returning();
  await env.db.insert(schema.companyUsers).values(companies.map((company) => ({ companyId: company.id, userId: user.id, role })));
  const senderId = randomSender();
  let linkId: string | undefined;
  for (const company of companies) {
    const challenge = await env.links.createChallenge(user.id, company.id, linkId ? { mode: 'EXISTING_NUMBER', linkId } : {});
    const text = new URL(challenge.waLink).searchParams.get('text')!;
    const captured = await env.links.captureCandidate(env.connectionId, senderId, senderId, text);
    if (!captured?.accepted) throw new Error('Vínculo de teste recusado');
    await env.links.confirm(user.id, company.id, challenge.challengeId);
    linkId = (await env.links.status(user.id, company.id)).link!.linkId;
  }
  return { userId: user.id, companies, senderId, linkId: linkId! };
}

export async function insertInbound(env: NeroTestEnv, senderId: string, text: string | null,
  options: { messageType?: string; payload?: Record<string, unknown>; receivedAt?: Date } = {}) {
  const [event] = await env.db.insert(schema.whatsappInboxEvents).values({
    connectionId: env.connectionId, providerMessageId: `test:${randomUUID()}`, senderId, eventType: 'MESSAGE',
    messageType: options.messageType ?? 'text', messageText: text, payload: options.payload ?? {},
    ...(options.receivedAt ? { receivedAt: options.receivedAt } : {}),
  }).returning();
  return event;
}

/** Payload de clique em botão, no formato do webhook da Meta. */
export const buttonPayload = (id: string, title: string) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });

/** CPF e CNPJ válidos (dígitos verificadores corretos) para testes. */
export const VALID_CPF = '52998224725';
export const VALID_CPF_2 = '11144477735';
export const VALID_CNPJ = '11222333000181';

/** Serviços de leitura reais sobre o banco temporário (list/get de vendas não usam arquivos nem fiscal). */
export function readServices(env: NeroTestEnv): ReadServices {
  return {
    customers: new CustomersService(env.database),
    services: new ServicesService(env.database),
    sales: new SalesService(env.database, {} as FilesService, {} as FiscalService),
    finance: new FinanceReadService(env.database),
    reports: new ReportsReadService(env.database, new CrmPolicyService(env.database)),
  };
}

export async function contextFor(env: NeroTestEnv, operator: Awaited<ReturnType<typeof seedOperator>>, conversationId: string, runId: string, companyIndex = 0): Promise<ExecutionContext> {
  const eligible = await env.links.eligibleCompanies(operator.linkId, operator.userId);
  const company = eligible[companyIndex];
  const ctx = await loadExecutionContext(env.db, { channel: 'WHATSAPP', userId: operator.userId, companyId: company.companyId, companyLinkId: company.companyLinkId, companyName: company.name, companyCount: eligible.length, linkId: operator.linkId, conversationId, runId });
  if (!ctx) throw new Error('Contexto indisponível');
  return ctx;
}

/** Conversa ACTIVE + execução registrada, como o NiloService faria. */
export async function activeConversation(env: NeroTestEnv, operator: Awaited<ReturnType<typeof seedOperator>>, companyIndex = 0) {
  const eligible = await env.links.eligibleCompanies(operator.linkId, operator.userId);
  const company = eligible[companyIndex];
  const [conversation] = await env.db.insert(schema.neroConversations).values({ linkId: operator.linkId, userId: operator.userId, status: 'ACTIVE', companyId: company.companyId, companyLinkId: company.companyLinkId }).returning();
  const event = await insertInbound(env, operator.senderId, 'teste');
  const [run] = await env.db.insert(schema.assistantRuns).values({ inboxEventId: event.id, linkId: operator.linkId, companyId: company.companyId, companyLinkId: company.companyLinkId, userId: operator.userId, model: 'teste' }).returning();
  return { conversation, run, ctx: await contextFor(env, operator, conversation.id, run.id, companyIndex) };
}

export class ScriptedModel implements NeroModel {
  readonly name = 'roteiro';
  readonly requests: ModelRequest[] = [];
  constructor(private readonly steps: ((request: ModelRequest) => ModelResponse)[]) {}
  enabled() { return true; }
  async respond(request: ModelRequest) {
    this.requests.push(JSON.parse(JSON.stringify(request)));
    const step = this.steps.shift();
    if (!step) throw new Error('Roteiro do modelo esgotado');
    return step(request);
  }
}

export const say = (text: string) => (): ModelResponse => ({
  output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }], outputText: text, usage: { input_tokens: 10, output_tokens: 5 },
});

export const callTool = (name: string, args: unknown) => (): ModelResponse => ({
  output: [{ type: 'function_call', name, call_id: `call_${randomUUID()}`, arguments: JSON.stringify(args) }], outputText: '', usage: { input_tokens: 10, output_tokens: 5 },
});

export const seenText = (request: ModelRequest) => JSON.stringify(request);

/** NiloService completo sobre o banco temporário, com o modelo informado e o registro padrão. */
export function buildNero(env: NeroTestEnv, model: NeroModel) {
  const registry = createToolRegistry(env.database, readServices(env));
  const actions = new ActionService(env.database, registry);
  const outbound = new WhatsAppOutboundService(env.database);
  const nero = new NiloService(
    env.database, env.links, outbound, new ConversationService(env.database), actions,
    new AgentOrchestrator(env.database, model, registry, actions),
    new AudioTranscriptionService(env.database, new MetaMediaClient(), new OpenAITranscriber()),
  );
  return { nero, registry, actions };
}
