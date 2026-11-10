# Assistente de suporte — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widget de chat no canto inferior direito que orienta o usuário, gera os 8 relatórios em PDF, cadastra cliente/serviço com confirmação e localiza vendas para emissão de NFS-e.

**Architecture:** Novo módulo NestJS `backend/src/support/` (separado do Nero em `backend/src/assistant/`). Um orquestrador chama a OpenAI Responses API atrás da interface `SupportLlmClient`, executa tools validadas por Zod e devolve blocos tipados gerados pelo servidor. Escritas viram ações pendentes (`support_actions`) confirmadas por um endpoint sem IA. O frontend ganha `features/support/`, montado no `WorkspaceLayout`. O PDF de relatório é um serviço novo do `ReportsModule`.

**Tech Stack:** NestJS 12 + Fastify, Drizzle ORM (Postgres), Zod 4, SDK `openai` 7.x (Responses API), `pdfkit`, Vitest 5; React 19, TanStack Query 5, react-router 7, lucide-react, Playwright.

**Spec:** [../specs/2026-11-10-assistente-suporte-design.md](../specs/2026-11-10-assistente-suporte-design.md)

---

## Convenções para quem executa

- Tudo em português nas mensagens de UI e nos textos do modelo. Nomes de código em inglês, como o restante do repositório.
- **Testes ficam no repositório.** Esta feature é exceção explícita ao `ArquivosMD/procedimento-padrao-testes.md` (decisão do Pedro). Não apague os arquivos de teste. Apague apenas artefatos gerados (`test-results/`, `playwright-report/`, `coverage/`).
- Testes do backend usam Postgres local: o `DATABASE_URL` do `.env` da raiz. Cada arquivo cria e destrói o próprio banco `gestaonf_<rótulo>_test_<hex>`.
- Rodar comandos do backend dentro de `backend/` e do frontend dentro de `frontend/`.
- Commits no padrão do repositório (`Feat: ...`), terminando com a linha:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- Branch de trabalho: `feat/assistente-suporte` (já existe).

## Mapa de arquivos

**Backend — criar**

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/support/support-config.ts` | Lê as variáveis `SUPPORT_*`; token `SUPPORT_CONFIG` |
| `backend/src/support/llm/support-llm.client.ts` | Interface `SupportLlmClient`, `SupportLlmError`, `toSupportLlmError`, `toHistoryItems`, token `SUPPORT_LLM` |
| `backend/src/support/llm/openai-support-llm.client.ts` | Adapter OpenAI Responses API |
| `backend/src/support/support-blocks.ts` | Tipos de bloco, destinos permitidos, construtores e `isSafeBlock` |
| `backend/src/support/help-catalog.ts` | Parser de frontmatter e `SupportHelpCatalog` |
| `backend/src/support/help/*.md` | 17 artigos de ajuda |
| `backend/src/support/support-errors.ts` | `httpMessage()` para extrair mensagem de `HttpException` |
| `backend/src/support/support-conversations.service.ts` | Conversa ativa, mensagens, histórico e contagem diária |
| `backend/src/support/support-actions.service.ts` | Ações pendentes: preparar, confirmar, cancelar e expirar |
| `backend/src/support/tools/tool-types.ts` | Tipos `ToolContext`, `ToolResult`, `ToolSpec` |
| `backend/src/support/tools/help.tool.ts` | `buscar_ajuda` |
| `backend/src/support/tools/navigate.tool.ts` | `abrir_tela` |
| `backend/src/support/tools/report-pdf.tool.ts` | `gerar_relatorio_pdf` |
| `backend/src/support/tools/find-sale.tool.ts` | `localizar_venda_para_emissao` |
| `backend/src/support/tools/customer-draft.tool.ts` | `preparar_cadastro_cliente` |
| `backend/src/support/tools/service-draft.tool.ts` | `preparar_cadastro_servico` |
| `backend/src/support/tools/tool-registry.ts` | `SupportToolRegistry`: definições, validação e despacho |
| `backend/src/support/support-instructions.ts` | Monta as instruções do modelo |
| `backend/src/support/support-chat.service.ts` | Orquestra uma mensagem |
| `backend/src/support/support.schemas.ts` | Zod das entradas HTTP |
| `backend/src/support/support.controller.ts` | Endpoints `/support/*` |
| `backend/src/support/support.module.ts` | Módulo Nest |
| `backend/src/reports/report-pdf-definitions.ts` | Título, colunas e indicadores de cada relatório no PDF |
| `backend/src/reports/reports-pdf.ts` | Renderizador `pdfkit` + `formatCell` |
| `backend/src/reports/reports-pdf.service.ts` | Lê os dados e renderiza o PDF |
| `backend/scripts/check-support-ai.ts` | `npm run support:check` (chamada real à API) |
| `backend/tests/support-db.ts` | Helper: banco de teste e seed |
| `backend/tests/support-fakes.ts` | `FakeSupportLlmClient` e respostas roteirizadas |
| `backend/tests/support-*.test.ts`, `backend/tests/reports-pdf.test.ts` | Testes |

**Backend — modificar:** `backend/database/src/schema.ts` (3 tabelas), `backend/database/drizzle/` (migração gerada), `backend/src/reports/reports-read.service.ts` (`readAll`), `backend/src/reports/reports.controller.ts` (rota PDF), `backend/src/reports/reports.module.ts`, `backend/src/services/services.module.ts` (exportar `ServicesService`), `backend/src/app.module.ts`, `backend/package.json` (script), `.env.example`.

**Frontend — criar:** `frontend/src/features/support/` com `SupportWidget.tsx`, `SupportPanel.tsx`, `SupportBlocks.tsx`, `SupportText.tsx`, `QuickActions.tsx`, `ReportPdfForm.tsx`, `SupportHelp.tsx`, `download.ts` e `support.css`; mais `frontend/tests/support-widget.spec.ts` e `frontend/playwright.support.config.ts`.

**Frontend — modificar:** `frontend/src/api/client.ts`, `frontend/src/components/WorkspaceLayout.tsx`, `frontend/src/features/reports/ReportsPage.tsx`, `frontend/src/features/reports/reports.css`, `frontend/src/features/sales/SalesPage.tsx`.

---

### Task 1: Tabelas do suporte, migração e helpers de teste

**Files:**
- Modify: `backend/database/src/schema.ts` (adicionar ao final do arquivo)
- Create: `backend/database/drizzle/0031_*.sql` (gerado pelo drizzle-kit)
- Create: `backend/tests/support-db.ts`
- Test: `backend/tests/support-schema.test.ts`

- [ ] **Step 1: Criar o helper de banco de teste**

`backend/tests/support-db.ts`:

```ts
import 'reflect-metadata';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import * as schema from '@gestaonf/database/schema';
import type { DatabaseService } from '../src/database/database.module.js';
import { testAccount } from './account-fixture.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

export type TestDb = ReturnType<typeof drizzle<typeof schema>>;
export type TestDatabase = { db: TestDb; database: DatabaseService; drop: () => Promise<void> };

export async function createTestDatabase(label: string): Promise<TestDatabase> {
  const databaseUrl = process.env.SUPPORT_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Defina DATABASE_URL para executar os testes do suporte');
  const name = `gestaonf_${label}_test_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  if (!/^gestaonf_[a-z]+_test_[a-f0-9]{12}$/.test(name)) throw new Error('Nome de banco de teste inválido');
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE "${name}"`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const client = postgres(url.toString(), { max: 10, onnotice: () => {} });
  const migrationsFolder = fileURLToPath(new URL('../database/drizzle', import.meta.url));
  for (const migration of readMigrationFiles({ migrationsFolder })) {
    for (const statement of migration.sql) await client.unsafe(statement);
  }
  const db = drizzle(client, { schema });
  return {
    db,
    database: { db } as DatabaseService,
    async drop() {
      await client.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}

export async function seedCompany(db: TestDb, name = 'Empresa A') {
  const [user] = await db.insert(schema.users).values({ name: 'Operador', email: `${randomUUID()}@example.test` }).returning();
  const accountId = await testAccount(db, user.id);
  const [company] = await db.insert(schema.companies).values({ accountId, name }).returning();
  await db.insert(schema.companyUsers).values({ companyId: company.id, userId: user.id, role: 'OWNER' });
  return { userId: user.id, companyId: company.id, accountId };
}

export async function addMember(db: TestDb, companyId: string, role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'COLLABORATOR' = 'COLLABORATOR') {
  const [user] = await db.insert(schema.users).values({ name: 'Colega', email: `${randomUUID()}@example.test` }).returning();
  await db.insert(schema.companyUsers).values({ companyId, userId: user.id, role });
  return user.id;
}
```

- [ ] **Step 2: Escrever o teste do schema (falha porque as tabelas não existem)**

`backend/tests/support-schema.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '@gestaonf/database/schema';
import { createTestDatabase, seedCompany, type TestDatabase } from './support-db.js';

let t: TestDatabase;
beforeAll(async () => { t = await createTestDatabase('supportschema'); }, 120000);
afterAll(async () => { await t?.drop(); });

describe('tabelas do assistente de suporte', () => {
  it('permite uma única conversa ativa por usuário e empresa', async () => {
    const { companyId, userId } = await seedCompany(t.db);
    await t.db.insert(schema.supportConversations).values({ companyId, userId });
    await expect(t.db.insert(schema.supportConversations).values({ companyId, userId })).rejects.toThrow();
    await t.db.insert(schema.supportConversations).values({ companyId, userId, status: 'CLOSED', closedAt: new Date() });
  });

  it('permite uma única ação pendente por conversa', async () => {
    const { companyId, userId } = await seedCompany(t.db);
    const [conversation] = await t.db.insert(schema.supportConversations).values({ companyId, userId }).returning();
    const [message] = await t.db.insert(schema.supportMessages).values({ conversationId: conversation.id, companyId, role: 'assistant', blocks: [] }).returning();
    const action = { conversationId: conversation.id, messageId: message.id, companyId, userId, kind: 'CREATE_CUSTOMER', payload: { kind: 'PF', name: 'Ana' }, expiresAt: new Date(Date.now() + 60000) };
    await t.db.insert(schema.supportActions).values(action);
    await expect(t.db.insert(schema.supportActions).values(action)).rejects.toThrow();
    await t.db.insert(schema.supportActions).values({ ...action, status: 'CANCELED' });
  });

  it('rejeita papel de mensagem e tipo de ação inválidos', async () => {
    const { companyId, userId } = await seedCompany(t.db);
    const [conversation] = await t.db.insert(schema.supportConversations).values({ companyId, userId }).returning();
    await expect(t.db.insert(schema.supportMessages).values({ conversationId: conversation.id, companyId, role: 'system', blocks: [] })).rejects.toThrow();
    const [message] = await t.db.insert(schema.supportMessages).values({ conversationId: conversation.id, companyId, role: 'user', blocks: [] }).returning();
    await expect(t.db.insert(schema.supportActions).values({ conversationId: conversation.id, messageId: message.id, companyId, userId, kind: 'DELETE_CUSTOMER', payload: {}, expiresAt: new Date() })).rejects.toThrow();
  });

  it('numera mensagens em ordem crescente (seq)', async () => {
    const { companyId, userId } = await seedCompany(t.db);
    const [conversation] = await t.db.insert(schema.supportConversations).values({ companyId, userId }).returning();
    const [a] = await t.db.insert(schema.supportMessages).values({ conversationId: conversation.id, companyId, role: 'user', blocks: [] }).returning();
    const [b] = await t.db.insert(schema.supportMessages).values({ conversationId: conversation.id, companyId, role: 'assistant', blocks: [] }).returning();
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});
```

- [ ] **Step 3: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-schema.test.ts`
Expected: FAIL (`schema.supportConversations` é `undefined` / erro de TypeScript no import).

- [ ] **Step 4: Adicionar as tabelas ao final de `backend/database/src/schema.ts`**

Os imports (`bigint`, `uniqueIndex`, `foreignKey`, `check`, `jsonb`, `text`...) já existem no topo do arquivo.

```ts
export const supportConversations = pgTable(
  'support_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    status: varchar('status', { length: 16 }).default('ACTIVE').notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('support_conversations_active_uq').on(table.companyId, table.userId).where(sql`${table.status} = 'ACTIVE'`),
    foreignKey({
      name: 'support_conversations_company_user_fk',
      columns: [table.companyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('support_conversations_status_chk', sql`${table.status} IN ('ACTIVE', 'CLOSED')`),
  ],
);

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    conversationId: uuid('conversation_id').notNull().references(() => supportConversations.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    role: varchar('role', { length: 16 }).notNull(),
    blocks: jsonb('blocks').$type<Record<string, unknown>[]>().notNull(),
    llmItems: jsonb('llm_items').$type<unknown[]>().default(sql`'[]'::jsonb`).notNull(),
    model: varchar('model', { length: 80 }),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    toolCallCount: integer('tool_call_count').default(0).notNull(),
    errorCode: varchar('error_code', { length: 40 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('support_messages_conversation_idx').on(table.conversationId, table.seq),
    index('support_messages_company_role_idx').on(table.companyId, table.role, table.createdAt),
    check('support_messages_role_chk', sql`${table.role} IN ('user', 'assistant')`),
    check('support_messages_counts_chk', sql`(${table.inputTokens} IS NULL OR ${table.inputTokens} >= 0) AND (${table.outputTokens} IS NULL OR ${table.outputTokens} >= 0) AND ${table.toolCallCount} >= 0`),
  ],
);

export const supportActions = pgTable(
  'support_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id').notNull().references(() => supportConversations.id, { onDelete: 'restrict' }),
    messageId: uuid('message_id').notNull().references(() => supportMessages.id, { onDelete: 'restrict' }),
    companyId: uuid('company_id').notNull().references(() => companies.id, { onDelete: 'restrict' }),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    kind: varchar('kind', { length: 32 }).notNull(),
    status: varchar('status', { length: 16 }).default('PENDING').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    resultEntityId: uuid('result_entity_id'),
    errorMessage: text('error_message'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('support_actions_pending_uq').on(table.conversationId).where(sql`${table.status} = 'PENDING'`),
    index('support_actions_company_user_idx').on(table.companyId, table.userId, table.createdAt),
    foreignKey({
      name: 'support_actions_company_user_fk',
      columns: [table.companyId, table.userId],
      foreignColumns: [companyUsers.companyId, companyUsers.userId],
    }).onDelete('restrict'),
    check('support_actions_kind_chk', sql`${table.kind} IN ('CREATE_CUSTOMER', 'CREATE_SERVICE')`),
    check('support_actions_status_chk', sql`${table.status} IN ('PENDING', 'CONFIRMED', 'CANCELED', 'EXPIRED', 'FAILED')`),
  ],
);
```

- [ ] **Step 5: Gerar a migração**

Run: `cd backend && npm run db:generate --prefix database -- --name support_assistant`
Expected: cria `backend/database/drizzle/0031_support_assistant.sql` e atualiza `meta/_journal.json` e o snapshot. Abra o SQL e confira: 3 `CREATE TABLE`, os dois `CREATE UNIQUE INDEX ... WHERE`, a coluna `seq` com `GENERATED ALWAYS AS IDENTITY` e as FKs compostas. Nenhum `DROP` em outras tabelas. Se aparecer qualquer alteração em tabela existente, pare e investigue o drift antes de seguir.

- [ ] **Step 6: Rodar o teste**

Run: `cd backend && npx vitest run tests/support-schema.test.ts`
Expected: PASS (4 testes).

- [ ] **Step 7: Aplicar no banco de desenvolvimento e checar tipos**

Run: `cd backend && npm run db:migrate --prefix database && npm run typecheck`
Expected: migração aplicada; typecheck sem erros.

- [ ] **Step 8: Commit**

```bash
git add backend/database/src/schema.ts backend/database/drizzle backend/tests/support-db.ts backend/tests/support-schema.test.ts
git commit -m "Feat: tabelas do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Configuração e cliente LLM (OpenAI) com tradução de erros

**Files:**
- Create: `backend/src/support/support-config.ts`
- Create: `backend/src/support/llm/support-llm.client.ts`
- Create: `backend/src/support/llm/openai-support-llm.client.ts`
- Create: `backend/tests/support-fakes.ts`
- Test: `backend/tests/support-llm.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-llm.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { supportConfig } from '../src/support/support-config.js';
import { SupportLlmError, toHistoryItems, toSupportLlmError } from '../src/support/llm/support-llm.client.js';
import { OpenAiSupportLlmClient } from '../src/support/llm/openai-support-llm.client.js';

const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' } });
const client = (fetchImpl: typeof fetch) => new OpenAiSupportLlmClient({ apiKey: 'sk-test', model: 'gpt-test', baseURL: 'http://llm.test/v1' }, { fetch: fetchImpl, maxRetries: 0 });

describe('configuração do suporte', () => {
  it('usa a chave própria quando existe e cai para OPENAI_API_KEY', () => {
    expect(supportConfig({ SUPPORT_AI_ENABLED: 'true', OPENAI_API_KEY: 'sk-nero' }).apiKey).toBe('sk-nero');
    expect(supportConfig({ SUPPORT_AI_ENABLED: 'true', OPENAI_API_KEY: 'sk-nero', SUPPORT_OPENAI_API_KEY: 'sk-sup' }).apiKey).toBe('sk-sup');
  });
  it('fica desligado sem a flag ou sem chave e aplica padrões', () => {
    expect(supportConfig({ OPENAI_API_KEY: 'sk' }).enabled).toBe(false);
    expect(supportConfig({ SUPPORT_AI_ENABLED: 'true' }).enabled).toBe(false);
    const config = supportConfig({ SUPPORT_AI_ENABLED: 'true', OPENAI_API_KEY: 'sk' });
    expect(config).toMatchObject({ enabled: true, model: 'gpt-6-luna', dailyLimit: 100, baseURL: undefined });
  });
});

describe('tradução de erros da API', () => {
  it.each([
    [{ status: 429, code: 'insufficient_quota' }, 'AI_QUOTA'],
    [{ status: 400, code: 'billing_hard_limit_reached' }, 'AI_QUOTA'],
    [{ status: 429, code: 'rate_limit_exceeded' }, 'AI_RATE_LIMIT'],
    [{ status: 400, code: 'invalid_request_error' }, 'AI_BAD_REQUEST'],
    [{ status: 401, code: 'invalid_api_key' }, 'AI_AUTH'],
    [{ status: 503 }, 'AI_UNAVAILABLE'],
    [{ name: 'APIConnectionTimeoutError' }, 'AI_UNAVAILABLE'],
  ])('%o → %s', (raw, code) => {
    expect(toSupportLlmError(Object.assign(new Error('x'), raw)).code).toBe(code);
  });
});

describe('normalização do histórico', () => {
  it('mantém só mensagens do assistente e chamadas de função, sem ids', () => {
    expect(toHistoryItems([
      { type: 'reasoning', id: 'rs_1', summary: [] },
      { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Olá' }] },
      { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'abrir_tela', arguments: '{"destino":"clientes"}' },
    ])).toEqual([
      { role: 'assistant', content: 'Olá' },
      { type: 'function_call', call_id: 'call_1', name: 'abrir_tela', arguments: '{"destino":"clientes"}' },
    ]);
  });
});

describe('OpenAiSupportLlmClient', () => {
  it('converte resposta em texto, tool calls e uso', async () => {
    let body: any;
    const llm = client(async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse(200, { id: 'resp_1', object: 'response', output: [
        { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'abrir_tela', arguments: '{"destino":"clientes"}' },
        { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Abrindo.', annotations: [] }] },
      ], usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } });
    });
    const result = await llm.respond({ instructions: 'x', input: [{ role: 'user', content: 'oi' }], tools: [] });
    expect(body).toMatchObject({ model: 'gpt-test', store: false, parallel_tool_calls: false, max_output_tokens: 500 });
    expect(result.text).toBe('Abrindo.');
    expect(result.toolCalls).toEqual([{ callId: 'call_1', name: 'abrir_tela', arguments: '{"destino":"clientes"}' }]);
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });

  it('lança AI_QUOTA quando a billing está sem saldo', async () => {
    const llm = client(async () => jsonResponse(429, { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } }));
    const error = await llm.respond({ instructions: 'x', input: [], tools: [] }).catch((e) => e);
    expect(error).toBeInstanceOf(SupportLlmError);
    expect(error).toMatchObject({ code: 'AI_QUOTA', httpStatus: 429 });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-llm.test.ts`
Expected: FAIL (módulos não encontrados).

- [ ] **Step 3: Implementar `support-config.ts`**

```ts
export const SUPPORT_CONFIG = Symbol('SUPPORT_CONFIG');

export type SupportConfig = {
  enabled: boolean;
  apiKey: string;
  model: string;
  baseURL: string | undefined;
  dailyLimit: number;
};

export function supportConfig(env: Record<string, string | undefined> = process.env): SupportConfig {
  const apiKey = env.SUPPORT_OPENAI_API_KEY || env.OPENAI_API_KEY || '';
  const dailyLimit = Number(env.SUPPORT_DAILY_MESSAGE_LIMIT);
  return {
    enabled: env.SUPPORT_AI_ENABLED === 'true' && apiKey.length > 0,
    apiKey,
    model: env.SUPPORT_AI_MODEL || 'gpt-6-luna',
    baseURL: env.SUPPORT_AI_BASE_URL || undefined,
    dailyLimit: Number.isInteger(dailyLimit) && dailyLimit > 0 ? dailyLimit : 100,
  };
}
```

- [ ] **Step 4: Implementar `llm/support-llm.client.ts`**

```ts
export const SUPPORT_LLM = Symbol('SUPPORT_LLM');

export type SupportToolDefinition = {
  type: 'function';
  name: string;
  description: string;
  strict: true;
  parameters: Record<string, unknown>;
};
export type SupportLlmToolCall = { callId: string; name: string; arguments: string };
export type SupportLlmRequest = { instructions: string; input: unknown[]; tools: SupportToolDefinition[] };
export type SupportLlmResponse = {
  /** Itens já normalizados por toHistoryItems: podem ser reenviados ao modelo e guardados no banco. */
  output: unknown[];
  text: string;
  toolCalls: SupportLlmToolCall[];
  usage: { inputTokens: number; outputTokens: number } | null;
};

export interface SupportLlmClient {
  readonly model: string;
  respond(request: SupportLlmRequest): Promise<SupportLlmResponse>;
}

export type SupportLlmErrorCode = 'AI_QUOTA' | 'AI_RATE_LIMIT' | 'AI_BAD_REQUEST' | 'AI_AUTH' | 'AI_UNAVAILABLE';

export class SupportLlmError extends Error {
  constructor(readonly code: SupportLlmErrorCode, readonly httpStatus: number | null, readonly requestId: string | null) {
    super(code);
    this.name = 'SupportLlmError';
  }
}

const quotaCodes = new Set(['insufficient_quota', 'billing_hard_limit_reached', 'billing_not_active']);

export function toSupportLlmError(error: unknown): SupportLlmError {
  if (error instanceof SupportLlmError) return error;
  const raw = (error ?? {}) as { status?: unknown; code?: unknown; type?: unknown; error?: { code?: unknown; type?: unknown }; requestID?: unknown };
  const status = typeof raw.status === 'number' ? raw.status : null;
  const code = [raw.code, raw.error?.code, raw.type, raw.error?.type].find((value): value is string => typeof value === 'string') ?? null;
  const requestId = typeof raw.requestID === 'string' ? raw.requestID : null;
  if (code && quotaCodes.has(code)) return new SupportLlmError('AI_QUOTA', status, requestId);
  if (status === 429) return new SupportLlmError('AI_RATE_LIMIT', status, requestId);
  if (status === 401 || status === 403) return new SupportLlmError('AI_AUTH', status, requestId);
  if (status === 400 || status === 404 || status === 422) return new SupportLlmError('AI_BAD_REQUEST', status, requestId);
  return new SupportLlmError('AI_UNAVAILABLE', status, requestId);
}

/** Remove itens de raciocínio e ids: com store:false eles não podem ser referenciados depois. */
export function toHistoryItems(output: unknown[]): unknown[] {
  const items: unknown[] = [];
  for (const raw of output as Array<Record<string, any>>) {
    if (raw?.type === 'function_call') {
      items.push({ type: 'function_call', call_id: raw.call_id, name: raw.name, arguments: raw.arguments });
    } else if (raw?.type === 'message' && raw.role === 'assistant') {
      const text = (Array.isArray(raw.content) ? raw.content : [])
        .filter((part: any) => part?.type === 'output_text')
        .map((part: any) => String(part.text ?? ''))
        .join('');
      if (text) items.push({ role: 'assistant', content: text });
    }
  }
  return items;
}
```

- [ ] **Step 5: Implementar `llm/openai-support-llm.client.ts`**

```ts
import OpenAI from 'openai';
import type { SupportConfig } from '../support-config.js';
import { toHistoryItems, toSupportLlmError, type SupportLlmClient, type SupportLlmRequest, type SupportLlmResponse } from './support-llm.client.js';

export class OpenAiSupportLlmClient implements SupportLlmClient {
  private readonly client: OpenAI;

  constructor(private readonly config: Pick<SupportConfig, 'apiKey' | 'model' | 'baseURL'>, options: { fetch?: typeof fetch; maxRetries?: number } = {}) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      timeout: 15_000,
      maxRetries: options.maxRetries ?? 1,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  get model() { return this.config.model; }

  async respond(request: SupportLlmRequest): Promise<SupportLlmResponse> {
    let response: any;
    try {
      response = await this.client.responses.create({
        model: this.config.model,
        instructions: request.instructions,
        input: request.input,
        tools: request.tools,
        parallel_tool_calls: false,
        store: false,
        max_output_tokens: 500,
      } as any);
    } catch (error) {
      throw toSupportLlmError(error);
    }
    const output = toHistoryItems(Array.isArray(response?.output) ? response.output : []);
    const text = output.filter((item: any) => item.role === 'assistant').map((item: any) => item.content as string).join('\n');
    const toolCalls = output.filter((item: any) => item.type === 'function_call')
      .map((item: any) => ({ callId: item.call_id as string, name: item.name as string, arguments: item.arguments as string }));
    const usage = response?.usage ? { inputTokens: Number(response.usage.input_tokens ?? 0), outputTokens: Number(response.usage.output_tokens ?? 0) } : null;
    return { output, text, toolCalls, usage };
  }
}
```

- [ ] **Step 6: Criar o fake para os próximos testes**

`backend/tests/support-fakes.ts`:

```ts
import type { SupportLlmClient, SupportLlmRequest, SupportLlmResponse } from '../src/support/llm/support-llm.client.js';

export class FakeSupportLlmClient implements SupportLlmClient {
  readonly model = 'fake-model';
  readonly requests: SupportLlmRequest[] = [];
  private readonly script: Array<SupportLlmResponse | Error> = [];

  queue(...steps: Array<SupportLlmResponse | Error>) {
    this.script.push(...steps);
    return this;
  }

  async respond(request: SupportLlmRequest): Promise<SupportLlmResponse> {
    this.requests.push(structuredClone(request));
    const next = this.script.shift();
    if (!next) throw new Error('FakeSupportLlmClient sem resposta roteirizada');
    if (next instanceof Error) throw next;
    return next;
  }
}

export const say = (text: string): SupportLlmResponse => ({
  output: [{ role: 'assistant', content: text }], text, toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 },
});

let callCounter = 0;
export const call = (name: string, args: Record<string, unknown>): SupportLlmResponse => {
  const callId = `call_${++callCounter}`;
  const argumentsJson = JSON.stringify(args);
  return {
    output: [{ type: 'function_call', call_id: callId, name, arguments: argumentsJson }],
    text: '', toolCalls: [{ callId, name, arguments: argumentsJson }], usage: { inputTokens: 100, outputTokens: 10 },
  };
};

export const apiError = (status: number | undefined, code?: string, name = 'APIError') =>
  Object.assign(new Error(`erro ${status ?? name}`), { status, code, name });
```

- [ ] **Step 7: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-llm.test.ts`
Expected: PASS. Se o SDK 7.x não aceitar a opção `fetch` no construtor, veja `node_modules/openai/README.md` (seção "Customizing the fetch client") e ajuste só o adapter.

- [ ] **Step 8: Typecheck e commit**

Run: `cd backend && npm run typecheck`

```bash
git add backend/src/support/support-config.ts backend/src/support/llm backend/tests/support-fakes.ts backend/tests/support-llm.test.ts
git commit -m "Feat: cliente LLM do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Blocos de resposta e destinos permitidos

**Files:**
- Create: `backend/src/support/support-blocks.ts`
- Test: `backend/tests/support-blocks.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-blocks.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { downloadBlock, isSafeBlock, navigateBlock, saleBlock, withExpiredActions, type ActionBlock } from '../src/support/support-blocks.js';

const companyId = '11111111-1111-4111-8111-111111111111';
const saleId = '22222222-2222-4222-8222-222222222222';

describe('blocos do suporte', () => {
  it('monta navegação apenas para destinos conhecidos', () => {
    expect(navigateBlock('clientes')).toEqual({ type: 'navigate', label: 'Abrir Clientes', to: '/Clientes' });
    expect(isSafeBlock({ type: 'navigate', label: 'x', to: '/Clientes' })).toBe(true);
    expect(isSafeBlock({ type: 'navigate', label: 'x', to: 'https://evil.test' })).toBe(false);
    expect(isSafeBlock({ type: 'navigate', label: 'x', to: '/admin' })).toBe(false);
  });

  it('monta o deep link da venda', () => {
    const block = saleBlock({ id: saleId, orderCode: '1024', customerName: 'Maria' }, companyId);
    expect(block.to).toBe(`/portal-de-servicos?abrir=${saleId}&empresa=${companyId}`);
    expect(isSafeBlock(block)).toBe(true);
  });

  it('monta download só de PDF de relatório', () => {
    expect(downloadBlock('customers', null, null)).toEqual({ type: 'download', label: 'Baixar PDF — Clientes', url: '/reports/customers/pdf', filename: 'customers.pdf' });
    const period = downloadBlock('closed-services', '2026-11-01', '2026-11-30');
    expect(period.url).toBe('/reports/closed-services/pdf?from=2026-11-01&to=2026-11-30');
    expect(period.filename).toBe('closed-services-2026-11-01-a-2026-11-30.pdf');
    expect(isSafeBlock(period)).toBe(true);
    expect(isSafeBlock({ type: 'download', label: 'x', url: '/reports/customers.csv', filename: 'x' })).toBe(false);
    expect(isSafeBlock({ type: 'download', label: 'x', url: '/files/1', filename: 'x' })).toBe(false);
  });

  it('marca como expirada a ação pendente vencida', () => {
    const action: ActionBlock = { type: 'action', actionId: saleId, kind: 'CREATE_CUSTOMER', status: 'PENDING', summary: [], expiresAt: '2026-01-01T00:00:00.000Z' };
    expect(withExpiredActions([action], new Date('2026-01-01T00:00:01Z'))[0]).toMatchObject({ status: 'EXPIRED' });
    expect(withExpiredActions([action], new Date('2025-12-31T23:59:59Z'))[0]).toMatchObject({ status: 'PENDING' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-blocks.test.ts`
Expected: FAIL (módulo inexistente).

- [ ] **Step 3: Implementar `backend/src/support/support-blocks.ts`**

```ts
import { reportTypes, type ReportType } from '../reports/reports.schemas.js';

export const destinations = {
  clientes: '/Clientes',
  servicos: '/servicos',
  portal_servicos: '/portal-de-servicos',
  financeiro: '/financeiro',
  relatorios: '/relatorios',
  fiscal_series: '/fiscal/series',
  fiscal_tributacao: '/fiscal/tributacao',
  empresa: '/empresa',
  crm: '/crm',
  agenda: '/agenda',
  propostas: '/propostas',
  nero: '/nero',
  usuarios: '/usuarios',
  meu_perfil: '/meu-perfil',
} as const;
export type Destination = keyof typeof destinations;
export const destinationIds = Object.keys(destinations) as [Destination, ...Destination[]];
export const destinationLabels: Record<Destination, string> = {
  clientes: 'Clientes', servicos: 'Serviços', portal_servicos: 'Portal de serviços', financeiro: 'Financeiro',
  relatorios: 'Relatórios', fiscal_series: 'Séries da NFS-e', fiscal_tributacao: 'Tributação', empresa: 'Dados da empresa',
  crm: 'CRM', agenda: 'Agenda', propostas: 'Propostas', nero: 'Nero', usuarios: 'Usuários', meu_perfil: 'Meu perfil',
};
export const reportTitles: Record<ReportType, string> = {
  'closed-services': 'Serviços fechados', 'service-receipts': 'Recebimento de serviços', 'lead-entries': 'Entrada de leads',
  customers: 'Clientes', 'service-catalog': 'Catálogo de serviços', meetings: 'Reuniões',
  'disqualification-rate': 'Taxa de desqualificação', 'loss-rate': 'Taxa de perda',
};

export type ActionKind = 'CREATE_CUSTOMER' | 'CREATE_SERVICE';
export type ActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'EXPIRED' | 'FAILED';
export type TextBlock = { type: 'text'; text: string };
export type NoticeBlock = { type: 'notice'; level: 'info' | 'error'; text: string };
export type NavigateBlock = { type: 'navigate'; label: string; to: string };
export type DownloadBlock = { type: 'download'; label: string; url: string; filename: string };
export type ActionBlock = {
  type: 'action'; actionId: string; kind: ActionKind; status: ActionStatus;
  summary: { label: string; value: string }[]; expiresAt: string; resultTo?: string; errorMessage?: string;
};
export type SupportBlock = TextBlock | NoticeBlock | NavigateBlock | DownloadBlock | ActionBlock;

export const navigateBlock = (destination: Destination): NavigateBlock =>
  ({ type: 'navigate', label: `Abrir ${destinationLabels[destination]}`, to: destinations[destination] });

export const saleBlock = (sale: { id: string; orderCode: string; customerName: string }, companyId: string): NavigateBlock =>
  ({ type: 'navigate', label: `Abrir pedido #${sale.orderCode} — ${sale.customerName}`, to: `/portal-de-servicos?abrir=${sale.id}&empresa=${companyId}` });

export function reportFilename(type: ReportType, from: string | null | undefined, to: string | null | undefined) {
  return `${type}${from && to ? `-${from}-a-${to}` : ''}.pdf`;
}

export function downloadBlock(type: ReportType, from: string | null, to: string | null): DownloadBlock {
  const query = from && to ? `?${new URLSearchParams({ from, to })}` : '';
  return { type: 'download', label: `Baixar PDF — ${reportTitles[type]}`, url: `/reports/${type}/pdf${query}`, filename: reportFilename(type, from, to) };
}

const routeValues = new Set<string>(Object.values(destinations));
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const saleLink = new RegExp(`^/portal-de-servicos\\?abrir=${uuid}&empresa=${uuid}$`, 'i');
const downloadLink = new RegExp(`^/reports/(${reportTypes.join('|')})/pdf(\\?from=\\d{4}-\\d{2}-\\d{2}&to=\\d{4}-\\d{2}-\\d{2})?$`);

export function isSafeBlock(block: SupportBlock): boolean {
  if (block.type === 'navigate') return routeValues.has(block.to) || saleLink.test(block.to);
  if (block.type === 'download') return downloadLink.test(block.url);
  return true;
}

export function withExpiredActions(blocks: SupportBlock[], now = new Date()): SupportBlock[] {
  return blocks.map((block) => block.type === 'action' && block.status === 'PENDING' && Date.parse(block.expiresAt) <= now.getTime()
    ? { ...block, status: 'EXPIRED' as const }
    : block);
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-blocks.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/support/support-blocks.ts backend/tests/support-blocks.test.ts
git commit -m "Feat: blocos de resposta do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Base de ajuda (catálogo + 17 artigos)

**Files:**
- Create: `backend/src/support/help-catalog.ts`
- Create: `backend/src/support/help/*.md` (17 arquivos)
- Test: `backend/tests/support-help.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-help.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SupportHelpCatalog, parseHelpArticle } from '../src/support/help-catalog.js';

const expectedIds = ['agenda', 'cancelar-substituir-nfse', 'certificado-digital', 'clientes', 'crm', 'emitir-nfse', 'empresa', 'financeiro',
  'meu-perfil', 'nero-whatsapp', 'portal-servicos', 'propostas', 'relatorios', 'series-nfse', 'servicos', 'tributacao', 'usuarios'];

describe('base de ajuda', () => {
  it('lê frontmatter e conteúdo', () => {
    const article = parseHelpArticle('---\nid: teste\ntitulo: Teste\nrota: clientes\npalavras-chave: [a, b]\n---\nCorpo **forte**.\n', 'teste.md');
    expect(article).toEqual({ id: 'teste', titulo: 'Teste', rota: 'clientes', palavrasChave: ['a', 'b'], conteudo: 'Corpo **forte**.' });
  });

  it('rejeita rota desconhecida, id inválido e corpo vazio', () => {
    expect(() => parseHelpArticle('---\nid: x\ntitulo: X\nrota: admin\n---\nCorpo', 'x.md')).toThrow(/Rota/);
    expect(() => parseHelpArticle('---\nid: X Y\ntitulo: X\n---\nCorpo', 'x.md')).toThrow(/id/);
    expect(() => parseHelpArticle('---\nid: x\ntitulo: X\n---\n', 'x.md')).toThrow(/conteúdo/);
    expect(() => parseHelpArticle('sem frontmatter', 'x.md')).toThrow(/frontmatter/);
  });

  it('carrega os 17 artigos com ids únicos', () => {
    const catalog = SupportHelpCatalog.load();
    expect(catalog.list().map((item) => item.id).sort()).toEqual(expectedIds);
    for (const id of expectedIds) expect(catalog.get(id)!.conteudo.length).toBeGreaterThan(200);
    expect(catalog.get('emitir-nfse')!.conteudo).toContain('Emitir NFS-e');
  });

  it('rejeita ids duplicados', () => {
    const a = parseHelpArticle('---\nid: x\ntitulo: X\n---\nCorpo', 'a.md');
    expect(() => new SupportHelpCatalog([a, a])).toThrow(/duplicado/);
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-help.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `backend/src/support/help-catalog.ts`**

```ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { destinations, type Destination } from './support-blocks.js';

export type HelpArticle = { id: string; titulo: string; rota: Destination | null; palavrasChave: string[]; conteudo: string };

export function parseHelpArticle(source: string, file: string): HelpArticle {
  const match = source.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error(`Artigo de ajuda sem frontmatter: ${file}`);
  const meta = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index > 0) meta.set(line.slice(0, index).trim(), line.slice(index + 1).trim());
  }
  const id = meta.get('id') ?? '';
  const titulo = meta.get('titulo') ?? '';
  const rota = meta.get('rota') || null;
  const conteudo = match[2].trim();
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`Artigo de ajuda com id inválido: ${file}`);
  if (!titulo) throw new Error(`Artigo de ajuda sem título: ${file}`);
  if (!conteudo) throw new Error(`Artigo de ajuda sem conteúdo: ${file}`);
  if (rota && !(rota in destinations)) throw new Error(`Rota desconhecida em ${file}: ${rota}`);
  const palavrasChave = (meta.get('palavras-chave') ?? '').replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()).filter(Boolean);
  return { id, titulo, rota: rota as Destination | null, palavrasChave, conteudo };
}

const defaultDir = fileURLToPath(new URL('./help/', import.meta.url));

export class SupportHelpCatalog {
  private readonly byId = new Map<string, HelpArticle>();

  constructor(articles: HelpArticle[]) {
    for (const article of articles) {
      if (this.byId.has(article.id)) throw new Error(`Artigo de ajuda duplicado: ${article.id}`);
      this.byId.set(article.id, article);
    }
  }

  static load(dir = defaultDir) {
    const files = readdirSync(dir).filter((file) => file.endsWith('.md')).sort();
    return new SupportHelpCatalog(files.map((file) => parseHelpArticle(readFileSync(join(dir, file), 'utf8'), file)));
  }

  list() { return [...this.byId.values()].map(({ id, titulo }) => ({ id, titulo })); }
  get(id: string) { return this.byId.get(id) ?? null; }
  ids(): [string, ...string[]] {
    const ids = [...this.byId.keys()];
    if (!ids.length) throw new Error('Base de ajuda vazia');
    return ids as [string, ...string[]];
  }
}
```

- [ ] **Step 4: Escrever os 17 artigos em `backend/src/support/help/`**

O formato é obrigatório. O nome do arquivo é `<id>.md`. O corpo precisa ter mais de 200 caracteres e as seções `## O que é`, `## Passo a passo` (lista numerada) e `## Problemas comuns` (lista). Use o **texto exato dos botões e menus** da interface. Cada passo deve ser conferido no componente listado. Não descreva nada que não exista na tela.

Primeiro artigo, `backend/src/support/help/emitir-nfse.md` (conferir os rótulos em `frontend/src/features/fiscal/NfseSaleActions.tsx` e `frontend/src/features/sales/SaleDetailPanel.tsx` e corrigir qualquer divergência):

```md
---
id: emitir-nfse
titulo: Como emitir uma NFS-e
rota: portal_servicos
palavras-chave: [nota, nfse, nfs-e, emitir, emissão, nota fiscal]
---
## O que é
A NFS-e é emitida a partir de um pedido confirmado no **Portal de serviços**, usando o emissor nacional (SEFIN Nacional). Nesta versão, a emissão acontece no ambiente de homologação (Produção Restrita).

## Antes de emitir
- **Certificado digital** A1 ativo, cadastrado em Fiscal › Dados da empresa.
- **Série da NFS-e** padrão ativa em Fiscal › Séries.
- **Tributação** configurada em Fiscal › Tributação.
- O serviço vendido precisa ter o código de tributação nacional preenchido no cadastro de serviços.

## Passo a passo
1. Abra o **Portal de serviços** e localize o pedido.
2. Se o pedido estiver em rascunho, conclua o lançamento e confirme o pedido.
3. Abra o pedido confirmado para ver os detalhes.
4. Clique em **Emitir NFS-e**, confira a prévia e confirme a emissão.
5. Acompanhe a situação da nota no próprio pedido.

## Problemas comuns
- "Configure uma série padrão para emitir.": cadastre ou ative uma série em Fiscal › Séries.
- Certificado vencido ou ausente: cadastre um novo certificado A1.
- Nota rejeitada: corrija a venda ou os cadastros e use **Emitir NFS-e novamente**.
```

Os outros 16 seguem a mesma estrutura. Para cada um, leia as fontes indicadas e escreva os passos reais:

| id | titulo | rota | Fontes a ler |
|---|---|---|---|
| `clientes` | Como cadastrar e gerenciar clientes | `clientes` | `frontend/src/features/customers/`, `backend/src/customers/customers.schemas.ts` (PF/PJ, CPF/CNPJ opcional, endereço para a nota) |
| `servicos` | Como cadastrar serviços | `servicos` | `frontend/src/features/services/`, `backend/src/services/services.schemas.ts` (código nacional, NBS, códigos municipais) |
| `portal-servicos` | Como lançar um pedido de serviços | `portal_servicos` | `frontend/src/features/sales/SalesPage.tsx`, `SaleEditor.tsx` (rascunho, confirmação, parcelas) |
| `cancelar-substituir-nfse` | Como cancelar ou substituir uma NFS-e | `portal_servicos` | `frontend/src/features/fiscal/NfseDocumentActions.tsx`, `docs/superpowers/specs/2026-11-06-nfse-correcao-cancelamento-substituicao-design.md` |
| `certificado-digital` | Como cadastrar o certificado digital | `empresa` | `docs/architecture/nfse-company-certificate.md` e a tela que usa `certificate` em `frontend/src/features/companies/` (só OWNER/ADMIN) |
| `series-nfse` | Como configurar as séries da NFS-e | `fiscal_series` | `frontend/src/features/fiscal/FiscalPage.tsx`, `docs/architecture/nfse-series-tax-control.md` |
| `tributacao` | Como configurar a tributação | `fiscal_tributacao` | `frontend/src/features/fiscal/FiscalPage.tsx`, `docs/architecture/adr-fiscal-sale-configuration.md` |
| `financeiro` | Como registrar e acompanhar recebimentos | `financeiro` | `frontend/src/features/finance/`, `SaleDetailPanel.tsx` (Registrar baixa, Estornar) |
| `relatorios` | Como usar os relatórios | `relatorios` | `frontend/src/features/reports/report-definitions.ts` (8 relatórios, CSV, Exportar PDF) |
| `crm` | Como usar o CRM | `crm` | `frontend/src/features/crm/`, `ArquivosMD/crm-001-especificacao-funcional.md` |
| `agenda` | Como agendar reuniões | `agenda` | `frontend/src/features/crm/` (agenda), `frontend/tests/agenda-page.spec.ts` |
| `propostas` | Como criar propostas comerciais | `propostas` | `frontend/src/features/crm/` (propostas) |
| `usuarios` | Como convidar usuários | `usuarios` | `frontend/src/features/users/` (só o proprietário vê o menu) |
| `empresa` | Como cadastrar os dados da empresa | `empresa` | `frontend/src/features/companies/`, `ArquivosMD/arquitetura-empresa-003-cadastro.md` |
| `meu-perfil` | Como editar seu perfil | `meu_perfil` | `frontend/src/features/profile/`, `docs/architecture/meu-perfil.md` |
| `nero-whatsapp` | Como conectar o Nero ao WhatsApp | `nero` | `frontend/src/features/nilo/NiloPage.tsx` (o produto se chama **Nero**; não escrever "Nilo") |

Os nomes de menu vêm de `frontend/src/components/WorkspaceLayout.tsx` (objeto `leaf`): use os mesmos rótulos.

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-help.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/support/help-catalog.ts backend/src/support/help backend/tests/support-help.test.ts
git commit -m "Feat: base de ajuda do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Serviço de conversas

**Files:**
- Create: `backend/src/support/support-conversations.service.ts`
- Test: `backend/tests/support-conversations.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-conversations.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { SupportConversationsService } from '../src/support/support-conversations.service.js';
import { createTestDatabase, seedCompany, addMember, type TestDatabase } from './support-db.js';

let t: TestDatabase, conversations: SupportConversationsService;
beforeAll(async () => { t = await createTestDatabase('supportconv'); conversations = new SupportConversationsService(t.database); }, 120000);
afterAll(async () => { await t?.drop(); });

describe('SupportConversationsService', () => {
  it('cria uma conversa por usuário e empresa e a reaproveita', async () => {
    const ctx = await seedCompany(t.db);
    const first = await conversations.activeOrCreate(ctx);
    const again = await conversations.activeOrCreate(ctx);
    expect(again.id).toBe(first.id);
  });

  it('isola conversas por empresa e por usuário', async () => {
    const a = await seedCompany(t.db, 'Empresa A');
    const b = await seedCompany(t.db, 'Empresa B');
    const colleague = await addMember(t.db, a.companyId);
    const conversation = await conversations.activeOrCreate(a);
    await conversations.addUserMessage(a, conversation.id, 'olá');
    expect(await conversations.active(b)).toBeNull();
    expect(await conversations.active({ companyId: a.companyId, userId: colleague })).toBeNull();
    expect(await conversations.active({ companyId: b.companyId, userId: a.userId })).toBeNull();
  });

  it('fecha a conversa após 24 h sem uso e o reset encerra a ativa', async () => {
    const ctx = await seedCompany(t.db);
    const old = await conversations.activeOrCreate(ctx);
    await t.db.update(schema.supportConversations).set({ lastMessageAt: new Date(Date.now() - 25 * 3600_000) }).where(eq(schema.supportConversations.id, old.id));
    expect(await conversations.active(ctx)).toBeNull();
    const [closed] = await t.db.select().from(schema.supportConversations).where(eq(schema.supportConversations.id, old.id));
    expect(closed.status).toBe('CLOSED');
    const fresh = await conversations.activeOrCreate(ctx);
    expect(fresh.id).not.toBe(old.id);
    await conversations.reset(ctx);
    expect(await conversations.active(ctx)).toBeNull();
  });

  it('guarda mensagens, monta histórico das últimas N e expõe só blocos', async () => {
    const ctx = await seedCompany(t.db);
    const conversation = await conversations.activeOrCreate(ctx);
    for (let i = 1; i <= 3; i++) {
      await conversations.addUserMessage(ctx, conversation.id, `pergunta ${i}`);
      const id = await conversations.startAssistantMessage(ctx, conversation.id, 'fake-model');
      await conversations.finishAssistantMessage(id, { blocks: [{ type: 'text', text: `resposta ${i}` }], llmItems: [{ role: 'assistant', content: `resposta ${i}` }], inputTokens: 10, outputTokens: 2, toolCallCount: 0, errorCode: null });
    }
    const history = await conversations.history(conversation.id, 4);
    expect(history).toEqual([
      { role: 'user', content: 'pergunta 2' }, { role: 'assistant', content: 'resposta 2' },
      { role: 'user', content: 'pergunta 3' }, { role: 'assistant', content: 'resposta 3' },
    ]);
    const views = await conversations.messages(conversation.id);
    expect(views).toHaveLength(6);
    expect(views[0]).toEqual({ id: expect.any(String), role: 'user', createdAt: expect.any(String), blocks: [{ type: 'text', text: 'pergunta 1' }] });
    expect(JSON.stringify(views)).not.toContain('llmItems');
  });

  it('conta as mensagens de usuário do dia por empresa', async () => {
    const ctx = await seedCompany(t.db);
    const conversation = await conversations.activeOrCreate(ctx);
    await conversations.addUserMessage(ctx, conversation.id, 'a');
    await conversations.addUserMessage(ctx, conversation.id, 'b');
    await conversations.startAssistantMessage(ctx, conversation.id, 'fake-model');
    expect(await conversations.countUserMessagesToday(ctx.companyId, 'America/Sao_Paulo')).toBe(2);
  });

  it('atualiza o bloco de ação dentro da mensagem', async () => {
    const ctx = await seedCompany(t.db);
    const conversation = await conversations.activeOrCreate(ctx);
    const id = await conversations.startAssistantMessage(ctx, conversation.id, 'fake-model');
    const block = { type: 'action' as const, actionId: '33333333-3333-4333-8333-333333333333', kind: 'CREATE_CUSTOMER' as const, status: 'PENDING' as const, summary: [], expiresAt: new Date(Date.now() + 60000).toISOString() };
    await conversations.finishAssistantMessage(id, { blocks: [{ type: 'text', text: 'ok' }, block], llmItems: [], inputTokens: null, outputTokens: null, toolCallCount: 1, errorCode: null });
    await conversations.updateActionBlock(id, { ...block, status: 'CONFIRMED', resultTo: '/Clientes' });
    const [view] = (await conversations.messages(conversation.id)).filter((m) => m.id === id);
    expect(view.blocks[1]).toMatchObject({ status: 'CONFIRMED', resultTo: '/Clientes' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-conversations.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `backend/src/support/support-conversations.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { supportConversations, supportMessages } from '@gestaonf/database/schema';
import { and, count, desc, asc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { withExpiredActions, type ActionBlock, type SupportBlock } from './support-blocks.js';

export type SupportContext = { companyId: string; userId: string };
export type SupportMessageView = { id: string; role: 'user' | 'assistant'; createdAt: string; blocks: SupportBlock[] };
export type FinishAssistantMessage = {
  blocks: SupportBlock[]; llmItems: unknown[]; inputTokens: number | null; outputTokens: number | null; toolCallCount: number; errorCode: string | null;
};
type MessageRow = typeof supportMessages.$inferSelect;

const IDLE_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class SupportConversationsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) {}

  async active(ctx: SupportContext, now = new Date()) {
    const [row] = await this.database.db.select().from(supportConversations).where(and(
      eq(supportConversations.companyId, ctx.companyId), eq(supportConversations.userId, ctx.userId), eq(supportConversations.status, 'ACTIVE'),
    )).limit(1);
    if (!row) return null;
    if (now.getTime() - row.lastMessageAt.getTime() > IDLE_MS) {
      await this.database.db.update(supportConversations).set({ status: 'CLOSED', closedAt: now })
        .where(and(eq(supportConversations.id, row.id), eq(supportConversations.status, 'ACTIVE')));
      return null;
    }
    return row;
  }

  async activeOrCreate(ctx: SupportContext, now = new Date()) {
    const current = await this.active(ctx, now);
    if (current) return current;
    const [created] = await this.database.db.insert(supportConversations).values({ companyId: ctx.companyId, userId: ctx.userId }).onConflictDoNothing().returning();
    if (created) return created;
    const concurrent = await this.active(ctx, now);
    if (!concurrent) throw new Error('Conversa de suporte não encontrada após criação concorrente');
    return concurrent;
  }

  async reset(ctx: SupportContext) {
    await this.database.db.update(supportConversations).set({ status: 'CLOSED', closedAt: new Date() }).where(and(
      eq(supportConversations.companyId, ctx.companyId), eq(supportConversations.userId, ctx.userId), eq(supportConversations.status, 'ACTIVE'),
    ));
  }

  toView(row: MessageRow, now = new Date()): SupportMessageView {
    return { id: row.id, role: row.role as 'user' | 'assistant', createdAt: row.createdAt.toISOString(), blocks: withExpiredActions(row.blocks as SupportBlock[], now) };
  }

  async messages(conversationId: string, now = new Date()) {
    const rows = await this.database.db.select().from(supportMessages).where(eq(supportMessages.conversationId, conversationId)).orderBy(asc(supportMessages.seq));
    return rows.map((row) => this.toView(row, now));
  }

  async history(conversationId: string, limit = 10): Promise<unknown[]> {
    const rows = await this.database.db.select({ llmItems: supportMessages.llmItems }).from(supportMessages)
      .where(eq(supportMessages.conversationId, conversationId)).orderBy(desc(supportMessages.seq)).limit(limit);
    return rows.reverse().flatMap((row) => row.llmItems);
  }

  async addUserMessage(ctx: SupportContext, conversationId: string, text: string) {
    const [row] = await this.database.db.insert(supportMessages).values({
      conversationId, companyId: ctx.companyId, role: 'user', blocks: [{ type: 'text', text }], llmItems: [{ role: 'user', content: text }],
    }).returning();
    await this.touch(conversationId);
    return this.toView(row);
  }

  async startAssistantMessage(ctx: SupportContext, conversationId: string, model: string | null) {
    const [row] = await this.database.db.insert(supportMessages).values({ conversationId, companyId: ctx.companyId, role: 'assistant', blocks: [], model }).returning({ id: supportMessages.id });
    return row.id;
  }

  async finishAssistantMessage(id: string, data: FinishAssistantMessage) {
    const [row] = await this.database.db.update(supportMessages).set({
      blocks: data.blocks as Record<string, unknown>[], llmItems: data.llmItems, inputTokens: data.inputTokens,
      outputTokens: data.outputTokens, toolCallCount: data.toolCallCount, errorCode: data.errorCode,
    }).where(eq(supportMessages.id, id)).returning();
    await this.touch(row.conversationId);
    return this.toView(row);
  }

  async updateActionBlock(messageId: string, block: ActionBlock) {
    const [row] = await this.database.db.select({ blocks: supportMessages.blocks }).from(supportMessages).where(eq(supportMessages.id, messageId)).limit(1);
    if (!row) return;
    const blocks = (row.blocks as SupportBlock[]).map((item) => item.type === 'action' && item.actionId === block.actionId ? block : item);
    await this.database.db.update(supportMessages).set({ blocks: blocks as Record<string, unknown>[] }).where(eq(supportMessages.id, messageId));
  }

  async countUserMessagesToday(companyId: string, timezone: string) {
    const [row] = await this.database.db.select({ total: count() }).from(supportMessages).where(and(
      eq(supportMessages.companyId, companyId), eq(supportMessages.role, 'user'),
      sql`${supportMessages.createdAt} >= (date_trunc('day', now() AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})`,
    ));
    return Number(row?.total ?? 0);
  }

  private async touch(conversationId: string) {
    await this.database.db.update(supportConversations).set({ lastMessageAt: new Date() }).where(eq(supportConversations.id, conversationId));
  }
}
```

- [ ] **Step 4: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-conversations.test.ts`
Expected: PASS (6 testes).

- [ ] **Step 5: Commit**

```bash
git add backend/src/support/support-conversations.service.ts backend/tests/support-conversations.test.ts
git commit -m "Feat: conversas do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Ações pendentes (preparar, confirmar, cancelar)

**Files:**
- Create: `backend/src/support/support-errors.ts`
- Create: `backend/src/support/support-actions.service.ts`
- Test: `backend/tests/support-actions.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-actions.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { SupportConversationsService } from '../src/support/support-conversations.service.js';
import { SupportActionsService } from '../src/support/support-actions.service.js';
import { createTestDatabase, seedCompany, addMember, type TestDatabase } from './support-db.js';

let t: TestDatabase, conversations: SupportConversationsService, actions: SupportActionsService, customers: CustomersService;
beforeAll(async () => {
  t = await createTestDatabase('supportactions');
  conversations = new SupportConversationsService(t.database);
  customers = new CustomersService(t.database);
  actions = new SupportActionsService(t.database, customers, new ServicesService(t.database), conversations);
}, 120000);
afterAll(async () => { await t?.drop(); });

async function setup() {
  const ctx = await seedCompany(t.db);
  const conversation = await conversations.activeOrCreate(ctx);
  const messageId = await conversations.startAssistantMessage(ctx, conversation.id, 'fake-model');
  return { ctx, draft: { ...ctx, conversationId: conversation.id, messageId } };
}

describe('SupportActionsService', () => {
  it('prepara ação pendente com resumo legível', async () => {
    const { draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Maria Souza', taxId: '52998224725' });
    expect(block).toMatchObject({ type: 'action', kind: 'CREATE_CUSTOMER', status: 'PENDING' });
    expect(block.summary).toEqual([{ label: 'Tipo', value: 'Pessoa física' }, { label: 'Nome', value: 'Maria Souza' }, { label: 'CPF/CNPJ', value: '52998224725' }]);
  });

  it('nova ação cancela a anterior da conversa', async () => {
    const { draft } = await setup();
    const first = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'A' });
    await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'B' });
    const [row] = await t.db.select().from(schema.supportActions).where(eq(schema.supportActions.id, first.actionId));
    expect(row.status).toBe('CANCELED');
  });

  it('confirma criando o cliente uma única vez mesmo com cliques simultâneos', async () => {
    const { ctx, draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Cliente Único' });
    const results = await Promise.allSettled([actions.confirm(ctx, block.actionId), actions.confirm(ctx, block.actionId)]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: expect.any(ConflictException) });
    const created = await t.db.select().from(schema.customers).where(and(eq(schema.customers.companyId, ctx.companyId), eq(schema.customers.name, 'Cliente Único')));
    expect(created).toHaveLength(1);
    const [row] = await t.db.select().from(schema.supportActions).where(eq(schema.supportActions.id, block.actionId));
    expect(row).toMatchObject({ status: 'CONFIRMED', resultEntityId: created[0].id });
  });

  it('confirma serviço', async () => {
    const { ctx, draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_SERVICE', { name: 'Consultoria', suggestedUnitPrice: '150.00' });
    const confirmed = await actions.confirm(ctx, block.actionId);
    expect(confirmed).toMatchObject({ status: 'CONFIRMED', resultTo: '/servicos' });
  });

  it('ação expirada responde conflito e vira EXPIRED', async () => {
    const { ctx, draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Tarde' });
    await t.db.update(schema.supportActions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.supportActions.id, block.actionId));
    await expect(actions.confirm(ctx, block.actionId)).rejects.toBeInstanceOf(ConflictException);
    const [row] = await t.db.select().from(schema.supportActions).where(eq(schema.supportActions.id, block.actionId));
    expect(row.status).toBe('EXPIRED');
  });

  it('ação de outro usuário não é encontrada', async () => {
    const { ctx, draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Privado' });
    const colleague = await addMember(t.db, ctx.companyId);
    await expect(actions.confirm({ companyId: ctx.companyId, userId: colleague }, block.actionId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falha do domínio vira FAILED com a mensagem', async () => {
    const { ctx, draft } = await setup();
    await customers.create(ctx.companyId, ctx.userId, { kind: 'PF', name: 'Existente', taxId: '52998224725' });
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Duplicado', taxId: '52998224725' });
    const result = await actions.confirm(ctx, block.actionId);
    expect(result).toMatchObject({ status: 'FAILED', errorMessage: 'CPF/CNPJ já cadastrado nesta empresa' });
  });

  it('cancela ação pendente e atualiza o bloco na mensagem', async () => {
    const { ctx, draft } = await setup();
    const block = await actions.prepare(draft, 'CREATE_CUSTOMER', { kind: 'PF', name: 'Desisti' });
    await conversations.finishAssistantMessage(draft.messageId, { blocks: [block], llmItems: [], inputTokens: null, outputTokens: null, toolCallCount: 1, errorCode: null });
    expect(await actions.cancel(ctx, block.actionId)).toMatchObject({ status: 'CANCELED' });
    const [view] = (await conversations.messages(draft.conversationId)).filter((m) => m.id === draft.messageId);
    expect(view.blocks[0]).toMatchObject({ status: 'CANCELED' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-actions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementar `backend/src/support/support-errors.ts`**

```ts
import { HttpException } from '@nestjs/common';

export function httpMessage(error: HttpException): string {
  const response = error.getResponse();
  if (typeof response === 'string') return response;
  const message = (response as { message?: unknown }).message;
  if (Array.isArray(message)) return message.join('; ');
  return typeof message === 'string' ? message : error.message;
}
```

- [ ] **Step 4: Implementar `backend/src/support/support-actions.service.ts`**

```ts
import { ConflictException, HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { supportActions } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { CustomersService } from '../customers/customers.service.js';
import { createCustomerSchema } from '../customers/customers.schemas.js';
import { ServicesService } from '../services/services.service.js';
import { createServiceSchema } from '../services/services.schemas.js';
import type { ActionBlock, ActionKind, ActionStatus } from './support-blocks.js';
import { SupportConversationsService, type SupportContext } from './support-conversations.service.js';
import { httpMessage } from './support-errors.js';

type ActionRow = typeof supportActions.$inferSelect;
export type ActionDraftContext = SupportContext & { conversationId: string; messageId: string };

const ACTION_TTL_MS = 15 * 60 * 1000;
const labels: Record<ActionKind, Record<string, string>> = {
  CREATE_CUSTOMER: { kind: 'Tipo', name: 'Nome', tradeName: 'Nome fantasia', taxId: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', cityName: 'Cidade', stateCode: 'UF', notes: 'Observações' },
  CREATE_SERVICE: { name: 'Nome', internalCode: 'Código interno', description: 'Descrição', unitLabel: 'Unidade', suggestedUnitPrice: 'Preço sugerido', nationalTaxCode: 'Código de tributação nacional' },
};

function formatValue(key: string, value: unknown) {
  if (key === 'kind') return value === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física';
  if (key === 'suggestedUnitPrice') return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
  return String(value);
}

export function actionSummary(kind: ActionKind, payload: Record<string, unknown>) {
  return Object.entries(labels[kind])
    .filter(([key]) => payload[key] !== undefined && payload[key] !== null && payload[key] !== '')
    .map(([key, label]) => ({ label, value: formatValue(key, payload[key]) }));
}

export function actionBlock(row: ActionRow): ActionBlock {
  const kind = row.kind as ActionKind;
  const status = row.status as ActionStatus;
  return {
    type: 'action', actionId: row.id, kind, status, summary: actionSummary(kind, row.payload), expiresAt: row.expiresAt.toISOString(),
    ...(status === 'CONFIRMED' ? { resultTo: kind === 'CREATE_CUSTOMER' ? '/Clientes' : '/servicos' } : {}),
    ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
  };
}

@Injectable()
export class SupportActionsService {
  private readonly logger = new Logger(SupportActionsService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(ServicesService) private readonly services: ServicesService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
  ) {}

  async prepare(ctx: ActionDraftContext, kind: ActionKind, payload: Record<string, unknown>): Promise<ActionBlock> {
    const { row, canceled } = await this.database.db.transaction(async (tx) => {
      const canceled = await tx.update(supportActions).set({ status: 'CANCELED', updatedAt: new Date() })
        .where(and(eq(supportActions.conversationId, ctx.conversationId), eq(supportActions.status, 'PENDING'))).returning();
      const [row] = await tx.insert(supportActions).values({
        conversationId: ctx.conversationId, messageId: ctx.messageId, companyId: ctx.companyId, userId: ctx.userId,
        kind, payload, expiresAt: new Date(Date.now() + ACTION_TTL_MS),
      }).returning();
      return { row, canceled };
    });
    for (const previous of canceled) await this.conversations.updateActionBlock(previous.messageId, actionBlock(previous));
    return actionBlock(row);
  }

  async confirm(ctx: SupportContext, id: string): Promise<ActionBlock> {
    await this.claimable(ctx, id);
    const [claimed] = await this.database.db.update(supportActions).set({ status: 'CONFIRMED', confirmedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'))).returning();
    if (!claimed) throw new ConflictException('Esta ação já foi concluída.');
    let row: ActionRow;
    try {
      const entity = claimed.kind === 'CREATE_CUSTOMER'
        ? await this.customers.create(ctx.companyId, ctx.userId, createCustomerSchema.parse(claimed.payload))
        : await this.services.create(ctx.companyId, ctx.userId, createServiceSchema.parse(claimed.payload));
      [row] = await this.database.db.update(supportActions).set({ resultEntityId: entity.id, updatedAt: new Date() }).where(eq(supportActions.id, id)).returning();
    } catch (error) {
      const message = error instanceof HttpException ? httpMessage(error) : 'Não foi possível concluir o cadastro.';
      if (!(error instanceof HttpException)) this.logger.error(`support_action_failed id=${id}`, error instanceof Error ? error.stack : undefined);
      [row] = await this.database.db.update(supportActions).set({ status: 'FAILED', errorMessage: message, updatedAt: new Date() }).where(eq(supportActions.id, id)).returning();
    }
    const block = actionBlock(row);
    await this.conversations.updateActionBlock(row.messageId, block);
    return block;
  }

  async cancel(ctx: SupportContext, id: string): Promise<ActionBlock> {
    await this.claimable(ctx, id);
    const [row] = await this.database.db.update(supportActions).set({ status: 'CANCELED', updatedAt: new Date() })
      .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'))).returning();
    if (!row) throw new ConflictException('Esta ação já foi concluída.');
    const block = actionBlock(row);
    await this.conversations.updateActionBlock(row.messageId, block);
    return block;
  }

  /** Garante dono, estado PENDING e validade; marca EXPIRED quando vencida. */
  private async claimable(ctx: SupportContext, id: string) {
    const [row] = await this.database.db.select().from(supportActions)
      .where(and(eq(supportActions.id, id), eq(supportActions.companyId, ctx.companyId), eq(supportActions.userId, ctx.userId))).limit(1);
    if (!row) throw new NotFoundException('Ação não encontrada.');
    if (row.status === 'PENDING' && row.expiresAt.getTime() <= Date.now()) {
      const [expired] = await this.database.db.update(supportActions).set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(and(eq(supportActions.id, id), eq(supportActions.status, 'PENDING'))).returning();
      if (expired) await this.conversations.updateActionBlock(expired.messageId, actionBlock(expired));
      throw new ConflictException('Esta ação expirou. Peça novamente ao assistente.');
    }
    if (row.status !== 'PENDING') throw new ConflictException('Esta ação já foi concluída.');
    return row;
  }
}
```

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-actions.test.ts`
Expected: PASS (8 testes). Se o teste de duplicidade falhar por não haver índice único de CPF/CNPJ, confira em `schema.ts` (tabela `customers`) qual exceção o `CustomersService.create` lança e ajuste **o teste** para a mensagem real. Não mude o service de clientes.

- [ ] **Step 6: Commit**

```bash
git add backend/src/support/support-errors.ts backend/src/support/support-actions.service.ts backend/tests/support-actions.test.ts
git commit -m "Feat: ações com confirmação do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Tools e registry

**Files:**
- Create: `backend/src/support/tools/tool-types.ts`, `help.tool.ts`, `navigate.tool.ts`, `report-pdf.tool.ts`, `find-sale.tool.ts`, `customer-draft.tool.ts`, `service-draft.tool.ts`, `tool-registry.ts`
- Test: `backend/tests/support-tools.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-tools.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import type { SalesService } from '../src/sales/sales.service.js';
import { SupportHelpCatalog } from '../src/support/help-catalog.js';
import { SupportConversationsService } from '../src/support/support-conversations.service.js';
import { SupportActionsService } from '../src/support/support-actions.service.js';
import { SupportToolRegistry } from '../src/support/tools/tool-registry.js';
import type { ToolContext } from '../src/support/tools/tool-types.js';
import { createTestDatabase, seedCompany, type TestDatabase } from './support-db.js';

const saleId = '44444444-4444-4444-8444-444444444444';
let t: TestDatabase, registry: SupportToolRegistry, conversations: SupportConversationsService;
const salesStub = { list: async (_companyId: string, input: { search?: string }) => ({
  items: input.search === '1024' ? [{ id: saleId, orderCode: '1024', customerNameSnapshot: 'Maria', soldOn: '2026-11-05', totalAmount: '500.00' }] : [],
  total: 0, limit: 5, offset: 0 }) } as unknown as SalesService;

beforeAll(async () => {
  t = await createTestDatabase('supporttools');
  conversations = new SupportConversationsService(t.database);
  const actions = new SupportActionsService(t.database, new CustomersService(t.database), new ServicesService(t.database), conversations);
  const reports = new ReportsReadService(t.database, new CrmPolicyService(t.database));
  registry = new SupportToolRegistry(SupportHelpCatalog.load(), actions, t.database, salesStub, reports);
}, 120000);
afterAll(async () => { await t?.drop(); });

async function context(): Promise<ToolContext> {
  const ctx = await seedCompany(t.db);
  const conversation = await conversations.activeOrCreate(ctx);
  const messageId = await conversations.startAssistantMessage(ctx, conversation.id, 'fake-model');
  return { ...ctx, conversationId: conversation.id, messageId };
}

describe('SupportToolRegistry', () => {
  it('expõe as 6 tools em modo strict', () => {
    const defs = registry.definitions();
    expect(defs.map((d) => d.name).sort()).toEqual(['abrir_tela', 'buscar_ajuda', 'gerar_relatorio_pdf', 'localizar_venda_para_emissao', 'preparar_cadastro_cliente', 'preparar_cadastro_servico']);
    for (const def of defs) {
      expect(def.strict).toBe(true);
      const params = def.parameters as { required: string[]; properties: Record<string, unknown>; additionalProperties: boolean };
      expect(params.additionalProperties).toBe(false);
      expect(params.required.sort()).toEqual(Object.keys(params.properties).sort());
    }
  });

  it('recusa tool inexistente, JSON inválido e destino fora do enum', async () => {
    const ctx = await context();
    expect((await registry.run(ctx, 'apagar_tudo', '{}')).output).toMatchObject({ ok: false });
    expect((await registry.run(ctx, 'abrir_tela', 'não é json')).output).toMatchObject({ ok: false });
    const invalid = await registry.run(ctx, 'abrir_tela', JSON.stringify({ destino: 'admin' }));
    expect(invalid).toMatchObject({ output: { ok: false, erro: 'Argumentos inválidos.' }, blocks: [] });
  });

  it('abrir_tela devolve navegação', async () => {
    const result = await registry.run(await context(), 'abrir_tela', JSON.stringify({ destino: 'clientes' }));
    expect(result.blocks).toEqual([{ type: 'navigate', label: 'Abrir Clientes', to: '/Clientes' }]);
  });

  it('buscar_ajuda devolve o artigo', async () => {
    const result = await registry.run(await context(), 'buscar_ajuda', JSON.stringify({ topico: 'emitir-nfse' }));
    expect(result.output).toMatchObject({ ok: true, titulo: 'Como emitir uma NFS-e' });
    expect(String(result.output.conteudo)).toContain('Emitir NFS-e');
  });

  it('gerar_relatorio_pdf valida pelo relatório real e devolve download', async () => {
    const ctx = await context();
    const ok = await registry.run(ctx, 'gerar_relatorio_pdf', JSON.stringify({ tipo: 'customers', de: null, ate: null }));
    expect(ok.output).toMatchObject({ ok: true, resumo: { total: 0 } });
    expect(ok.blocks).toEqual([{ type: 'download', label: 'Baixar PDF — Clientes', url: '/reports/customers/pdf', filename: 'customers.pdf' }]);
    const missing = await registry.run(ctx, 'gerar_relatorio_pdf', JSON.stringify({ tipo: 'closed-services', de: null, ate: null }));
    expect(missing).toMatchObject({ output: { ok: false, erro: 'Informe o período do relatório' }, blocks: [] });
  });

  it('localizar_venda_para_emissao devolve link da venda sem expor ids ao modelo', async () => {
    const ctx = await context();
    const result = await registry.run(ctx, 'localizar_venda_para_emissao', JSON.stringify({ busca: '1024' }));
    expect(result.output).toMatchObject({ ok: true, vendas: [{ codigo: '1024', cliente: 'Maria', data: '2026-11-05', total: '500.00' }] });
    expect(JSON.stringify(result.output)).not.toContain(saleId);
    expect(result.blocks[0]).toMatchObject({ type: 'navigate', to: `/portal-de-servicos?abrir=${saleId}&empresa=${ctx.companyId}` });
  });

  it('preparar_cadastro_cliente recusa CPF inválido sem criar ação', async () => {
    const ctx = await context();
    const result = await registry.run(ctx, 'preparar_cadastro_cliente', JSON.stringify({ kind: 'PF', name: 'Ana', tradeName: null, taxId: '123', email: null, phone: null, cityName: null, stateCode: null, notes: null }));
    expect(result.output).toMatchObject({ ok: false });
    expect(await t.db.select().from(schema.supportActions).where(eq(schema.supportActions.conversationId, ctx.conversationId))).toHaveLength(0);
  });

  it('preparar_cadastro_cliente válido cria ação pendente e cartão', async () => {
    const ctx = await context();
    const result = await registry.run(ctx, 'preparar_cadastro_cliente', JSON.stringify({ kind: 'PF', name: 'Ana Lima', tradeName: null, taxId: '52998224725', email: 'ana@example.test', phone: null, cityName: null, stateCode: null, notes: null }));
    expect(result.output).toMatchObject({ ok: true, situacao: 'AGUARDANDO_CONFIRMACAO' });
    expect(result.blocks[0]).toMatchObject({ type: 'action', kind: 'CREATE_CUSTOMER', status: 'PENDING' });
  });

  it('preparar_cadastro_servico válido cria ação pendente', async () => {
    const ctx = await context();
    const result = await registry.run(ctx, 'preparar_cadastro_servico', JSON.stringify({ name: 'Consultoria', internalCode: null, description: null, unitLabel: null, suggestedUnitPrice: '150.00', nationalTaxCode: null }));
    expect(result.blocks[0]).toMatchObject({ type: 'action', kind: 'CREATE_SERVICE', status: 'PENDING' });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-tools.test.ts`
Expected: FAIL.

- [ ] **Step 3: `tools/tool-types.ts`**

```ts
import type { z } from 'zod';
import type { SupportToolDefinition } from '../llm/support-llm.client.js';
import type { SupportBlock } from '../support-blocks.js';
import type { SupportContext } from '../support-conversations.service.js';

export type ToolContext = SupportContext & { conversationId: string; messageId: string };
export type ToolResult = { output: Record<string, unknown>; blocks: SupportBlock[] };
export type ToolSpec<A> = { definition: SupportToolDefinition; schema: z.ZodType<A>; run: (ctx: ToolContext, args: A) => Promise<ToolResult> };

export const issues = (error: z.ZodError) => error.issues.map((issue) => `${issue.path.join('.') || 'campo'}: ${issue.message}`);
```

- [ ] **Step 4: `tools/help.tool.ts`**

```ts
import { z } from 'zod';
import type { SupportHelpCatalog } from '../help-catalog.js';
import type { ToolSpec } from './tool-types.js';

export function helpTool(catalog: SupportHelpCatalog): ToolSpec<{ topico: string }> {
  const ids = catalog.ids();
  return {
    definition: {
      type: 'function', name: 'buscar_ajuda', strict: true,
      description: 'Lê o artigo de ajuda do GestãoNF sobre um tópico. Use antes de explicar qualquer funcionalidade.',
      parameters: { type: 'object', properties: { topico: { type: 'string', enum: ids } }, required: ['topico'], additionalProperties: false },
    },
    schema: z.strictObject({ topico: z.enum(ids) }),
    async run(_ctx, { topico }) {
      const article = catalog.get(topico)!;
      return { output: { ok: true, titulo: article.titulo, rota: article.rota, conteudo: article.conteudo }, blocks: [] };
    },
  };
}
```

- [ ] **Step 5: `tools/navigate.tool.ts`**

```ts
import { z } from 'zod';
import { destinationIds, destinationLabels, navigateBlock, type Destination } from '../support-blocks.js';
import type { ToolSpec } from './tool-types.js';

export function navigateTool(): ToolSpec<{ destino: Destination }> {
  return {
    definition: {
      type: 'function', name: 'abrir_tela', strict: true,
      description: `Mostra um botão para o usuário abrir uma tela do sistema. Destinos: ${destinationIds.map((id) => `${id} (${destinationLabels[id]})`).join(', ')}.`,
      parameters: { type: 'object', properties: { destino: { type: 'string', enum: destinationIds } }, required: ['destino'], additionalProperties: false },
    },
    schema: z.strictObject({ destino: z.enum(destinationIds) }),
    async run(_ctx, { destino }) {
      return { output: { ok: true, botao: destinationLabels[destino] }, blocks: [navigateBlock(destino)] };
    },
  };
}
```

- [ ] **Step 6: `tools/report-pdf.tool.ts`**

```ts
import { z } from 'zod';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import { reportFiltersSchema, reportTypes, type ReportType } from '../../reports/reports.schemas.js';
import { downloadBlock, reportTitles } from '../support-blocks.js';
import { issues, type ToolSpec } from './tool-types.js';

type Args = { tipo: ReportType; de: string | null; ate: string | null };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export function reportPdfTool(reports: ReportsReadService): ToolSpec<Args> {
  return {
    definition: {
      type: 'function', name: 'gerar_relatorio_pdf', strict: true,
      description: `Gera o link de download do PDF de um relatório. Tipos: ${reportTypes.map((type) => `${type} (${reportTitles[type]})`).join(', ')}. ` +
        'Clientes e catálogo aceitam período nulo (todos os registros); os demais exigem de/ate em YYYY-MM-DD, até 366 dias.',
      parameters: {
        type: 'object',
        properties: {
          tipo: { type: 'string', enum: [...reportTypes] },
          de: { type: ['string', 'null'], description: 'Data inicial YYYY-MM-DD ou null' },
          ate: { type: ['string', 'null'], description: 'Data final YYYY-MM-DD ou null' },
        },
        required: ['tipo', 'de', 'ate'], additionalProperties: false,
      },
    },
    schema: z.strictObject({ tipo: z.enum(reportTypes), de: date.nullable(), ate: date.nullable() }),
    async run(ctx, { tipo, de, ate }) {
      const filters = reportFiltersSchema.safeParse({ ...(de && ate ? { from: de, to: ate } : {}), limit: 1 });
      if (!filters.success) return { output: { ok: false, erro: issues(filters.error).join('; ') }, blocks: [] };
      const result = await reports.read({ companyId: ctx.companyId, userId: ctx.userId }, tipo, filters.data);
      return {
        output: { ok: true, relatorio: reportTitles[tipo], periodo: de && ate ? { de, ate } : null, resumo: result.summary },
        blocks: [downloadBlock(tipo, de && ate ? de : null, de && ate ? ate : null)],
      };
    },
  };
}
```

- [ ] **Step 7: `tools/find-sale.tool.ts`**

```ts
import { z } from 'zod';
import type { SalesService } from '../../sales/sales.service.js';
import { listSalesSchema } from '../../sales/sales.schemas.js';
import { saleBlock } from '../support-blocks.js';
import type { ToolSpec } from './tool-types.js';

export function findSaleTool(sales: SalesService): ToolSpec<{ busca: string }> {
  return {
    definition: {
      type: 'function', name: 'localizar_venda_para_emissao', strict: true,
      description: 'Procura pedidos confirmados pelo código do pedido ou nome do cliente e mostra botões para abrir o pedido, onde fica a emissão da NFS-e. Não emite a nota.',
      parameters: { type: 'object', properties: { busca: { type: 'string', description: 'Código do pedido ou nome do cliente' } }, required: ['busca'], additionalProperties: false },
    },
    schema: z.strictObject({ busca: z.string().trim().min(1).max(100) }),
    async run(ctx, { busca }) {
      const result = await sales.list(ctx.companyId, listSalesSchema.parse({ status: 'CONFIRMED', search: busca, limit: 5 }));
      const found = result.items.map((sale) => ({ id: sale.id, codigo: sale.orderCode, cliente: sale.customerNameSnapshot, data: sale.soldOn, total: sale.totalAmount }));
      return {
        output: {
          ok: true,
          vendas: found.map(({ id: _id, ...sale }) => sale),
          instrucao: found.length
            ? 'Ofereça abrir o pedido. A emissão é feita pelo botão Emitir NFS-e na tela do pedido.'
            : 'Nenhum pedido confirmado encontrado. Peça o código do pedido ou o nome do cliente.',
        },
        blocks: found.map((sale) => saleBlock({ id: sale.id, orderCode: sale.codigo, customerName: sale.cliente }, ctx.companyId)),
      };
    },
  };
}
```

- [ ] **Step 8: `tools/customer-draft.tool.ts`**

```ts
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { customers } from '@gestaonf/database/schema';
import type { DatabaseService } from '../../database/database.module.js';
import { createCustomerSchema } from '../../customers/customers.schemas.js';
import { validateCustomerTaxId } from '../../customers/tax-id.js';
import type { SupportActionsService } from '../support-actions.service.js';
import { issues, type ToolSpec } from './tool-types.js';

const text = z.string().nullable();
const argsSchema = z.strictObject({
  kind: z.enum(['PF', 'PJ']), name: z.string(), tradeName: text, taxId: text, email: text, phone: text, cityName: text, stateCode: text, notes: text,
});
const nullableString = { type: ['string', 'null'] };

export function customerDraftTool(actions: SupportActionsService, database: DatabaseService): ToolSpec<z.output<typeof argsSchema>> {
  return {
    definition: {
      type: 'function', name: 'preparar_cadastro_cliente', strict: true,
      description: 'Prepara o cadastro de um cliente para o usuário conferir e confirmar. Não grava nada. Obrigatórios: kind (PF ou PJ) e name. Use null para campos não informados.',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['PF', 'PJ'] }, name: { type: 'string' }, tradeName: nullableString,
          taxId: { type: ['string', 'null'], description: 'CPF ou CNPJ, só dígitos' }, email: nullableString, phone: nullableString,
          cityName: nullableString, stateCode: { type: ['string', 'null'], description: 'UF com 2 letras' }, notes: nullableString,
        },
        required: ['kind', 'name', 'tradeName', 'taxId', 'email', 'phone', 'cityName', 'stateCode', 'notes'], additionalProperties: false,
      },
    },
    schema: argsSchema,
    async run(ctx, args) {
      const payload = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== ''));
      const parsed = createCustomerSchema.safeParse(payload);
      if (!parsed.success) return { output: { ok: false, erro: 'Dados inválidos para o cadastro.', detalhes: issues(parsed.error) }, blocks: [] };
      validateCustomerTaxId(parsed.data.kind, parsed.data.taxId, parsed.data.tradeName);
      if (parsed.data.taxId) {
        const [duplicate] = await database.db.select({ id: customers.id }).from(customers)
          .where(and(eq(customers.companyId, ctx.companyId), eq(customers.taxId, parsed.data.taxId))).limit(1);
        if (duplicate) return { output: { ok: false, erro: 'Já existe cliente com este CPF/CNPJ nesta empresa.' }, blocks: [] };
      }
      const block = await actions.prepare(ctx, 'CREATE_CUSTOMER', parsed.data as Record<string, unknown>);
      return { output: { ok: true, situacao: 'AGUARDANDO_CONFIRMACAO', instrucao: 'Peça ao usuário para conferir e clicar em Confirmar no cartão. Nada foi gravado ainda.' }, blocks: [block] };
    },
  };
}
```

`validateCustomerTaxId` (em `backend/src/customers/tax-id.ts:27`) lança `HttpException` quando o documento é inválido, e o registry transforma isso em `{ ok: false, erro }`. Confirme lendo o arquivo. Se ela lançar outro tipo de erro, envolva a chamada em `try/catch` aqui e devolva `{ ok: false, erro: error.message }`.

- [ ] **Step 9: `tools/service-draft.tool.ts`**

```ts
import { z } from 'zod';
import { createServiceSchema } from '../../services/services.schemas.js';
import type { SupportActionsService } from '../support-actions.service.js';
import { issues, type ToolSpec } from './tool-types.js';

const text = z.string().nullable();
const argsSchema = z.strictObject({ name: z.string(), internalCode: text, description: text, unitLabel: text, suggestedUnitPrice: text, nationalTaxCode: text });
const nullableString = { type: ['string', 'null'] };

export function serviceDraftTool(actions: SupportActionsService): ToolSpec<z.output<typeof argsSchema>> {
  return {
    definition: {
      type: 'function', name: 'preparar_cadastro_servico', strict: true,
      description: 'Prepara o cadastro de um serviço para o usuário conferir e confirmar. Não grava nada. Obrigatório: name. Use null para campos não informados. Preço com ponto decimal (ex.: 150.00). Código de tributação nacional com 6 dígitos, só se o usuário informar.',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' }, internalCode: nullableString, description: nullableString, unitLabel: nullableString, suggestedUnitPrice: nullableString, nationalTaxCode: nullableString },
        required: ['name', 'internalCode', 'description', 'unitLabel', 'suggestedUnitPrice', 'nationalTaxCode'], additionalProperties: false,
      },
    },
    schema: argsSchema,
    async run(ctx, args) {
      const payload = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== null && value !== ''));
      const parsed = createServiceSchema.safeParse(payload);
      if (!parsed.success) return { output: { ok: false, erro: 'Dados inválidos para o cadastro.', detalhes: issues(parsed.error) }, blocks: [] };
      const block = await actions.prepare(ctx, 'CREATE_SERVICE', parsed.data as Record<string, unknown>);
      return { output: { ok: true, situacao: 'AGUARDANDO_CONFIRMACAO', instrucao: 'Peça ao usuário para conferir e clicar em Confirmar no cartão. Nada foi gravado ainda.' }, blocks: [block] };
    },
  };
}
```

- [ ] **Step 10: `tools/tool-registry.ts`**

```ts
import { HttpException, Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.module.js';
import { ReportsReadService } from '../../reports/reports-read.service.js';
import { SalesService } from '../../sales/sales.service.js';
import { SupportHelpCatalog } from '../help-catalog.js';
import { SupportActionsService } from '../support-actions.service.js';
import { isSafeBlock } from '../support-blocks.js';
import { httpMessage } from '../support-errors.js';
import { customerDraftTool } from './customer-draft.tool.js';
import { findSaleTool } from './find-sale.tool.js';
import { helpTool } from './help.tool.js';
import { navigateTool } from './navigate.tool.js';
import { reportPdfTool } from './report-pdf.tool.js';
import { serviceDraftTool } from './service-draft.tool.js';
import { issues, type ToolContext, type ToolResult, type ToolSpec } from './tool-types.js';

@Injectable()
export class SupportToolRegistry {
  private readonly tools: Map<string, ToolSpec<any>>;

  constructor(
    @Inject(SupportHelpCatalog) catalog: SupportHelpCatalog,
    @Inject(SupportActionsService) actions: SupportActionsService,
    @Inject(DatabaseService) database: DatabaseService,
    @Inject(SalesService) sales: SalesService,
    @Inject(ReportsReadService) reports: ReportsReadService,
  ) {
    const all: ToolSpec<any>[] = [helpTool(catalog), navigateTool(), reportPdfTool(reports), findSaleTool(sales), customerDraftTool(actions, database), serviceDraftTool(actions)];
    this.tools = new Map(all.map((tool) => [tool.definition.name, tool]));
  }

  definitions() { return [...this.tools.values()].map((tool) => tool.definition); }

  async run(ctx: ToolContext, name: string, rawArguments: string): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) return { output: { ok: false, erro: 'Ferramenta inexistente.' }, blocks: [] };
    let parsed: unknown;
    try { parsed = JSON.parse(rawArguments); } catch { return { output: { ok: false, erro: 'Argumentos em JSON inválido.' }, blocks: [] }; }
    const args = tool.schema.safeParse(parsed);
    if (!args.success) return { output: { ok: false, erro: 'Argumentos inválidos.', detalhes: issues(args.error) }, blocks: [] };
    try {
      const result = await tool.run(ctx, args.data);
      return { output: result.output, blocks: result.blocks.filter(isSafeBlock) };
    } catch (error) {
      if (error instanceof HttpException) return { output: { ok: false, erro: httpMessage(error) }, blocks: [] };
      throw error;
    }
  }
}
```

- [ ] **Step 11: Rodar os testes e o typecheck**

Run: `cd backend && npx vitest run tests/support-tools.test.ts && npm run typecheck`
Expected: PASS (9 testes) e typecheck sem erros. Se o tipo dos itens de `sales.list` acusar campo inexistente (`customerNameSnapshot`, `soldOn`, `totalAmount`), confira `backend/src/sales/sales.service.ts:129-150` e use os nomes reais.

- [ ] **Step 12: Commit**

```bash
git add backend/src/support/tools backend/tests/support-tools.test.ts
git commit -m "Feat: tools do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Orquestrador do chat e instruções

**Files:**
- Create: `backend/src/support/support-instructions.ts`
- Create: `backend/src/support/support-chat.service.ts`
- Test: `backend/tests/support-chat.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/support-chat.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HttpException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import type { SalesService } from '../src/sales/sales.service.js';
import { SupportHelpCatalog } from '../src/support/help-catalog.js';
import { SupportConversationsService } from '../src/support/support-conversations.service.js';
import { SupportActionsService } from '../src/support/support-actions.service.js';
import { SupportToolRegistry } from '../src/support/tools/tool-registry.js';
import { SupportChatService } from '../src/support/support-chat.service.js';
import type { SupportConfig } from '../src/support/support-config.js';
import { FakeSupportLlmClient, apiError, call, say } from './support-fakes.js';
import { createTestDatabase, seedCompany, type TestDatabase } from './support-db.js';

let t: TestDatabase, conversations: SupportConversationsService, registry: SupportToolRegistry, catalog: SupportHelpCatalog;
const config: SupportConfig = { enabled: true, apiKey: 'sk-test', model: 'fake-model', baseURL: undefined, dailyLimit: 100 };

beforeAll(async () => {
  t = await createTestDatabase('supportchat');
  conversations = new SupportConversationsService(t.database);
  catalog = SupportHelpCatalog.load();
  const actions = new SupportActionsService(t.database, new CustomersService(t.database), new ServicesService(t.database), conversations);
  registry = new SupportToolRegistry(catalog, actions, t.database, { list: async () => ({ items: [] }) } as unknown as SalesService,
    new ReportsReadService(t.database, new CrmPolicyService(t.database)));
}, 120000);
afterAll(async () => { await t?.drop(); });

const chat = (llm: FakeSupportLlmClient | null, overrides: Partial<SupportConfig> = {}) =>
  new SupportChatService(t.database, conversations, registry, catalog, llm, { ...config, ...overrides });

describe('SupportChatService', () => {
  it('grava pergunta e resposta e devolve as duas', async () => {
    const ctx = await seedCompany(t.db, 'Padaria Sol');
    const llm = new FakeSupportLlmClient().queue(say('Olá! Em que posso ajudar?'));
    const { messages } = await chat(llm).send(ctx, 'oi');
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(messages[1].blocks).toEqual([{ type: 'text', text: 'Olá! Em que posso ajudar?' }]);
    expect(llm.requests[0].instructions).toContain('Padaria Sol');
    expect(llm.requests[0].instructions).toContain('emitir-nfse');
    const [row] = await t.db.select().from(schema.supportMessages).where(eq(schema.supportMessages.id, messages[1].id));
    expect(row).toMatchObject({ inputTokens: 100, outputTokens: 20, model: 'fake-model', errorCode: null });
  });

  it('envia no máximo as últimas 10 mensagens de histórico', async () => {
    const ctx = await seedCompany(t.db);
    const llm = new FakeSupportLlmClient();
    const service = chat(llm);
    for (let i = 1; i <= 8; i++) { llm.queue(say(`r${i}`)); await service.send(ctx, `mensagem ${i}`); }
    const last = llm.requests.at(-1)!.input as Array<{ role?: string; content?: string }>;
    const userItems = last.filter((item) => item.role === 'user');
    expect(userItems).toHaveLength(6);
    expect(userItems[0].content).toBe('mensagem 3');
    expect(userItems.at(-1)!.content).toBe('mensagem 8');
  });

  it('executa tool, devolve o resultado ao modelo e anexa o bloco', async () => {
    const ctx = await seedCompany(t.db);
    const llm = new FakeSupportLlmClient().queue(call('abrir_tela', { destino: 'clientes' }), say('Use o botão abaixo.'));
    const { messages } = await chat(llm).send(ctx, 'onde cadastro clientes?');
    expect(messages[1].blocks).toEqual([{ type: 'text', text: 'Use o botão abaixo.' }, { type: 'navigate', label: 'Abrir Clientes', to: '/Clientes' }]);
    expect(JSON.stringify(llm.requests[1].input)).toContain('function_call_output');
  });

  it.each([
    [apiError(429, 'insufficient_quota'), 'AI_QUOTA'],
    [apiError(429, 'rate_limit_exceeded'), 'AI_RATE_LIMIT'],
    [apiError(400, 'invalid_request_error'), 'AI_BAD_REQUEST'],
    [apiError(401, 'invalid_api_key'), 'AI_AUTH'],
    [apiError(undefined, undefined, 'APIConnectionTimeoutError'), 'AI_UNAVAILABLE'],
  ])('erro da API vira aviso e grava %s', async (error, code) => {
    const ctx = await seedCompany(t.db);
    const { messages } = await chat(new FakeSupportLlmClient().queue(error)).send(ctx, 'oi');
    expect(messages[1].blocks).toEqual([{ type: 'notice', level: 'error', text: 'O assistente está indisponível no momento. Os atalhos continuam funcionando.' }]);
    const [row] = await t.db.select().from(schema.supportMessages).where(eq(schema.supportMessages.id, messages[1].id));
    expect(row.errorCode).toBe(code);
  });

  it('sem IA configurada responde aviso de desativado', async () => {
    const ctx = await seedCompany(t.db);
    const { messages } = await chat(null).send(ctx, 'oi');
    expect(messages[1].blocks).toEqual([{ type: 'notice', level: 'info', text: 'O chat com IA está desativado. Use os atalhos abaixo.' }]);
  });

  it('bloqueia além do limite diário da empresa', async () => {
    const ctx = await seedCompany(t.db);
    const llm = new FakeSupportLlmClient().queue(say('1'), say('2'));
    const service = chat(llm, { dailyLimit: 2 });
    await service.send(ctx, 'a');
    await service.send(ctx, 'b');
    const error = await service.send(ctx, 'c').catch((e) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
  });

  it('para após 4 rodadas de ferramentas', async () => {
    const ctx = await seedCompany(t.db);
    const step = () => call('abrir_tela', { destino: 'clientes' });
    const llm = new FakeSupportLlmClient().queue(step(), step(), step(), step());
    const { messages } = await chat(llm).send(ctx, 'loop');
    expect(llm.requests).toHaveLength(4);
    expect(messages[1].blocks[0]).toEqual({ type: 'text', text: 'Não consegui concluir. Tente reformular ou use os atalhos.' });
  });

  it('mantém só o último cartão quando o modelo prepara dois cadastros', async () => {
    const ctx = await seedCompany(t.db);
    const customer = (name: string) => call('preparar_cadastro_cliente', { kind: 'PF', name, tradeName: null, taxId: null, email: null, phone: null, cityName: null, stateCode: null, notes: null });
    const llm = new FakeSupportLlmClient().queue(customer('Primeiro'), customer('Segundo'), say('Confira o cartão.'));
    const { messages } = await chat(llm).send(ctx, 'cadastra');
    const cards = messages[1].blocks.filter((b) => b.type === 'action');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ status: 'PENDING', summary: expect.arrayContaining([{ label: 'Nome', value: 'Segundo' }]) });
  });
});
```

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/support-chat.test.ts`
Expected: FAIL.

- [ ] **Step 3: `support-instructions.ts`**

```ts
export function buildSupportInstructions(input: { topics: { id: string; titulo: string }[]; companyName: string; today: string }) {
  return [
    'Você é o assistente de suporte do GestãoNF, sistema de gestão e emissão de NFS-e para MEI e empresas do Simples Nacional.',
    'Responda em português do Brasil, de forma objetiva, sem personalidade e sem emojis. Use listas curtas quando houver passos.',
    'Explique funcionalidades somente com base em buscar_ajuda. Se o assunto não estiver na ajuda, diga que não sabe e ofereça abrir_tela para a tela mais próxima.',
    'Para cadastrar cliente ou serviço, use preparar_cadastro_cliente ou preparar_cadastro_servico e diga que o usuário deve conferir e confirmar no cartão. Nunca afirme que algo foi criado.',
    'Se faltar um dado obrigatório ou a ferramenta devolver erro, pergunte ao usuário apenas o que falta.',
    'Você não emite notas: use localizar_venda_para_emissao e ofereça abrir o pedido.',
    'Para relatórios em PDF, use gerar_relatorio_pdf; se o período não for dito, use o mês atual.',
    'Nunca peça nem use identificadores de empresa ou de usuário. Não responda sobre assuntos fora do GestãoNF.',
    `Tópicos de ajuda: ${input.topics.map((topic) => `${topic.id} (${topic.titulo})`).join('; ')}.`,
    `Empresa atual: ${input.companyName}. Data de hoje: ${input.today}.`,
  ].join('\n');
}
```

- [ ] **Step 4: `support-chat.service.ts`**

```ts
import { HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { companies } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { SUPPORT_LLM, SupportLlmError, toSupportLlmError, type SupportLlmClient } from './llm/support-llm.client.js';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config.js';
import type { SupportBlock } from './support-blocks.js';
import { SupportConversationsService, type SupportContext } from './support-conversations.service.js';
import { buildSupportInstructions } from './support-instructions.js';
import { SupportToolRegistry } from './tools/tool-registry.js';

const MAX_ROUNDS = 4;
const HISTORY_MESSAGES = 10;
const UNAVAILABLE = 'O assistente está indisponível no momento. Os atalhos continuam funcionando.';

@Injectable()
export class SupportChatService {
  private readonly logger = new Logger(SupportChatService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
    @Inject(SupportToolRegistry) private readonly registry: SupportToolRegistry,
    @Inject(SupportHelpCatalog) private readonly catalog: SupportHelpCatalog,
    @Inject(SUPPORT_LLM) private readonly llm: SupportLlmClient | null,
    @Inject(SUPPORT_CONFIG) private readonly config: SupportConfig,
  ) {}

  async send(ctx: SupportContext, text: string) {
    const [company] = await this.database.db.select({ name: companies.name, timezone: companies.timezone }).from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    const timezone = company?.timezone ?? 'America/Sao_Paulo';
    if (await this.conversations.countUserMessagesToday(ctx.companyId, timezone) >= this.config.dailyLimit) {
      throw new HttpException({ message: 'Limite diário do assistente atingido. Os atalhos continuam disponíveis.', code: 'SUPPORT_DAILY_LIMIT' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    const conversation = await this.conversations.activeOrCreate(ctx);
    const history = await this.conversations.history(conversation.id, HISTORY_MESSAGES);
    const userMessage = await this.conversations.addUserMessage(ctx, conversation.id, text);
    const assistantId = await this.conversations.startAssistantMessage(ctx, conversation.id, this.llm?.model ?? null);

    if (!this.llm) {
      const assistant = await this.conversations.finishAssistantMessage(assistantId, {
        blocks: [{ type: 'notice', level: 'info', text: 'O chat com IA está desativado. Use os atalhos abaixo.' }],
        llmItems: [], inputTokens: null, outputTokens: null, toolCallCount: 0, errorCode: 'AI_DISABLED',
      });
      return { messages: [userMessage, assistant] };
    }

    const instructions = buildSupportInstructions({
      topics: this.catalog.list(), companyName: company?.name ?? 'Empresa',
      today: new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date()),
    });
    const toolContext = { ...ctx, conversationId: conversation.id, messageId: assistantId };
    const base: unknown[] = [...history, { role: 'user', content: text }];
    const produced: unknown[] = [];
    let blocks: SupportBlock[] = [];
    let finalText: string | null = null;
    let inputTokens = 0, outputTokens = 0, toolCallCount = 0, sawUsage = false;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const response = await this.llm.respond({ instructions, input: [...base, ...produced], tools: this.registry.definitions() });
        produced.push(...response.output);
        if (response.usage) { sawUsage = true; inputTokens += response.usage.inputTokens; outputTokens += response.usage.outputTokens; }
        if (!response.toolCalls.length) { finalText = response.text.trim(); break; }
        for (const toolCall of response.toolCalls) {
          toolCallCount += 1;
          const result = await this.registry.run(toolContext, toolCall.name, toolCall.arguments);
          blocks.push(...result.blocks);
          produced.push({ type: 'function_call_output', call_id: toolCall.callId, output: JSON.stringify(result.output) });
        }
      }
    } catch (raw) {
      const error = raw instanceof SupportLlmError ? raw : toSupportLlmError(raw);
      this.logger.warn(`support_llm_error code=${error.code} status=${error.httpStatus ?? 'none'} request=${error.requestId ?? 'none'}`);
      const assistant = await this.conversations.finishAssistantMessage(assistantId, {
        blocks: [{ type: 'notice', level: 'error', text: UNAVAILABLE }, ...keepLastAction(blocks)],
        llmItems: [], inputTokens: sawUsage ? inputTokens : null, outputTokens: sawUsage ? outputTokens : null, toolCallCount, errorCode: error.code,
      });
      return { messages: [userMessage, assistant] };
    }

    const reply = finalText === null ? 'Não consegui concluir. Tente reformular ou use os atalhos.' : finalText;
    blocks = keepLastAction(blocks);
    const assistant = await this.conversations.finishAssistantMessage(assistantId, {
      blocks: [...(reply ? [{ type: 'text' as const, text: reply }] : []), ...blocks],
      llmItems: finalText === null ? [...produced, { role: 'assistant', content: reply }] : produced,
      inputTokens: sawUsage ? inputTokens : null, outputTokens: sawUsage ? outputTokens : null, toolCallCount, errorCode: null,
    });
    return { messages: [userMessage, assistant] };
  }
}

function keepLastAction(blocks: SupportBlock[]) {
  const last = blocks.filter((block) => block.type === 'action').at(-1);
  return blocks.filter((block) => block.type !== 'action' || block === last);
}
```

Atenção: quando as 4 rodadas se esgotam, o último item de `produced` é um `function_call_output`. Por isso a mensagem fixa entra como item `assistant`, fechando a sequência para o próximo turno.

- [ ] **Step 5: Rodar os testes**

Run: `cd backend && npx vitest run tests/support-chat.test.ts`
Expected: PASS (12 casos, contando os 5 do `it.each`).

- [ ] **Step 6: Commit**

```bash
git add backend/src/support/support-instructions.ts backend/src/support/support-chat.service.ts backend/tests/support-chat.test.ts
git commit -m "Feat: orquestrador do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: PDF dos 8 relatórios

**Files:**
- Modify: `backend/src/reports/reports-read.service.ts` (adicionar `readAll` depois de `read`)
- Create: `backend/src/reports/report-pdf-definitions.ts`
- Create: `backend/src/reports/reports-pdf.ts`
- Create: `backend/src/reports/reports-pdf.service.ts`
- Modify: `backend/src/reports/reports.controller.ts`, `backend/src/reports/reports.module.ts`
- Test: `backend/tests/reports-pdf.test.ts`

- [ ] **Step 1: Escrever o teste**

`backend/tests/reports-pdf.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { UnprocessableEntityException } from '@nestjs/common';
import * as schema from '@gestaonf/database/schema';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import { ReportsPdfService } from '../src/reports/reports-pdf.service.js';
import { formatCell, renderReportPdf } from '../src/reports/reports-pdf.js';
import { reportFiltersSchema, reportTypes } from '../src/reports/reports.schemas.js';
import { createTestDatabase, seedCompany, type TestDatabase } from './support-db.js';

let t: TestDatabase, reader: ReportsReadService, pdf: ReportsPdfService;
beforeAll(async () => {
  t = await createTestDatabase('reportspdf');
  reader = new ReportsReadService(t.database, new CrmPolicyService(t.database));
  pdf = new ReportsPdfService(t.database, reader);
}, 120000);
afterAll(async () => { await t?.drop(); });

const filters = (value: Record<string, unknown>) => reportFiltersSchema.parse(value);

describe('PDF de relatórios', () => {
  it('formata valores', () => {
    expect(formatCell('1234.5', 'money', 'America/Sao_Paulo')).toBe('R$ 1.234,50'.replace(' ', ' '));
    expect(formatCell('2026-11-05', 'date', 'America/Sao_Paulo')).toBe('05/11/2026');
    expect(formatCell('ACTIVE', 'status', 'America/Sao_Paulo')).toBe('Ativo');
    expect(formatCell(null, 'text', 'America/Sao_Paulo')).toBe('—');
    expect(formatCell([{ name: 'Consultoria', quantity: '2' }], 'items', 'America/Sao_Paulo')).toBe('Consultoria (2)');
  });

  it('renderiza várias páginas', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: String(i), name: `Cliente ${i}`, status: 'ACTIVE' }));
    const buffer = await renderReportPdf({ title: 'Clientes', companyName: 'Empresa', periodLabel: 'Todos os registros', generatedAt: new Date(), timezone: 'America/Sao_Paulo',
      summary: [{ label: 'Total', value: '120' }], columns: [{ key: 'name', label: 'Cliente', weight: 3 }, { key: 'status', label: 'Situação', weight: 1, format: 'status' }], rows });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect((buffer.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('readAll usa o mesmo caminho do read (mesmo resumo e linhas)', async () => {
    const ctx = await seedCompany(t.db);
    await t.db.insert(schema.customers).values(['Ana', 'Bruno', 'Carla'].map((name) => ({ companyId: ctx.companyId, createdByUserId: ctx.userId, kind: 'PF', name })));
    const input = filters({ limit: 100 });
    const page = await reader.read(ctx, 'customers', input);
    const all = await reader.readAll(ctx, 'customers', input, 100);
    expect(all.summary).toEqual(page.summary);
    expect(all.rows.map((row) => row.id)).toEqual(page.items.map((row) => row.id));
  });

  it('recusa acima do teto de linhas', async () => {
    const ctx = await seedCompany(t.db);
    await t.db.insert(schema.customers).values(['Ana', 'Bruno'].map((name) => ({ companyId: ctx.companyId, createdByUserId: ctx.userId, kind: 'PF', name })));
    await expect(reader.readAll(ctx, 'customers', filters({}), 1)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('gera PDF para os 8 relatórios', async () => {
    const ctx = await seedCompany(t.db);
    for (const type of reportTypes) {
      const file = await pdf.create(ctx, type, filters({ from: '2026-11-01', to: '2026-11-30' }));
      expect(file.buffer.subarray(0, 5).toString()).toBe('%PDF-');
      expect(file.filename).toBe(`${type}-2026-11-01-a-2026-11-30.pdf`);
    }
  });
});
```

Se o insert em `customers` exigir mais colunas `NOT NULL` (ex.: `countryCode` sem default), acrescente o valor no teste conforme `schema.ts`.

- [ ] **Step 2: Rodar e confirmar a falha**

Run: `cd backend && npx vitest run tests/reports-pdf.test.ts`
Expected: FAIL.

- [ ] **Step 3: Adicionar `readAll` em `backend/src/reports/reports-read.service.ts`** (logo depois do método `read`; incluir `UnprocessableEntityException` no import de `@nestjs/common`)

```ts
  async readAll(ctx: CrmContext, type: ReportType, input: ReportInput, maxRows: number) {
    this.validate(type, input);
    return this.database.db.transaction(async (tx) => {
      const a = await this.policy.access(ctx, tx), d = this.definition(type, input, a);
      const [summary] = await tx.execute(sql`WITH report_rows AS (${d.rows}) ${d.summary}`);
      const rows = await tx.execute(sql`WITH report_rows AS (${d.rows}) SELECT * FROM report_rows
        WHERE ${d.target ? sql`"decisionStatus"=${d.target}` : sql`TRUE`}
        ORDER BY "_order" DESC,id DESC LIMIT ${maxRows + 1}`) as unknown as ReportRow[];
      if (rows.length > maxRows) throw new UnprocessableEntityException(`O PDF aceita até ${maxRows} linhas. Reduza o período ou refine os filtros.`);
      return {
        summary: summary as Record<string, unknown>,
        rows: rows.map(({ _sort: _internal, _order: _date, ...row }) => row as Record<string, unknown> & { id: string }),
        timezone: a.timezone,
      };
    }, { isolationLevel: 'repeatable read' });
  }
```

- [ ] **Step 4: `backend/src/reports/reports-pdf.ts`**

```ts
import PDFDocument from 'pdfkit';

export type PdfFormat = 'text' | 'money' | 'date' | 'instant' | 'status' | 'items' | 'percent' | 'number';
export type PdfColumn = { key: string; label: string; weight: number; format?: PdfFormat };
export type ReportPdfInput = {
  title: string; companyName: string; periodLabel: string; generatedAt: Date; timezone: string;
  summary: { label: string; value: string }[]; columns: PdfColumn[]; rows: Record<string, unknown>[];
};

const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativo', INACTIVE: 'Inativo', SCHEDULED: 'Agendada', COMPLETED: 'Realizada', CANCELED: 'Cancelada', NO_SHOW: 'Não compareceu',
  RECEIPT: 'Recebimento', REVERSAL: 'Estorno', MANUAL: 'Manual', FORM: 'Formulário', META_ADS: 'Meta Ads', GOOGLE_ADS: 'Google Ads',
  IMPORT: 'Importação', NERO: 'Nero', API: 'Integração', NEW: 'Novo', CONTACTING: 'Em contato', QUALIFIED: 'Qualificado',
  DISQUALIFIED: 'Desqualificado', LOST: 'Perdido', WON: 'Ganho', PF: 'Pessoa física', PJ: 'Pessoa jurídica', ONLINE: 'Online',
  IN_PERSON: 'Presencial', PIX: 'Pix', CASH: 'Dinheiro', CREDIT_CARD: 'Cartão de crédito', DEBIT_CARD: 'Cartão de débito',
  BOLETO: 'Boleto', TRANSFER: 'Transferência', OTHER: 'Outro',
};
const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export function formatCell(value: unknown, format: PdfFormat = 'text', timezone: string): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (format) {
    case 'money': return brl.format(Number(value));
    case 'date': return String(value).slice(0, 10).split('-').reverse().join('/');
    case 'instant': return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: timezone }).format(new Date(String(value)));
    case 'status': return statusLabels[String(value)] ?? String(value);
    case 'items': return Array.isArray(value) ? value.map((item: { name?: unknown; quantity?: unknown }) => `${String(item.name)} (${String(item.quantity)})`).join(', ') || '—' : String(value);
    case 'percent': return `${Number(value).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
    case 'number': return Number(value).toLocaleString('pt-BR');
    default: return String(value);
  }
}

export function renderReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 32, bufferPages: true, info: { Title: `${input.title} — ${input.companyName}`, Author: 'GestãoNF' } });
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);

    const left = 32, width = pdf.page.width - 64, bottom = () => pdf.page.height - 48;
    pdf.font('Helvetica-Bold').fontSize(16).fillColor('#102a37').text(input.title, left, 32, { width });
    pdf.font('Helvetica').fontSize(9).fillColor('#4b5a63')
      .text(`${input.companyName} · ${input.periodLabel} · Gerado em ${formatCell(input.generatedAt.toISOString(), 'instant', input.timezone)}`, left, pdf.y + 2, { width });

    const boxWidth = Math.min(160, width / Math.max(1, input.summary.length));
    const boxTop = pdf.y + 12;
    input.summary.forEach((item, index) => {
      const x = left + index * boxWidth;
      pdf.roundedRect(x, boxTop, boxWidth - 8, 42, 4).lineWidth(0.7).strokeColor('#d5dee3').stroke();
      pdf.font('Helvetica').fontSize(7.5).fillColor('#5c6973').text(item.label.toUpperCase(), x + 8, boxTop + 7, { width: boxWidth - 24, lineBreak: false, ellipsis: true });
      pdf.font('Helvetica-Bold').fontSize(11).fillColor('#102a37').text(item.value, x + 8, boxTop + 21, { width: boxWidth - 24, lineBreak: false, ellipsis: true });
    });
    pdf.y = boxTop + (input.summary.length ? 56 : 0);

    const totalWeight = input.columns.reduce((sum, column) => sum + column.weight, 0);
    const widths = input.columns.map((column) => (width * column.weight) / totalWeight);
    const header = () => {
      const y = pdf.y;
      pdf.rect(left, y, width, 18).fill('#eef3f5');
      let x = left;
      pdf.font('Helvetica-Bold').fontSize(7.5).fillColor('#35434d');
      input.columns.forEach((column, index) => { pdf.text(column.label, x + 4, y + 5, { width: widths[index] - 8, lineBreak: false, ellipsis: true }); x += widths[index]; });
      pdf.y = y + 18;
    };
    header();
    if (!input.rows.length) {
      pdf.font('Helvetica').fontSize(9).fillColor('#5c6973').text('Nenhum registro encontrado para os filtros escolhidos.', left, pdf.y + 10, { width });
    }
    for (const row of input.rows) {
      pdf.font('Helvetica').fontSize(8);
      const cells = input.columns.map((column) => formatCell(row[column.key], column.format, input.timezone));
      const height = Math.max(16, ...cells.map((cell, index) => pdf.heightOfString(cell, { width: widths[index] - 8 }) + 8));
      if (pdf.y + height > bottom()) { pdf.addPage(); pdf.y = 32; header(); pdf.font('Helvetica').fontSize(8); }
      const y = pdf.y;
      let x = left;
      pdf.fillColor('#1f2a30');
      cells.forEach((cell, index) => { pdf.text(cell, x + 4, y + 4, { width: widths[index] - 8 }); x += widths[index]; });
      pdf.moveTo(left, y + height).lineTo(left + width, y + height).lineWidth(0.5).strokeColor('#e3e9ec').stroke();
      pdf.y = y + height;
    }

    const range = pdf.bufferedPageRange();
    for (let index = 0; index < range.count; index++) {
      pdf.switchToPage(range.start + index);
      const margin = pdf.page.margins.bottom;
      pdf.page.margins.bottom = 0;
      pdf.font('Helvetica').fontSize(7.5).fillColor('#8a969d')
        .text(`GestãoNF · Página ${index + 1} de ${range.count}`, left, pdf.page.height - 28, { width, align: 'right', lineBreak: false });
      pdf.page.margins.bottom = margin;
    }
    pdf.end();
  });
}
```

- [ ] **Step 5: `backend/src/reports/report-pdf-definitions.ts`** (colunas iguais às de `frontend/src/features/reports/report-definitions.ts`)

```ts
import type { ReportType } from './reports.schemas.js';
import type { PdfColumn, PdfFormat } from './reports-pdf.js';

type Definition = { title: string; columns: PdfColumn[]; summary: { key: string; label: string; format: PdfFormat }[] };

export const reportPdfDefinitions: Record<ReportType, Definition> = {
  'closed-services': {
    title: 'Serviços fechados',
    columns: [
      { key: 'orderCode', label: 'Pedido', weight: 1 }, { key: 'customerName', label: 'Cliente', weight: 2.5 },
      { key: 'items', label: 'Serviços', weight: 3, format: 'items' }, { key: 'soldOn', label: 'Data da venda', weight: 1.2, format: 'date' },
      { key: 'userName', label: 'Lançado por', weight: 1.6 }, { key: 'contractedAmount', label: 'Valor contratado', weight: 1.4, format: 'money' },
    ],
    summary: [
      { key: 'saleCount', label: 'Pedidos', format: 'number' }, { key: 'contractedAmount', label: 'Total contratado', format: 'money' },
      { key: 'receivedAmount', label: 'Recebido', format: 'money' }, { key: 'pendingAmount', label: 'Pendente', format: 'money' },
    ],
  },
  'service-receipts': {
    title: 'Recebimento de serviços',
    columns: [
      { key: 'effectiveOn', label: 'Data', weight: 1.1, format: 'date' }, { key: 'orderCode', label: 'Pedido', weight: 1 },
      { key: 'customerName', label: 'Cliente', weight: 2.4 }, { key: 'paycode', label: 'Parcela', weight: 1 },
      { key: 'kind', label: 'Movimento', weight: 1.2, format: 'status' }, { key: 'paymentMethod', label: 'Forma', weight: 1.4, format: 'status' },
      { key: 'userName', label: 'Lançado por', weight: 1.6 }, { key: 'signedAmount', label: 'Valor', weight: 1.3, format: 'money' },
    ],
    summary: [
      { key: 'movementCount', label: 'Movimentos', format: 'number' }, { key: 'grossAmount', label: 'Recebido bruto', format: 'money' },
      { key: 'reversedAmount', label: 'Estornado', format: 'money' }, { key: 'netAmount', label: 'Total líquido', format: 'money' },
    ],
  },
  'lead-entries': {
    title: 'Entrada de leads',
    columns: [
      { key: 'receivedAt', label: 'Entrada', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'captureKind', label: 'Canal', weight: 1.2, format: 'status' },
      { key: 'utmSource', label: 'Origem', weight: 1.2 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.4 },
      { key: 'serviceName', label: 'Serviço de interesse', weight: 1.8 }, { key: 'userName', label: 'Responsável', weight: 1.5 },
    ],
    summary: [{ key: 'entries', label: 'Entradas', format: 'number' }, { key: 'uniqueLeads', label: 'Leads únicos', format: 'number' }],
  },
  customers: {
    title: 'Clientes',
    columns: [
      { key: 'name', label: 'Cliente', weight: 2.6 }, { key: 'kind', label: 'Tipo', weight: 1.3, format: 'status' },
      { key: 'taxId', label: 'CPF / CNPJ', weight: 1.5 }, { key: 'email', label: 'E-mail', weight: 2.2 },
      { key: 'phone', label: 'Telefone', weight: 1.3 }, { key: 'status', label: 'Situação', weight: 1, format: 'status' },
      { key: 'createdAt', label: 'Cadastro', weight: 1.4, format: 'instant' },
    ],
    summary: [{ key: 'total', label: 'Total', format: 'number' }, { key: 'active', label: 'Ativos', format: 'number' }, { key: 'inactive', label: 'Inativos', format: 'number' }],
  },
  'service-catalog': {
    title: 'Catálogo de serviços',
    columns: [
      { key: 'internalCode', label: 'Código', weight: 1 }, { key: 'name', label: 'Serviço', weight: 3 },
      { key: 'unitLabel', label: 'Unidade', weight: 0.9 }, { key: 'suggestedUnitPrice', label: 'Preço sugerido', weight: 1.3, format: 'money' },
      { key: 'status', label: 'Situação', weight: 1, format: 'status' }, { key: 'createdAt', label: 'Cadastro', weight: 1.4, format: 'instant' },
    ],
    summary: [{ key: 'total', label: 'Total', format: 'number' }, { key: 'active', label: 'Ativos', format: 'number' }, { key: 'inactive', label: 'Inativos', format: 'number' }],
  },
  meetings: {
    title: 'Reuniões',
    columns: [
      { key: 'startsAt', label: 'Início', weight: 1.4, format: 'instant' }, { key: 'title', label: 'Reunião', weight: 2.5 },
      { key: 'contactName', label: 'Lead', weight: 2 }, { key: 'userName', label: 'Responsável', weight: 1.6 },
      { key: 'modality', label: 'Modalidade', weight: 1.2, format: 'status' }, { key: 'status', label: 'Situação', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'total', label: 'Agendadas', format: 'number' }, { key: 'completed', label: 'Realizadas', format: 'number' },
      { key: 'canceled', label: 'Canceladas', format: 'number' }, { key: 'noShow', label: 'Não compareceu', format: 'number' },
      { key: 'scheduled', label: 'A realizar', format: 'number' },
    ],
  },
  'disqualification-rate': {
    title: 'Taxa de desqualificação',
    columns: [
      { key: 'decidedAt', label: 'Encerramento', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'reason', label: 'Motivo', weight: 2.2 },
      { key: 'userName', label: 'Responsável', weight: 1.5 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.3 },
      { key: 'currentStatus', label: 'Situação atual', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'rate', label: 'Taxa', format: 'percent' }, { key: 'disqualified', label: 'Desqualificadas', format: 'number' },
      { key: 'decisions', label: 'Decisões', format: 'number' },
    ],
  },
  'loss-rate': {
    title: 'Taxa de perda',
    columns: [
      { key: 'decidedAt', label: 'Encerramento', weight: 1.4, format: 'instant' }, { key: 'contactName', label: 'Lead', weight: 2 },
      { key: 'title', label: 'Negociação', weight: 2 }, { key: 'reason', label: 'Motivo', weight: 2.2 },
      { key: 'userName', label: 'Responsável', weight: 1.5 }, { key: 'utmCampaign', label: 'Campanha', weight: 1.3 },
      { key: 'currentStatus', label: 'Situação atual', weight: 1.3, format: 'status' },
    ],
    summary: [
      { key: 'rate', label: 'Taxa', format: 'percent' }, { key: 'lost', label: 'Perdidas', format: 'number' },
      { key: 'decisions', label: 'Decisões', format: 'number' },
    ],
  },
};
```

- [ ] **Step 6: `backend/src/reports/reports-pdf.service.ts`**

```ts
import { Inject, Injectable } from '@nestjs/common';
import { companies } from '@gestaonf/database/schema';
import { eq } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import type { CrmContext } from '../crm/crm.schemas.js';
import { ReportsReadService } from './reports-read.service.js';
import { reportPdfDefinitions } from './report-pdf-definitions.js';
import { formatCell, renderReportPdf } from './reports-pdf.js';
import type { ReportInput, ReportType } from './reports.schemas.js';

const brDate = (value: string) => value.split('-').reverse().join('/');

@Injectable()
export class ReportsPdfService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(ReportsReadService) private readonly reader: ReportsReadService) {}

  async create(ctx: CrmContext, type: ReportType, input: ReportInput) {
    const maxRows = Number(process.env.REPORTS_PDF_MAX_ROWS) || 5000;
    const data = await this.reader.readAll(ctx, type, input, maxRows);
    const [company] = await this.database.db.select({ name: companies.name }).from(companies).where(eq(companies.id, ctx.companyId)).limit(1);
    const definition = reportPdfDefinitions[type];
    const buffer = await renderReportPdf({
      title: definition.title,
      companyName: company?.name ?? '',
      periodLabel: input.from && input.to ? `Período: ${brDate(input.from)} a ${brDate(input.to)}` : 'Todos os registros',
      generatedAt: new Date(),
      timezone: data.timezone,
      summary: definition.summary.map((item) => ({ label: item.label, value: formatCell(data.summary[item.key], item.format, data.timezone) })),
      columns: definition.columns,
      rows: data.rows,
    });
    return { buffer, filename: `${type}${input.from && input.to ? `-${input.from}-a-${input.to}` : ''}.pdf` };
  }
}
```

- [ ] **Step 7: Rota no controller e provider no módulo**

Em `backend/src/reports/reports.controller.ts`: importe `ReportsPdfService`, injete-o no construtor e adicione a rota **antes** de `@Get(':type')`:

```ts
  constructor(@Inject(ReportsReadService) private readonly reader:ReportsReadService,@Inject(ReportsCsvService) private readonly csv:ReportsCsvService,@Inject(ReportsPdfService) private readonly pdf:ReportsPdfService) {}
```

```ts
  @Get(':type/pdf')
  @ApiOperation({summary:'Gera o PDF do relatório com todos os registros filtrados'})
  async pdfReport(@Req() r:RequestContext,@Param('type') type:unknown,@Query() query:unknown,@Res() reply:FastifyReply) {
    const file=await this.pdf.create(ctx(r),parseInput(reportTypeSchema,type),parseInput(reportFiltersSchema,query));
    return reply.header('Content-Type','application/pdf').header('Cache-Control','private, no-store').header('Content-Disposition',`attachment; filename="${file.filename}"`).send(file.buffer);
  }
```

Em `backend/src/reports/reports.module.ts`, acrescente `ReportsPdfService` em `providers`.

- [ ] **Step 8: Rodar testes e typecheck**

Run: `cd backend && npx vitest run tests/reports-pdf.test.ts && npm run typecheck`
Expected: PASS. Se a primeira asserção de `formatCell('1234.5','money')` falhar por diferença de espaço do `Intl`, troque a expectativa por `expect(formatCell(...)).toMatch(/^R\$\s1\.234,50$/)`.

- [ ] **Step 9: Commit**

```bash
git add backend/src/reports backend/tests/reports-pdf.test.ts
git commit -m "Feat: PDF dos relatórios

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Controller, módulo, script de verificação e configuração

**Files:**
- Create: `backend/src/support/support.schemas.ts`, `backend/src/support/support.controller.ts`, `backend/src/support/support.module.ts`
- Create: `backend/scripts/check-support-ai.ts`
- Modify: `backend/src/services/services.module.ts`, `backend/src/app.module.ts`, `backend/package.json`, `.env.example`

- [ ] **Step 1: `support.schemas.ts`**

```ts
import { z } from 'zod';

export const sendMessageSchema = z.strictObject({ text: z.string().trim().min(1, 'Escreva sua mensagem').max(1000, 'Use até 1000 caracteres') });
export const actionIdSchema = z.uuid();
export const helpIdSchema = z.string().regex(/^[a-z0-9-]{1,60}$/);
```

- [ ] **Step 2: `support.controller.ts`**

```ts
import { Body, Controller, Get, HttpCode, Inject, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessGuard, CompanyGuard, type RequestContext } from '../auth/access.guard.js';
import { parseInput } from '../common/validate.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { SupportActionsService } from './support-actions.service.js';
import { destinations } from './support-blocks.js';
import { SupportChatService } from './support-chat.service.js';
import { SUPPORT_CONFIG, type SupportConfig } from './support-config.js';
import { SupportConversationsService } from './support-conversations.service.js';
import { actionIdSchema, helpIdSchema, sendMessageSchema } from './support.schemas.js';

const ctx = (request: RequestContext) => ({ companyId: request.companyId!, userId: request.userId! });

@ApiTags('Assistente de suporte')
@ApiBearerAuth()
@ApiHeader({ name: 'X-Company-Id', required: true })
@UseGuards(AccessGuard, CompanyGuard)
@Controller('support')
export class SupportController {
  constructor(
    @Inject(SupportChatService) private readonly chat: SupportChatService,
    @Inject(SupportConversationsService) private readonly conversations: SupportConversationsService,
    @Inject(SupportActionsService) private readonly actions: SupportActionsService,
    @Inject(SupportHelpCatalog) private readonly catalog: SupportHelpCatalog,
    @Inject(SUPPORT_CONFIG) private readonly config: SupportConfig,
  ) {}

  @Get('conversation')
  @ApiOperation({ summary: 'Conversa ativa do usuário nesta empresa' })
  async conversation(@Req() request: RequestContext) {
    const current = await this.conversations.active(ctx(request));
    return { conversation: current ? { id: current.id, messages: await this.conversations.messages(current.id) } : null, aiEnabled: this.config.enabled };
  }

  @Post('conversation/messages')
  @ApiOperation({ summary: 'Envia uma mensagem ao assistente' })
  send(@Req() request: RequestContext, @Body() body: unknown) {
    return this.chat.send(ctx(request), parseInput(sendMessageSchema, body).text);
  }

  @Post('conversation/reset')
  @HttpCode(204)
  async reset(@Req() request: RequestContext) { await this.conversations.reset(ctx(request)); }

  @Post('actions/:id/confirm')
  async confirm(@Req() request: RequestContext, @Param('id') id: string) {
    return { block: await this.actions.confirm(ctx(request), parseInput(actionIdSchema, id)) };
  }

  @Post('actions/:id/cancel')
  async cancel(@Req() request: RequestContext, @Param('id') id: string) {
    return { block: await this.actions.cancel(ctx(request), parseInput(actionIdSchema, id)) };
  }

  @Get('help')
  help() { return this.catalog.list(); }

  @Get('help/:id')
  article(@Param('id') id: string) {
    const article = this.catalog.get(parseInput(helpIdSchema, id));
    if (!article) throw new NotFoundException('Artigo de ajuda não encontrado');
    return { id: article.id, titulo: article.titulo, to: article.rota ? destinations[article.rota] : null, conteudo: article.conteudo };
  }
}
```

- [ ] **Step 3: `support.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { CustomersModule } from '../customers/customers.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { SalesModule } from '../sales/sales.module.js';
import { ServicesModule } from '../services/services.module.js';
import { SupportHelpCatalog } from './help-catalog.js';
import { OpenAiSupportLlmClient } from './llm/openai-support-llm.client.js';
import { SUPPORT_LLM } from './llm/support-llm.client.js';
import { SupportActionsService } from './support-actions.service.js';
import { SupportChatService } from './support-chat.service.js';
import { SUPPORT_CONFIG, supportConfig, type SupportConfig } from './support-config.js';
import { SupportConversationsService } from './support-conversations.service.js';
import { SupportController } from './support.controller.js';
import { SupportToolRegistry } from './tools/tool-registry.js';

@Module({
  imports: [AuthModule, CustomersModule, ServicesModule, SalesModule, ReportsModule],
  controllers: [SupportController],
  providers: [
    { provide: SUPPORT_CONFIG, useFactory: () => supportConfig() },
    { provide: SUPPORT_LLM, inject: [SUPPORT_CONFIG], useFactory: (config: SupportConfig) => (config.enabled ? new OpenAiSupportLlmClient(config) : null) },
    { provide: SupportHelpCatalog, useFactory: () => SupportHelpCatalog.load() },
    SupportConversationsService, SupportActionsService, SupportToolRegistry, SupportChatService,
  ],
})
export class SupportModule {}
```

- [ ] **Step 4: Exportar `ServicesService` e registrar o módulo**

`backend/src/services/services.module.ts`:
```ts
@Module({ imports: [AuthModule], controllers: [ServicesController], providers: [ServicesService], exports: [ServicesService] })
```

`backend/src/app.module.ts`: importar `SupportModule` de `./support/support.module.js` e acrescentá-lo ao fim do array `imports`.

- [ ] **Step 5: Script `backend/scripts/check-support-ai.ts`**

```ts
import 'reflect-metadata';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { supportConfig } from '../src/support/support-config.js';
import { OpenAiSupportLlmClient } from '../src/support/llm/openai-support-llm.client.js';
import { SupportLlmError } from '../src/support/llm/support-llm.client.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

async function main() {
  const settings = supportConfig();
  if (!settings.apiKey) { console.error('Configure OPENAI_API_KEY (ou SUPPORT_OPENAI_API_KEY) antes do teste.'); process.exitCode = 1; return; }
  const client = new OpenAiSupportLlmClient(settings, { maxRetries: 0 });
  console.log(`Chamando ${settings.baseURL ?? 'api.openai.com'} com o modelo ${settings.model}...`);
  try {
    const result = await client.respond({ instructions: 'Responda apenas: ok', input: [{ role: 'user', content: 'Teste de conexão do assistente de suporte' }], tools: [] });
    console.log(`Resposta recebida: "${result.text}" (${result.usage?.inputTokens ?? '?'} tokens de entrada, ${result.usage?.outputTokens ?? '?'} de saída).`);
  } catch (error) {
    if (!(error instanceof SupportLlmError)) throw error;
    console.log(`A chamada saiu e a API respondeu: HTTP ${error.httpStatus ?? 'sem status'} → ${error.code}${error.requestId ? ` (request ${error.requestId})` : ''}`);
    if (error.code === 'AI_QUOTA') console.log('Integração OK: falta apenas saldo na billing da OpenAI.');
    process.exitCode = error.code === 'AI_QUOTA' ? 0 : 1;
  }
}
main().catch((error) => { console.error('Falha inesperada:', error instanceof Error ? error.message : error); process.exitCode = 1; });
```

Em `backend/package.json`, na seção `scripts`, depois de `"email:check"`:
```json
"support:check": "tsx scripts/check-support-ai.ts",
```

- [ ] **Step 6: `.env.example`** (na raiz, logo abaixo do bloco `OPENAI_MODEL`/`NILO_WORKER_CONCURRENCY`)

```dotenv
# Assistente de suporte (widget no sistema). Usa OPENAI_API_KEY se SUPPORT_OPENAI_API_KEY estiver vazia.
SUPPORT_AI_ENABLED=false
SUPPORT_AI_MODEL=gpt-6-luna
SUPPORT_OPENAI_API_KEY=
SUPPORT_AI_BASE_URL=
SUPPORT_DAILY_MESSAGE_LIMIT=100
REPORTS_PDF_MAX_ROWS=5000
```

- [ ] **Step 7: Typecheck, suíte e subida da API**

Run: `cd backend && npm run typecheck && npx vitest run tests/support-*.test.ts tests/reports-pdf.test.ts`
Expected: tudo PASS.

Run (em segundo plano): `cd backend && npm run dev:api`. Depois: `curl -s -o /dev/null -w "%{http_code}" -k https://localhost:4030/support/help` (ou `http://`, conforme o `docs/local-https.md`).
Expected: `401`. A rota existe e exige autenticação. Um `404` significa que o módulo não foi registrado. Encerre a API depois.

- [ ] **Step 8: Verificação real da API**

Run: `cd backend && npm run support:check`
Expected (billing zerada): `A chamada saiu e a API respondeu: HTTP 429 → AI_QUOTA ...` e `Integração OK: falta apenas saldo na billing da OpenAI.` Se vier `AI_BAD_REQUEST` com HTTP 400, anote a mensagem: pode ser o nome do modelo. Isso não bloqueia a tarefa, mas deve ser relatado.

- [ ] **Step 9: Commit**

```bash
git add backend/src/support backend/src/services/services.module.ts backend/src/app.module.ts backend/scripts/check-support-ai.ts backend/package.json .env.example
git commit -m "Feat: endpoints do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend — API, botão de PDF nos Relatórios e deep link da venda

**Files:**
- Modify: `frontend/src/api/client.ts`
- Create: `frontend/src/features/support/download.ts`
- Modify: `frontend/src/features/reports/ReportsPage.tsx`, `frontend/src/features/reports/reports.css`
- Modify: `frontend/src/features/sales/SalesPage.tsx`

- [ ] **Step 1: Tipos e funções em `frontend/src/api/client.ts`**

Logo depois do bloco de `ReportResult`/`reportQuery`, acrescentar os tipos:

```ts
export type SupportActionStatus = 'PENDING' | 'CONFIRMED' | 'CANCELED' | 'EXPIRED' | 'FAILED';
export type SupportActionBlock = { type: 'action'; actionId: string; kind: 'CREATE_CUSTOMER' | 'CREATE_SERVICE'; status: SupportActionStatus;
  summary: { label: string; value: string }[]; expiresAt: string; resultTo?: string; errorMessage?: string };
export type SupportBlock =
  | { type: 'text'; text: string }
  | { type: 'notice'; level: 'info' | 'error'; text: string }
  | { type: 'navigate'; label: string; to: string }
  | { type: 'download'; label: string; url: string; filename: string }
  | SupportActionBlock;
export type SupportMessage = { id: string; role: 'user' | 'assistant'; createdAt: string; blocks: SupportBlock[] };
export type SupportConversation = { conversation: { id: string; messages: SupportMessage[] } | null; aiEnabled: boolean };
export type SupportHelpTopic = { id: string; titulo: string };
export type SupportHelpArticle = SupportHelpTopic & { to: string | null; conteudo: string };
```

E, dentro de `export const api = {`, junto de `reportCsv`:

```ts
  reportPdf: (companyId: string, type: ReportType, filters: ReportFilters) => requestBlob(`/reports/${type}/pdf?${reportQuery(filters)}`, companyId),
  supportConversation: (companyId: string) => request<SupportConversation>('/support/conversation', {}, { companyId }),
  supportSend: (companyId: string, text: string) => request<{ messages: SupportMessage[] }>('/support/conversation/messages', { method: 'POST', body: json({ text }) }, { companyId }),
  supportReset: (companyId: string) => request<void>('/support/conversation/reset', { method: 'POST' }, { companyId }),
  supportConfirm: (companyId: string, id: string) => request<{ block: SupportActionBlock }>(`/support/actions/${id}/confirm`, { method: 'POST' }, { companyId }),
  supportCancel: (companyId: string, id: string) => request<{ block: SupportActionBlock }>(`/support/actions/${id}/cancel`, { method: 'POST' }, { companyId }),
  supportHelpList: (companyId: string) => request<SupportHelpTopic[]>('/support/help', {}, { companyId }),
  supportHelp: (companyId: string, id: string) => request<SupportHelpArticle>(`/support/help/${encodeURIComponent(id)}`, {}, { companyId }),
  supportDownload: (companyId: string, url: string) => requestBlob(url, companyId),
```

- [ ] **Step 2: `frontend/src/features/support/download.ts`**

```ts
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function reportPdfFilename(type: string, from?: string, to?: string) {
  return `${type}${from && to ? `-${from}-a-${to}` : ''}.pdf`;
}
```

- [ ] **Step 3: Botão "Exportar PDF" em `ReportsPage.tsx`**

Importar `FileDown` de `lucide-react` (junto de `Download`) e `{ saveBlob, reportPdfFilename }` de `'../support/download'`. Logo depois da `useMutation` do `csv` (linha ~39):

```tsx
  const pdf=useMutation({mutationFn:()=>api.reportPdf(companyId,d.type,applied),onSuccess:(blob)=>saveBlob(blob,reportPdfFilename(d.type,applied.from,applied.to))});
```

No `<div className="reports-actions">` do header, antes do botão de CSV:

```tsx
{pdf.isError && <span role="alert" className="reports-pdf-error">{pdf.error.message}</span>}<button className="button button--secondary" disabled={pdf.isPending || result.isPending || result.isError} onClick={()=>pdf.mutate()}><FileDown size={16}/>{pdf.isPending ? 'Gerando PDF...' : 'Exportar PDF'}</button>
```

Em `reports.css`, acrescentar: `.reports-pdf-error{color:var(--danger);font-size:12px;align-self:center}`

Confirme que `applied` tem `from`/`to` (é o estado de filtros aplicados usado pelo `reportCsv`). Se o nome for outro, use o mesmo objeto que o CSV usa.

- [ ] **Step 4: Deep link `?abrir=` em `SalesPage.tsx`**

Logo depois do `useEffect` que trata `editar` (termina em `}, [params, setParams, companyId, companies.data]);`):

```tsx
  useEffect(() => {
    const id = params.get('abrir');
    if (!id || !companies.data) return;
    const requestedCompany = params.get('empresa') ?? companyId;
    const clear = () => { const next = new URLSearchParams(params); next.delete('abrir'); next.delete('empresa'); setParams(next, { replace: true }); };
    if (!companies.data.some(c => c.id === requestedCompany) || !/^[a-f0-9-]{36}$/i.test(id)) { setToast('Pedido ou empresa inválidos.'); clear(); return; }
    if (companyId !== requestedCompany) { setCompanyId(requestedCompany); return; }
    setEditing(false); setEditingDraft(null); setSelectedId(id); clear();
  }, [params, setParams, companyId, companies.data]);
```

- [ ] **Step 5: Typecheck do frontend**

Run: `cd frontend && npx tsc -b`
Expected: sem erros. Se o projeto não usar referências, rode `npx tsc --noEmit -p tsconfig.json`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/client.ts frontend/src/features/support/download.ts frontend/src/features/reports frontend/src/features/sales/SalesPage.tsx
git commit -m "Feat: PDF nos relatórios e deep link do pedido

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Frontend — widget de suporte

**Files:**
- Create: `frontend/src/features/support/SupportText.tsx`, `SupportBlocks.tsx`, `QuickActions.tsx`, `ReportPdfForm.tsx`, `SupportHelp.tsx`, `SupportPanel.tsx`, `SupportWidget.tsx`, `support.css`
- Modify: `frontend/src/components/WorkspaceLayout.tsx`

- [ ] **Step 1: `SupportText.tsx`** (markdown simples, sem HTML)

```tsx
import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={index}>{part.slice(2, -2)}</strong> : <Fragment key={index}>{part}</Fragment>);
}

const bullet = /^\s*[-•*]\s+/;
const numbered = /^\s*\d+[.)]\s+/;
const heading = /^#{1,6}\s+/;

export function SupportText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((item, index) => <li key={index}>{inline(item)}</li>);
    out.push(list.ordered ? <ol key={out.length}>{items}</ol> : <ul key={out.length}>{items}</ul>);
    list = null;
  };
  for (const line of text.split(/\r?\n/)) {
    const ordered = numbered.test(line);
    if (ordered || bullet.test(line)) {
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push(line.replace(ordered ? numbered : bullet, ''));
      continue;
    }
    flush();
    const trimmed = line.trim();
    if (!trimmed) continue;
    out.push(heading.test(trimmed) ? <h4 key={out.length}>{inline(trimmed.replace(heading, ''))}</h4> : <p key={out.length}>{inline(trimmed)}</p>);
  }
  flush();
  return <div className="support-text">{out}</div>;
}
```

- [ ] **Step 2: `SupportBlocks.tsx`**

```tsx
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api, type SupportActionBlock, type SupportBlock } from '../../api/client';
import { saveBlob } from './download';
import { SupportText } from './SupportText';

type Props = { companyId: string; onActionSettled: () => void };
const statusText: Record<SupportActionBlock['status'], string> = {
  PENDING: 'Aguardando sua confirmação', CONFIRMED: 'Cadastro concluído', CANCELED: 'Cancelado',
  EXPIRED: 'Expirado. Peça novamente ao assistente.', FAILED: 'Não foi possível concluir',
};

export function SupportBlocks({ blocks, ...props }: Props & { blocks: SupportBlock[] }) {
  return <>{blocks.map((block, index) => <BlockView key={block.type === 'action' ? block.actionId : index} block={block} {...props} />)}</>;
}

function BlockView({ block, companyId, onActionSettled }: Props & { block: SupportBlock }) {
  switch (block.type) {
    case 'text': return <SupportText text={block.text} />;
    case 'notice': return <p className={`support-notice support-notice--${block.level}`} role={block.level === 'error' ? 'alert' : 'status'}>{block.text}</p>;
    case 'navigate': return <NavigateButton to={block.to} label={block.label} />;
    case 'download': return <DownloadButton companyId={companyId} url={block.url} label={block.label} filename={block.filename} />;
    case 'action': return <ActionCard companyId={companyId} block={block} onActionSettled={onActionSettled} />;
  }
}

function NavigateButton({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  return <button type="button" className="support-link" onClick={() => navigate(to)}>{label}<ArrowRight size={14} /></button>;
}

function DownloadButton({ companyId, url, label, filename }: { companyId: string; url: string; label: string; filename: string }) {
  const download = useMutation({ mutationFn: () => api.supportDownload(companyId, url), onSuccess: (blob) => saveBlob(blob, filename) });
  return <>
    <button type="button" className="support-link" disabled={download.isPending} onClick={() => download.mutate()}><FileDown size={14} />{download.isPending ? 'Gerando PDF...' : label}</button>
    {download.isError && <p className="support-notice support-notice--error" role="alert">{download.error.message}</p>}
  </>;
}

function ActionCard({ companyId, block, onActionSettled }: Props & { block: SupportActionBlock }) {
  const navigate = useNavigate();
  const confirm = useMutation({ mutationFn: () => api.supportConfirm(companyId, block.actionId), onSettled: onActionSettled });
  const cancel = useMutation({ mutationFn: () => api.supportCancel(companyId, block.actionId), onSettled: onActionSettled });
  const busy = confirm.isPending || cancel.isPending;
  const title = block.kind === 'CREATE_CUSTOMER' ? 'Novo cliente' : 'Novo serviço';
  const error = confirm.error ?? cancel.error;
  return <section className={`support-action support-action--${block.status.toLowerCase()}`} aria-label={title}>
    <header><strong>{title}</strong><span>{statusText[block.status]}</span></header>
    <dl>{block.summary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    {block.status === 'FAILED' && block.errorMessage && <p className="support-notice support-notice--error">{block.errorMessage}</p>}
    {error && <p className="support-notice support-notice--error" role="alert">{error.message}</p>}
    {block.status === 'PENDING' && <div className="support-action__buttons">
      <button type="button" className="button button--secondary" disabled={busy} onClick={() => cancel.mutate()}>Cancelar</button>
      <button type="button" className="button button--primary" disabled={busy} onClick={() => confirm.mutate()}>{confirm.isPending ? 'Salvando...' : 'Confirmar'}</button>
    </div>}
    {block.status === 'CONFIRMED' && block.resultTo && <button type="button" className="support-link" onClick={() => navigate(block.resultTo!)}>Abrir cadastro<ArrowRight size={14} /></button>}
  </section>;
}
```

- [ ] **Step 3: `QuickActions.tsx`**

```tsx
import { BookOpen, FileDown, UserPlus } from 'lucide-react';

export function QuickActions({ aiEnabled, onReport, onTopics, onPrompt }: { aiEnabled: boolean; onReport: () => void; onTopics: () => void; onPrompt: (text: string) => void }) {
  return <div className="support-quick" aria-label="Atalhos">
    <button type="button" className="support-chip" onClick={onReport}><FileDown size={14} />Gerar relatório em PDF</button>
    <button type="button" className="support-chip" onClick={onTopics}><BookOpen size={14} />Como fazer...</button>
    {aiEnabled && <button type="button" className="support-chip" onClick={() => onPrompt('Quero cadastrar um cliente')}><UserPlus size={14} />Cadastrar cliente</button>}
  </div>;
}
```

- [ ] **Step 4: `ReportPdfForm.tsx`** (sem IA)

```tsx
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft, FileDown } from 'lucide-react';
import { api, type ReportType } from '../../api/client';
import { monthPeriod, reports } from '../reports/report-definitions';
import { reportPdfFilename, saveBlob } from './download';

export function ReportPdfForm({ companyId, onBack }: { companyId: string; onBack: () => void }) {
  const initial = monthPeriod(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [type, setType] = useState<ReportType>('closed-services');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [validation, setValidation] = useState('');
  const catalog = reports.find((report) => report.type === type)?.catalog ?? false;
  const download = useMutation({
    mutationFn: () => api.reportPdf(companyId, type, from && to ? { from, to } : {}),
    onSuccess: (blob) => saveBlob(blob, reportPdfFilename(type, from || undefined, to || undefined)),
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!!from !== !!to || (!catalog && (!from || !to))) { setValidation('Informe a data inicial e a data final.'); return; }
    setValidation('');
    download.mutate();
  }
  return <form className="support-form" onSubmit={submit}>
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    <h3>Relatório em PDF</h3>
    <label>Tipo de relatório
      <select value={type} onChange={(event) => setType(event.target.value as ReportType)}>
        {reports.map((report) => <option key={report.type} value={report.type}>{report.title}</option>)}
      </select>
    </label>
    <div className="support-form__dates">
      <label>Data inicial<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Data final<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    {catalog && <p className="support-muted">Deixe as datas em branco para listar todos os registros.</p>}
    {(validation || download.isError) && <p className="support-notice support-notice--error" role="alert">{validation || download.error?.message}</p>}
    <button className="button button--primary" disabled={download.isPending}><FileDown size={16} />{download.isPending ? 'Gerando PDF...' : 'Baixar PDF'}</button>
  </form>;
}
```

- [ ] **Step 5: `SupportHelp.tsx`** (sem IA)

```tsx
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { api } from '../../api/client';
import { SupportText } from './SupportText';

export function HelpTopics({ companyId, onBack, onOpen }: { companyId: string; onBack: () => void; onOpen: (id: string) => void }) {
  const topics = useQuery({ queryKey: ['support-help'], queryFn: () => api.supportHelpList(companyId), staleTime: 3600_000 });
  return <div className="support-help">
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    <h3>Como fazer...</h3>
    {topics.isPending && <p className="support-muted">Carregando...</p>}
    {topics.isError && <p className="support-notice support-notice--error">{topics.error.message}</p>}
    <ul>{topics.data?.map((topic) => <li key={topic.id}><button type="button" className="support-link" onClick={() => onOpen(topic.id)}>{topic.titulo}</button></li>)}</ul>
  </div>;
}

export function HelpArticleView({ companyId, id, onBack }: { companyId: string; id: string; onBack: () => void }) {
  const navigate = useNavigate();
  const article = useQuery({ queryKey: ['support-help', id], queryFn: () => api.supportHelp(companyId, id), staleTime: 3600_000 });
  return <div className="support-help">
    <button type="button" className="support-back" onClick={onBack}><ArrowLeft size={14} />Voltar</button>
    {article.isPending && <p className="support-muted">Carregando...</p>}
    {article.isError && <p className="support-notice support-notice--error">{article.error.message}</p>}
    {article.data && <>
      <h3>{article.data.titulo}</h3>
      <SupportText text={article.data.conteudo} />
      {article.data.to && <button type="button" className="support-link" onClick={() => navigate(article.data!.to!)}>Ir para a tela<ArrowRight size={14} /></button>}
    </>}
  </div>;
}
```

- [ ] **Step 6: `SupportPanel.tsx`**

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Send, X } from 'lucide-react';
import { api } from '../../api/client';
import { QuickActions } from './QuickActions';
import { ReportPdfForm } from './ReportPdfForm';
import { SupportBlocks } from './SupportBlocks';
import { HelpArticleView, HelpTopics } from './SupportHelp';
import { SupportText } from './SupportText';

type View = 'chat' | 'report' | 'topics' | { article: string };

export function SupportPanel({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const key = ['support-conversation', companyId];
  const conversation = useQuery({ queryKey: key, queryFn: () => api.supportConversation(companyId) });
  const [view, setView] = useState<View>('chat');
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const send = useMutation({ mutationFn: (value: string) => api.supportSend(companyId, value), onSuccess: () => { setText(''); return refresh(); } });
  const reset = useMutation({ mutationFn: () => api.supportReset(companyId), onSuccess: () => { send.reset(); return refresh(); } });
  const messages = conversation.data?.conversation?.messages ?? [];
  const aiEnabled = conversation.data?.aiEnabled ?? false;

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight }); }, [messages.length, send.isPending, view]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (value && !send.isPending) send.mutate(value);
  }
  const prompt = (value: string) => { setView('chat'); send.mutate(value); };

  return <aside className="support-panel" role="dialog" aria-label="Ajuda do GestãoNF">
    <header className="support-panel__header">
      <div><strong>Ajuda do GestãoNF</strong><span>{aiEnabled ? 'Assistente de suporte' : 'Atalhos de ajuda'}</span></div>
      <div>
        <button type="button" className="icon-button" aria-label="Nova conversa" title="Nova conversa" disabled={reset.isPending || !messages.length} onClick={() => reset.mutate()}><RotateCcw size={16} /></button>
        <button type="button" className="icon-button" aria-label="Fechar ajuda" onClick={onClose}><X size={16} /></button>
      </div>
    </header>
    {view === 'report' ? <div className="support-body"><ReportPdfForm companyId={companyId} onBack={() => setView('chat')} /></div>
      : view === 'topics' ? <div className="support-body"><HelpTopics companyId={companyId} onBack={() => setView('chat')} onOpen={(id) => setView({ article: id })} /></div>
      : typeof view === 'object' ? <div className="support-body"><HelpArticleView companyId={companyId} id={view.article} onBack={() => setView('topics')} /></div>
      : <>
        <div className="support-messages support-body" ref={listRef} aria-live="polite">
          {conversation.isPending && <p className="support-muted">Carregando...</p>}
          {!conversation.isPending && !messages.length && !send.isPending && <p className="support-empty">Como posso ajudar? {aiEnabled ? 'Escreva sua dúvida ou use um atalho.' : 'Use um dos atalhos abaixo.'}</p>}
          {messages.map((message) => <div key={message.id} className={`support-message support-message--${message.role}`}>
            <SupportBlocks companyId={companyId} blocks={message.blocks} onActionSettled={refresh} />
          </div>)}
          {send.isPending && <>
            <div className="support-message support-message--user"><SupportText text={send.variables ?? ''} /></div>
            <div className="support-message support-message--assistant support-typing" aria-label="Assistente digitando"><span /><span /><span /></div>
          </>}
          {send.isError && <p className="support-notice support-notice--error" role="alert">{send.error.message}</p>}
        </div>
        <QuickActions aiEnabled={aiEnabled} onReport={() => setView('report')} onTopics={() => setView('topics')} onPrompt={prompt} />
        <form className="support-input" onSubmit={submit}>
          <textarea aria-label="Mensagem para o assistente" placeholder={aiEnabled ? 'Escreva sua dúvida...' : 'Chat com IA desativado'} disabled={!aiEnabled || send.isPending}
            maxLength={1000} rows={1} value={text} onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
          <button className="button button--primary button--icon" aria-label="Enviar" disabled={!aiEnabled || send.isPending || !text.trim()}><Send size={16} /></button>
        </form>
      </>}
  </aside>;
}
```

- [ ] **Step 7: `SupportWidget.tsx`**

```tsx
import { useCallback, useState } from 'react';
import { LifeBuoy, X } from 'lucide-react';
import { SupportPanel } from './SupportPanel';
import './support.css';

export function SupportWidget({ companyId }: { companyId: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return <>
    {open && <SupportPanel key={companyId} companyId={companyId} onClose={close} />}
    <button type="button" className="support-fab" aria-label={open ? 'Fechar ajuda' : 'Abrir ajuda'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {open ? <X size={22} /> : <LifeBuoy size={22} />}
    </button>
  </>;
}
```

O `key={companyId}` remonta o painel ao trocar de empresa, então a conversa e as telas internas nunca se misturam entre empresas.

- [ ] **Step 8: `support.css`**

```css
.support-fab{position:fixed;right:24px;bottom:24px;z-index:60;width:52px;height:52px;border-radius:50%;border:0;display:grid;place-items:center;background:var(--primary);color:#fff;box-shadow:0 8px 24px #092a3833;cursor:pointer}
.support-fab:hover{background:var(--primary-dark)}
.support-panel{position:fixed;right:24px;bottom:88px;z-index:60;width:380px;max-width:calc(100vw - 32px);height:min(600px,calc(100vh - 120px));display:flex;flex-direction:column;background:var(--surface,#fff);border:1px solid var(--border);border-radius:10px;box-shadow:0 16px 40px #092a3829;overflow:hidden;color:var(--text)}
.support-panel__header{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}
.support-panel__header strong{display:block;font-family:var(--display-font);font-size:15px}
.support-panel__header span{font-size:12px;color:var(--muted)}
.support-panel__header>div:last-child{display:flex;gap:2px}
.support-body{flex:1;overflow-y:auto;padding:14px}
.support-messages{display:flex;flex-direction:column;gap:10px}
.support-message{max-width:88%;padding:9px 12px;border-radius:10px;font-size:13px;line-height:1.45;display:flex;flex-direction:column;gap:8px}
.support-message--user{align-self:flex-end;background:var(--primary);color:#fff;border-bottom-right-radius:3px}
.support-message--assistant{align-self:flex-start;background:var(--workspace-bg,#f3f6f8);border-bottom-left-radius:3px}
.support-text p,.support-text ul,.support-text ol{margin:0 0 6px}
.support-text p:last-child,.support-text ul:last-child,.support-text ol:last-child{margin-bottom:0}
.support-text ul,.support-text ol{padding-left:18px}
.support-text h4{margin:8px 0 4px;font-size:13px}
.support-empty,.support-muted{color:var(--muted);font-size:13px;margin:0}
.support-notice{margin:0;font-size:12.5px;padding:7px 9px;border-radius:6px}
.support-notice--error{background:#fdecea;color:var(--danger,#c8423c)}
.support-notice--info{background:#eef5f8;color:#35434d}
.support-link{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;border:1px solid var(--border);background:#fff;color:var(--primary);border-radius:6px;padding:6px 10px;font-size:12.5px;font-weight:650;cursor:pointer;text-align:left}
.support-link:hover:not(:disabled){border-color:var(--primary)}
.support-action{background:#fff;border:1px solid var(--border);border-radius:8px;padding:10px;display:flex;flex-direction:column;gap:8px}
.support-action header{display:flex;justify-content:space-between;gap:8px;font-size:12.5px}
.support-action header span{color:var(--muted)}
.support-action--confirmed header span{color:var(--success,#1f8a4c)}
.support-action--failed header span{color:var(--danger,#c8423c)}
.support-action dl{margin:0;display:grid;gap:4px}
.support-action dl div{display:grid;grid-template-columns:110px 1fr;gap:6px;font-size:12.5px}
.support-action dt{color:var(--muted)}
.support-action dd{margin:0;word-break:break-word}
.support-action__buttons{display:flex;justify-content:flex-end;gap:8px}
.support-typing{flex-direction:row;gap:4px;padding:12px}
.support-typing span{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:support-dot 1s infinite ease-in-out}
.support-typing span:nth-child(2){animation-delay:.15s}
.support-typing span:nth-child(3){animation-delay:.3s}
@keyframes support-dot{0%,80%,100%{opacity:.3}40%{opacity:1}}
.support-quick{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px;border-top:1px solid var(--border)}
.support-chip{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--border);background:#fff;border-radius:999px;padding:5px 10px;font-size:12px;color:#35434d;cursor:pointer}
.support-chip:hover{border-color:var(--primary);color:var(--primary)}
.support-input{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--border)}
.support-input textarea{flex:1;resize:none;border:1px solid var(--border);border-radius:6px;padding:9px 10px;font:inherit;font-size:13px;max-height:120px}
.support-form,.support-help{display:flex;flex-direction:column;gap:10px;font-size:13px}
.support-form h3,.support-help h3{margin:0;font-size:15px}
.support-form label{display:flex;flex-direction:column;gap:4px;font-weight:600}
.support-form select,.support-form input{border:1px solid var(--border);border-radius:6px;padding:8px;font:inherit;font-weight:400}
.support-form__dates{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.support-help ul{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:6px}
.support-back{display:inline-flex;align-items:center;gap:4px;align-self:flex-start;border:0;background:none;color:var(--muted);font-size:12px;cursor:pointer;padding:0}
@media (max-width:640px){
  .support-fab{right:16px;bottom:16px}
  .support-panel{inset:0;width:auto;max-width:none;height:auto;border-radius:0;border:0}
}
```

- [ ] **Step 9: Montar no `WorkspaceLayout.tsx`**

Importar `import { SupportWidget } from '../features/support/SupportWidget';` e, logo depois de `{children}` (linha ~284):

```tsx
      {!onboarding && companyId && <SupportWidget companyId={companyId} />}
```

- [ ] **Step 10: Typecheck e conferência visual**

Run: `cd frontend && npx tsc -b`
Expected: sem erros. Se algum ícone (`LifeBuoy`, `UserPlus`, `FileDown`, `BookOpen`, `RotateCcw`) não existir no `lucide-react` 1.52, procure o nome atual em `node_modules/lucide-react/dist/lucide-react.d.ts` e troque.

Suba frontend e backend (`npm run dev` em cada pasta), entre no sistema e confira: o botão aparece no canto inferior direito; o painel abre e fecha (Esc também fecha); os atalhos de PDF e "Como fazer..." funcionam sem IA; no celular (DevTools, 390px), o painel ocupa a tela inteira.

- [ ] **Step 11: Commit**

```bash
git add frontend/src/features/support frontend/src/components/WorkspaceLayout.tsx
git commit -m "Feat: widget do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Teste Playwright do widget

**Files:**
- Create: `frontend/playwright.support.config.ts`
- Create: `frontend/tests/support-widget.spec.ts`

- [ ] **Step 1: Config**

`frontend/playwright.support.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'support-widget.spec.ts', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5174', viewport: { width: 1440, height: 1000 }, browserName: 'chromium' },
  reporter: 'list',
  webServer: { command: 'npx vite --host 127.0.0.1 --port 5174', url: 'http://127.0.0.1:5174', reuseExistingServer: true, timeout: 30000 },
});
```

- [ ] **Step 2: Spec**

`frontend/tests/support-widget.spec.ts`:

```ts
import { expect, test, type Page } from '@playwright/test';

const companyId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actionId = '33333333-3333-4333-8333-333333333333';
const cors = { 'access-control-allow-origin': 'http://127.0.0.1:5174', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'Content-Type, X-Company-Id, Idempotency-Key', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
type Message = { id: string; role: 'user' | 'assistant'; createdAt: string; blocks: Array<Record<string, unknown>> };

async function setup(page: Page, aiEnabled = true) {
  const state = { messages: [] as Message[], sent: [] as string[], confirmed: 0, pdf: [] as string[] };
  await page.addInitScript((id) => sessionStorage.setItem('gestaonf.companyId', id), companyId);
  await page.route('**:4030/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    const send = (body: unknown, status = 200) => route.fulfill({ status, json: body, headers: cors });
    if (req.method() === 'OPTIONS') return send({});
    if (url.pathname === '/auth/me') return send({ id: userId, name: 'Pedro', email: 'pedro@example.test', avatarId: null, profileVersion: 1 });
    if (url.pathname === '/companies') return send([{ id: companyId, name: 'GestãoNF', role: 'OWNER', accountId: 'acc' }]);
    if (url.pathname === '/support/conversation') return send({ conversation: state.messages.length ? { id: 'c1', messages: state.messages } : null, aiEnabled });
    if (url.pathname === '/support/conversation/messages') {
      const { text } = req.postDataJSON() as { text: string };
      state.sent.push(text);
      const now = new Date().toISOString();
      const created: Message[] = [
        { id: 'u1', role: 'user', createdAt: now, blocks: [{ type: 'text', text }] },
        { id: 'a1', role: 'assistant', createdAt: now, blocks: [
          { type: 'text', text: 'Confira os dados e confirme no cartão.' },
          { type: 'action', actionId, kind: 'CREATE_CUSTOMER', status: 'PENDING', summary: [{ label: 'Tipo', value: 'Pessoa física' }, { label: 'Nome', value: 'Maria Souza' }], expiresAt: new Date(Date.now() + 900000).toISOString() },
        ] },
      ];
      state.messages.push(...created);
      return send({ messages: created });
    }
    if (url.pathname === `/support/actions/${actionId}/confirm`) {
      state.confirmed += 1;
      const block = { ...state.messages[1].blocks[1], status: 'CONFIRMED', resultTo: '/Clientes' };
      state.messages[1].blocks[1] = block;
      return send({ block });
    }
    if (url.pathname === '/support/help') return send([{ id: 'emitir-nfse', titulo: 'Como emitir uma NFS-e' }]);
    if (url.pathname === '/support/help/emitir-nfse') return send({ id: 'emitir-nfse', titulo: 'Como emitir uma NFS-e', to: '/portal-de-servicos', conteudo: '## Passo a passo\n1. Abra o pedido confirmado.\n2. Clique em **Emitir NFS-e**.' });
    if (url.pathname === '/reports/customers/pdf') { state.pdf.push(url.search); return route.fulfill({ status: 200, body: '%PDF-1.4 teste', headers: { ...cors, 'content-type': 'application/pdf' } }); }
    return send({});
  });
  await page.goto('/relatorios');
  await page.getByRole('button', { name: 'Abrir ajuda' }).click();
  return state;
}

test('cadastra cliente pelo chat somente após confirmar o cartão', async ({ page }) => {
  const state = await setup(page);
  const panel = page.getByRole('dialog', { name: 'Ajuda do GestãoNF' });
  await panel.getByLabel('Mensagem para o assistente').fill('Cadastre a cliente Maria Souza, pessoa física');
  await panel.getByLabel('Mensagem para o assistente').press('Enter');
  const card = panel.getByRole('region', { name: 'Novo cliente' });
  await expect(card.getByText('Maria Souza')).toBeVisible();
  await expect(card.getByText('Aguardando sua confirmação')).toBeVisible();
  expect(state.confirmed).toBe(0);
  await card.getByRole('button', { name: 'Confirmar' }).click();
  await expect(card.getByText('Cadastro concluído')).toBeVisible();
  expect(state.confirmed).toBe(1);
  expect(state.sent).toEqual(['Cadastre a cliente Maria Souza, pessoa física']);
});

test('baixa PDF pelo atalho sem chamar a IA', async ({ page }) => {
  const state = await setup(page);
  const panel = page.getByRole('dialog', { name: 'Ajuda do GestãoNF' });
  await panel.getByRole('button', { name: 'Gerar relatório em PDF' }).click();
  await panel.getByLabel('Tipo de relatório').selectOption({ label: 'Clientes' });
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: 'Baixar PDF' }).click();
  expect((await download).suggestedFilename()).toMatch(/^customers.*\.pdf$/);
  expect(state.pdf).toHaveLength(1);
  expect(state.sent).toHaveLength(0);
});

test('com IA desativada mostra só atalhos e abre artigo de ajuda', async ({ page }) => {
  await setup(page, false);
  const panel = page.getByRole('dialog', { name: 'Ajuda do GestãoNF' });
  await expect(panel.getByLabel('Mensagem para o assistente')).toBeDisabled();
  await panel.getByRole('button', { name: 'Como fazer...' }).click();
  await panel.getByRole('button', { name: 'Como emitir uma NFS-e' }).click();
  await expect(panel.getByRole('heading', { name: 'Como emitir uma NFS-e' })).toBeVisible();
  await expect(panel.locator('strong', { hasText: 'Emitir NFS-e' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Ir para a tela' })).toBeVisible();
});
```

`<section aria-label>` tem papel `region` no Playwright. Se a página `/relatorios` chamar outro endpoint que quebre com `{}`, acrescente o mock certo seguindo o padrão de `frontend/tests/agenda-page.spec.ts` (ex.: `/companies/current` com `timezone`). Se o botão "Abrir ajuda" não aparecer, verifique se o layout entrou em modo `onboarding` (o widget fica oculto nesse modo) e faça o mock dos dados da empresa que o `SessionGate` (`frontend/src/main.tsx`) usa para decidir isso.

- [ ] **Step 3: Rodar**

Run: `cd frontend && npx playwright test -c playwright.support.config.ts`
Expected: 3 passed.

- [ ] **Step 4: Limpar artefatos e commit**

Run: `cd frontend && rm -rf test-results playwright-report` (os arquivos de teste ficam).

```bash
git add frontend/playwright.support.config.ts frontend/tests/support-widget.spec.ts
git commit -m "Test: widget do assistente de suporte

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Verificação final e fechamento do spec

**Files:**
- Modify: `docs/superpowers/specs/2026-11-10-assistente-suporte-design.md` (linha de estado)

- [ ] **Step 1: Suítes completas**

Run: `cd backend && npm run typecheck && npx vitest run`
Expected: todos os testes PASS, incluindo os já existentes (`users.test.ts`, `nero-company-links.test.ts`...). Uma falha em teste antigo **causada por esta feature** deve ser corrigida. Falhas pré-existentes devem ser relatadas com a saída, sem mascarar.

Run: `cd frontend && npx tsc -b && npx playwright test -c playwright.support.config.ts`
Expected: sem erros; 3 passed. Depois: `rm -rf test-results playwright-report`.

- [ ] **Step 2: Fluxo real com a billing zerada**

1. No `.env` da raiz, colocar `SUPPORT_AI_ENABLED=true` (a `OPENAI_API_KEY` atual basta).
2. `cd backend && npm run support:check`: esperado `AI_QUOTA`.
3. Subir backend e frontend, abrir o widget e enviar "oi". Esperado: o aviso "O assistente está indisponível no momento..." no chat; no log da API, `support_llm_error code=AI_QUOTA status=429`.
4. Conferir no banco: `SELECT role, error_code FROM support_messages ORDER BY seq DESC LIMIT 2;` deve mostrar `assistant | AI_QUOTA` e `user | null`.
5. Baixar um PDF pelo atalho e pelo botão "Exportar PDF" da tela de Relatórios: abrir o arquivo e conferir cabeçalho, indicadores, tabela e rodapé com a paginação.

- [ ] **Step 3: Atualizar o estado do spec**

Em `docs/superpowers/specs/2026-11-10-assistente-suporte-design.md`, trocar a linha de estado por:

```md
Data: 10/11/2026. Estado: **implementado**. Plano: [../plans/2026-11-10-assistente-suporte.md](../plans/2026-11-10-assistente-suporte.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-10-assistente-suporte-design.md
git commit -m "Docs: assistente de suporte implementado

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
