# Nero — Fase 1: Áudio — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).
>
> **Regras do projeto para todas as tarefas:**
> - **Nunca fazer `git commit`, `git add` ou `git rm`.** Tudo fica no working tree.
> - **Testes temporários** (`ArquivosMD/procedimento-padrao-testes.md`): os arquivos de teste criados aqui são apagados na Task 7. O teste permanente `backend/tests/nero-company-links.test.ts` só recebe o ajuste do construtor.
> - Português do Brasil em textos e comentários.
> - **Comando de teste** (quirk de ambiente do Windows — use exatamente este `cd`):
>   `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && npm exec -w backend -- vitest run tests/<arquivo>.test.ts`
>   O "No test files found" do workspace `backend/database` é ruído e não indica falha.

**Goal:** O Nero entende mensagens de voz: baixa o áudio da Meta com segurança, transcreve com a OpenAI e trata a transcrição como fala do usuário (rajada, memória, propostas, "sim" falado), com limites de duração, tamanho e minutos por 24 h.

**Architecture:** A transcrição acontece no mesmo job de entrada, sob o lock do remetente. `MetaMediaClient` baixa os bytes (hosts da Meta, redirecionamento revalidado, limite de tamanho, `sha256`). `AudioTranscriptionService` valida formato, duração (lida do OGG/Opus) e cota, chama o `NeroTranscriber` (OpenAI, bytes em memória, sem ffmpeg nem arquivo temporário) e grava o texto no próprio `whatsapp_inbox_events`. O `NiloService` inclui áudios na rajada e marca a fala como `source=AUDIO`; o orquestrador sinaliza ao modelo que é voz transcrita. Spec: `docs/superpowers/specs/2026-11-10-nero-agente-secretario-design.md`, seção 9.

**Tech Stack:** NestJS 12, Drizzle 0.45 + PostgreSQL 17, `openai` 7 (`audio.transcriptions`, `toFile`, `audio.speech` só na avaliação), Vitest 5.

---

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
| --- | --- | --- |
| `backend/vitest.config.ts` | Criar (permanente) | `hookTimeout` de 60 s (os `afterAll` com `DROP DATABASE` estouravam 10 s com a suíte em paralelo) |
| `backend/tests/nero-fixture.ts` | Criar (temporário) | Banco temporário, operador, inbound, modelo roteirizado, fakes de mídia e transcrição |
| `backend/database/src/schema.ts` | Modificar | Colunas de transcrição em `whatsapp_inbox_events` |
| `backend/database/drizzle/0038_nero_audio.sql` | Gerar | Migration |
| `backend/src/assistant/audio/audio-format.ts` | Criar | Formatos aceitos e estimativa de duração |
| `backend/src/assistant/audio/ogg-duration.ts` | Criar | Duração exata de OGG/Opus |
| `backend/src/whatsapp/meta-media.client.ts` | Criar | Download seguro de mídia da Meta |
| `backend/src/whatsapp/whatsapp.module.ts` | Modificar | Prover/exportar `MetaMediaClient` |
| `backend/src/assistant/audio/transcriber.ts` | Criar | `NeroTranscriber` + `OpenAITranscriber` |
| `backend/src/assistant/audio/audio-transcription.service.ts` | Criar | Limites, cota, transcrição e persistência no evento |
| `backend/src/assistant/nilo.service.ts` | Modificar | Áudio na rajada e respostas de recusa |
| `backend/src/assistant/agent-orchestrator.service.ts` | Modificar | Marca fala de voz no histórico |
| `backend/src/assistant/prompt.ts` | Modificar | Aviso sobre transcrição; nova versão |
| `backend/src/assistant/assistant.module.ts` | Modificar | Providers de áudio |
| `backend/tests/nero-company-links.test.ts` | Modificar (permanente) | Novo parâmetro do construtor |
| `.env.example`, `compose.yaml` | Modificar | Variáveis de áudio |

---

### Task 1: Configuração do Vitest e fixture temporária

**Files:** Create `backend/vitest.config.ts`, `backend/tests/nero-fixture.ts`, `backend/tests/nero-fixture.test.ts`

- [ ] **Step 1: Configuração permanente do Vitest**

```ts
// backend/vitest.config.ts
import { defineConfig } from 'vitest/config';

// Os testes de integração criam e apagam bancos temporários; com a suíte em paralelo o DROP DATABASE passa de 10 s.
export default defineConfig({ test: { hookTimeout: 60_000 } });
```

- [ ] **Step 2: Teste de fumaça da fixture**

```ts
// backend/tests/nero-fixture.test.ts — TEMPORÁRIO (apagar na Task 7)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { audioPayload, createNeroTestEnv, insertInbound, seedOperator, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

describe('fixture da Fase 1', () => {
  it('cria operador vinculado e evento de áudio', async () => {
    const operator = await seedOperator(env, ['Empresa Áudio']);
    const event = await insertInbound(env, operator.senderId, null, { messageType: 'audio', payload: audioPayload('123456') });
    expect(event.messageType).toBe('audio');
    expect((await env.links.eligibleCompanies(operator.linkId, operator.userId))).toHaveLength(1);
  });
});
```

- [ ] **Step 3: Rodar e ver falhar** — Expected: FAIL (módulo inexistente).

- [ ] **Step 4: Criar a fixture**

```ts
// backend/tests/nero-fixture.ts — TEMPORÁRIO (apagar na Task 7)
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
import type { ModelRequest, ModelResponse, NeroModel } from '../src/assistant/model/nero-model.js';
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

/** Payload de nota de voz no formato do webhook da Meta. */
export const audioPayload = (mediaId: string, mimeType = 'audio/ogg; codecs=opus', sha256: string | null = null) =>
  ({ type: 'audio', audio: { id: mediaId, mime_type: mimeType, voice: true, ...(sha256 ? { sha256 } : {}) } });

/** OGG/Opus mínimo: o leitor de duração só precisa do OpusHead (pre-skip) e do granule da última página. */
export function fakeOgg(seconds: number, preSkip = 312) {
  const page = (granule: bigint, payload: Buffer) => {
    const header = Buffer.alloc(27); header.write('OggS', 0, 'latin1'); header.writeBigInt64LE(granule, 6);
    return Buffer.concat([header, payload]);
  };
  const head = Buffer.alloc(19); head.write('OpusHead', 0, 'latin1'); head.writeUInt8(1, 8); head.writeUInt8(1, 9); head.writeUInt16LE(preSkip, 10);
  return Buffer.concat([page(0n, head), page(BigInt(Math.round(seconds * 48_000) + preSkip), Buffer.alloc(64))]);
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
```

- [ ] **Step 5: Rodar e ver passar** — `tests/nero-fixture.test.ts` PASS. Sem commit.

---

### Task 2: Colunas de transcrição no evento de entrada

**Files:** Modify `backend/database/src/schema.ts`; Generate `backend/database/drizzle/0038_nero_audio.sql`

- [ ] **Step 1:** Em `whatsappInboxEvents`, acrescentar as colunas:

```ts
    transcriptionStatus: varchar('transcription_status', { length: 16 }),
    mediaSeconds: integer('media_seconds'),
    transcribedAt: timestamp('transcribed_at', { withTimezone: true }),
```

e, no bloco de constraints/índices da mesma tabela (criar o callback se ainda não existir, mantendo os existentes):

```ts
    index('whatsapp_inbox_events_sender_transcribed_idx').on(table.connectionId, table.senderId, table.transcribedAt),
    check('whatsapp_inbox_events_transcription_chk', sql`${table.transcriptionStatus} IS NULL OR ${table.transcriptionStatus} IN ('DONE', 'REJECTED', 'FAILED')`),
    check('whatsapp_inbox_events_media_seconds_chk', sql`${table.mediaSeconds} IS NULL OR ${table.mediaSeconds} >= 0`),
```

- [ ] **Step 2:** Em `backend/database`: `npm run db:generate -- --name nero_audio` (se travar, `npx drizzle-kit generate --name nero_audio`). Conferir: só `ADD COLUMN`, `CREATE INDEX` e `ADD CONSTRAINT`. `npm run db:check`, `npm run db:migrate`.

- [ ] **Step 3:** `npm run backend:typecheck`; rodar `tests/nero-fixture.test.ts` (aplica a 0038 no banco temporário). Sem commit.

---

### Task 3: Formatos de áudio e duração do OGG/Opus

**Files:** Create `backend/src/assistant/audio/audio-format.ts`, `backend/src/assistant/audio/ogg-duration.ts`; Test `backend/tests/nero-audio-format.test.ts`

- [ ] **Step 1: Testes**

```ts
// backend/tests/nero-audio-format.test.ts — TEMPORÁRIO (apagar na Task 7)
import { describe, expect, it } from 'vitest';
import { audioFormat, estimateSeconds } from '../src/assistant/audio/audio-format.js';
import { oggOpusDurationSeconds } from '../src/assistant/audio/ogg-duration.js';
import { fakeOgg } from './nero-fixture.js';

describe('formatos de áudio', () => {
  it('aceita a nota de voz do WhatsApp e formatos da OpenAI; recusa amr/aac', () => {
    expect(audioFormat('audio/ogg; codecs=opus')).toMatchObject({ mime: 'audio/ogg', extension: 'ogg' });
    expect(audioFormat('audio/mpeg')?.extension).toBe('mp3');
    expect(audioFormat('audio/mp4')?.extension).toBe('m4a');
    expect(audioFormat('AUDIO/WAV')?.extension).toBe('wav');
    expect(audioFormat('audio/amr')).toBeNull();
    expect(audioFormat('audio/aac')).toBeNull();
    expect(audioFormat(null)).toBeNull();
  });
  it('estima a duração pelo tamanho, arredondando para cima', () => {
    expect(estimateSeconds(audioFormat('audio/mpeg')!, 16_001)).toBe(2);
  });
});

describe('duração do OGG/Opus', () => {
  it('lê o granule da última página menos o pre-skip', () => {
    expect(oggOpusDurationSeconds(fakeOgg(7))).toBeCloseTo(7, 3);
    expect(oggOpusDurationSeconds(fakeOgg(301.5))).toBeCloseTo(301.5, 3);
  });
  it('devolve null para conteúdo que não é OGG/Opus', () => {
    expect(oggOpusDurationSeconds(Buffer.from('não é áudio'))).toBeNull();
    expect(oggOpusDurationSeconds(Buffer.alloc(0))).toBeNull();
  });
});
```

- [ ] **Step 2:** Rodar e ver falhar.

- [ ] **Step 3: `audio-format.ts`**

```ts
// backend/src/assistant/audio/audio-format.ts
/** Formatos aceitos pela transcrição da OpenAI (flac, mp3, mp4, mpeg, mpga, m4a, ogg, wav, webm). */
type FormatInfo = { extension: string; bytesPerSecond: number };

// bytesPerSecond é conservador (taxa baixa) para não subestimar a duração quando não há como lê-la.
const FORMATS: Record<string, FormatInfo> = {
  'audio/ogg': { extension: 'ogg', bytesPerSecond: 2_000 },
  'audio/opus': { extension: 'ogg', bytesPerSecond: 2_000 },
  'audio/webm': { extension: 'webm', bytesPerSecond: 2_000 },
  'audio/mpeg': { extension: 'mp3', bytesPerSecond: 8_000 },
  'audio/mp3': { extension: 'mp3', bytesPerSecond: 8_000 },
  'audio/mp4': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/m4a': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/x-m4a': { extension: 'm4a', bytesPerSecond: 8_000 },
  'audio/wav': { extension: 'wav', bytesPerSecond: 16_000 },
  'audio/x-wav': { extension: 'wav', bytesPerSecond: 16_000 },
  'audio/flac': { extension: 'flac', bytesPerSecond: 16_000 },
};

export type AudioFormat = FormatInfo & { mime: string };

export function audioFormat(mimeType: string | null | undefined): AudioFormat | null {
  const mime = (mimeType ?? '').split(';')[0].trim().toLowerCase();
  const info = FORMATS[mime];
  return info ? { mime, ...info } : null;
}

export function estimateSeconds(format: AudioFormat, bytes: number) {
  return Math.ceil(bytes / format.bytesPerSecond);
}
```

- [ ] **Step 4: `ogg-duration.ts`**

```ts
// backend/src/assistant/audio/ogg-duration.ts
/**
 * Duração de um OGG/Opus em segundos: granule position da última página (sempre a 48 kHz no Opus)
 * menos o pre-skip do cabeçalho OpusHead. Devolve null se o conteúdo não for OGG/Opus legível.
 */
export function oggOpusDurationSeconds(bytes: Uint8Array): number | null {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buffer.length < 27 || buffer.toString('latin1', 0, 4) !== 'OggS') return null;
  const head = buffer.indexOf('OpusHead', 0, 'latin1');
  if (head < 0 || head + 12 > buffer.length) return null;
  const preSkip = buffer.readUInt16LE(head + 10);
  let page = buffer.lastIndexOf('OggS', buffer.length - 4, 'latin1');
  while (page >= 0) {
    if (page + 14 <= buffer.length) {
      const granule = buffer.readBigInt64LE(page + 6);
      if (granule >= 0n) return Math.max(0, Number(granule) - preSkip) / 48_000;
    }
    page = page > 0 ? buffer.lastIndexOf('OggS', page - 1, 'latin1') : -1;
  }
  return null;
}
```

- [ ] **Step 5:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 4: Download seguro de mídia da Meta

**Files:** Create `backend/src/whatsapp/meta-media.client.ts`; Modify `backend/src/whatsapp/whatsapp.module.ts`; Test `backend/tests/nero-media.test.ts`

- [ ] **Step 1: Testes** (com `fetch` simulado; nada sai para a rede)

```ts
// backend/tests/nero-media.test.ts — TEMPORÁRIO (apagar na Task 7)
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { MediaRejectedError, MetaMediaClient, isMetaMediaUrl } from '../src/whatsapp/meta-media.client.js';

const bytes = Buffer.from('conteudo-de-audio');
const sha = createHash('sha256').update(bytes).digest();
const info = (extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ url: 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1', mime_type: 'audio/ogg', file_size: bytes.length, ...extra }), { status: 200 });
const media = () => new Response(bytes, { status: 200 });

beforeEach(() => { vi.stubEnv('META_ACCESS_TOKEN', 'token-teste'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('MetaMediaClient', () => {
  it('baixa da URL da Meta com o token e confere o sha256 (base64 do webhook)', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce(media());
    vi.stubGlobal('fetch', fetchMock);
    const result = await new MetaMediaClient().download('123', 'phone-1', { maxBytes: 1_000, sha256: sha.toString('base64') });
    expect(result.bytes.equals(bytes)).toBe(true);
    expect(fetchMock.mock.calls[0][0]).toContain('/123?phone_number_id=phone-1');
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token-teste');
    expect(fetchMock.mock.calls[1][1].redirect).toBe('manual');
  });

  it('recusa arquivo grande antes de baixar', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(info({ file_size: 5_000 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(new MetaMediaClient().download('123', 'p', { maxBytes: 1_000 })).rejects.toMatchObject({ reason: 'TOO_LARGE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('recusa host fora da Meta, inclusive em redirecionamento', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(info({ url: 'https://evil.example.com/a' })));
    await expect(new MetaMediaClient().download('123', 'p', { maxBytes: 1_000 })).rejects.toBeInstanceOf(MediaRejectedError);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } })));
    await expect(new MetaMediaClient().download('123', 'p', { maxBytes: 1_000 })).rejects.toMatchObject({ reason: 'INVALID' });
  });

  it('recusa conteúdo com sha256 diferente e id de mídia inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(info()).mockResolvedValueOnce(media()));
    await expect(new MetaMediaClient().download('123', 'p', { maxBytes: 1_000, sha256: 'outro' })).rejects.toMatchObject({ reason: 'INVALID' });
    await expect(new MetaMediaClient().download('../x', 'p', { maxBytes: 1_000 })).rejects.toMatchObject({ reason: 'INVALID' });
  });

  it('valida hosts da Meta', () => {
    expect(isMetaMediaUrl('https://lookaside.fbsbx.com/x')).toBe(true);
    expect(isMetaMediaUrl('https://scontent.whatsapp.net/x')).toBe(true);
    expect(isMetaMediaUrl('http://lookaside.fbsbx.com/x')).toBe(false);
    expect(isMetaMediaUrl('https://fbsbx.com.evil.io/x')).toBe(false);
  });
});
```

- [ ] **Step 2:** Rodar e ver falhar.

- [ ] **Step 3: `meta-media.client.ts`**

```ts
// backend/src/whatsapp/meta-media.client.ts
import { BadGatewayException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

const META_MEDIA_HOSTS = ['fbsbx.com', 'facebook.com', 'whatsapp.net', 'fbcdn.net'];
const MAX_REDIRECTS = 3;

export class MediaRejectedError extends Error {
  constructor(readonly reason: 'TOO_LARGE' | 'INVALID') { super(reason === 'TOO_LARGE' ? 'Mídia acima do limite' : 'Mídia inválida ou fora da Meta'); }
}

/** Só HTTPS e domínios da Meta (o próprio domínio ou subdomínios dele). */
export function isMetaMediaUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && META_MEDIA_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function sha256Matches(bytes: Buffer, expected: string) {
  const digest = createHash('sha256').update(bytes).digest();
  return expected === digest.toString('base64') || expected.toLowerCase() === digest.toString('hex');
}

@Injectable()
export class MetaMediaClient {
  /** Baixa uma mídia recebida pelo webhook. O token só é enviado a hosts da Meta, inclusive após redirecionamento. */
  async download(mediaId: string, phoneNumberId: string, options: { maxBytes: number; sha256?: string | null }) {
    const token = process.env.META_ACCESS_TOKEN;
    const version = process.env.META_GRAPH_API_VERSION ?? 'v26.0';
    if (!token) throw new BadGatewayException('META_ACCESS_TOKEN não configurado');
    if (!/^\d+$/.test(mediaId)) throw new MediaRejectedError('INVALID');
    const authorization = { Authorization: `Bearer ${token}` };
    const infoResponse = await fetch(`https://graph.facebook.com/${version}/${mediaId}?phone_number_id=${encodeURIComponent(phoneNumberId)}`, { headers: authorization, signal: AbortSignal.timeout(15_000) });
    const info = await infoResponse.json().catch(() => null) as { url?: string; mime_type?: string; file_size?: number; sha256?: string } | null;
    if (!infoResponse.ok || !info?.url) throw new BadGatewayException(`Meta não informou a mídia (HTTP ${infoResponse.status})`);
    if (typeof info.file_size === 'number' && info.file_size > options.maxBytes) throw new MediaRejectedError('TOO_LARGE');

    let url = info.url;
    let response: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (!isMetaMediaUrl(url)) throw new MediaRejectedError('INVALID');
      response = await fetch(url, { headers: authorization, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
      const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
      if (!location) break;
      url = new URL(location, url).toString();
      response = null;
    }
    if (!response || !response.ok || !response.body) throw new BadGatewayException('Falha ao baixar a mídia da Meta');
    if (Number(response.headers.get('content-length') ?? '0') > options.maxBytes) throw new MediaRejectedError('TOO_LARGE');

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > options.maxBytes) throw new MediaRejectedError('TOO_LARGE');
      chunks.push(Buffer.from(chunk));
    }
    const bytes = Buffer.concat(chunks);
    const expected = options.sha256 ?? info.sha256 ?? null;
    if (expected && !sha256Matches(bytes, expected)) throw new MediaRejectedError('INVALID');
    return { bytes, mimeType: info.mime_type ?? null };
  }
}
```

- [ ] **Step 4:** Em `whatsapp.module.ts`, acrescentar `MetaMediaClient` a `providers` e `exports`.

- [ ] **Step 5:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 5: Transcrição com limites e cota

**Files:** Create `backend/src/assistant/audio/transcriber.ts`, `backend/src/assistant/audio/audio-transcription.service.ts`; Test `backend/tests/nero-transcription.test.ts`

- [ ] **Step 1: Testes**

```ts
// backend/tests/nero-transcription.test.ts — TEMPORÁRIO (apagar na Task 7)
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { AudioTranscriptionService } from '../src/assistant/audio/audio-transcription.service.js';
import type { NeroTranscriber } from '../src/assistant/audio/transcriber.js';
import { MediaRejectedError, type MetaMediaClient } from '../src/whatsapp/meta-media.client.js';
import { audioPayload, createNeroTestEnv, fakeOgg, insertInbound, seedOperator, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

function build(download: () => Promise<{ bytes: Buffer; mimeType: string | null }>, text = 'Fiz uma venda de um site pro Roberto') {
  const media = { download: vi.fn(download) } as unknown as MetaMediaClient;
  const transcriber: NeroTranscriber = { name: 'fake', transcribe: vi.fn(async () => text) };
  return { service: new AudioTranscriptionService(env.database, media, transcriber), media, transcriber };
}

async function audioEvent(mime?: string) {
  const operator = await seedOperator(env, ['Áudio Ltda']);
  return insertInbound(env, operator.senderId, null, { messageType: 'audio', payload: audioPayload('987', mime) });
}

describe('AudioTranscriptionService', () => {
  it('transcreve e grava texto, duração e status no próprio evento', async () => {
    const { service } = build(async () => ({ bytes: fakeOgg(12), mimeType: 'audio/ogg' }));
    const event = await audioEvent();
    expect(await service.transcribe(event)).toEqual({ ok: true, text: 'Fiz uma venda de um site pro Roberto' });
    const [saved] = await env.db.select().from(schema.whatsappInboxEvents).where(eq(schema.whatsappInboxEvents.id, event.id));
    expect(saved).toMatchObject({ messageText: 'Fiz uma venda de um site pro Roberto', transcriptionStatus: 'DONE', mediaSeconds: 12 });
  });

  it('evento já transcrito não baixa de novo', async () => {
    const { service, media } = build(async () => ({ bytes: fakeOgg(3), mimeType: 'audio/ogg' }));
    const event = await audioEvent();
    await service.transcribe(event);
    const [saved] = await env.db.select().from(schema.whatsappInboxEvents).where(eq(schema.whatsappInboxEvents.id, event.id));
    await service.transcribe(saved);
    expect(media.download).toHaveBeenCalledTimes(1);
  });

  it('recusa formato não suportado sem baixar', async () => {
    const { service, media } = build(async () => ({ bytes: Buffer.alloc(1), mimeType: 'audio/amr' }));
    expect(await service.transcribe(await audioEvent('audio/amr'))).toEqual({ ok: false, reason: 'UNSUPPORTED' });
    expect(media.download).not.toHaveBeenCalled();
  });

  it('recusa áudio acima de 5 minutos sem transcrever', async () => {
    const { service, transcriber } = build(async () => ({ bytes: fakeOgg(301), mimeType: 'audio/ogg' }));
    expect(await service.transcribe(await audioEvent())).toEqual({ ok: false, reason: 'TOO_LONG' });
    expect(transcriber.transcribe).not.toHaveBeenCalled();
  });

  it('arquivo grande recusado pela Meta vira TOO_LARGE; outra falha vira FAILED', async () => {
    expect(await build(async () => { throw new MediaRejectedError('TOO_LARGE'); }).service.transcribe(await audioEvent())).toEqual({ ok: false, reason: 'TOO_LARGE' });
    expect(await build(async () => { throw new Error('rede'); }).service.transcribe(await audioEvent())).toEqual({ ok: false, reason: 'FAILED' });
  });

  it('transcrição vazia vira EMPTY', async () => {
    const { service } = build(async () => ({ bytes: fakeOgg(2), mimeType: 'audio/ogg' }), ' ... ');
    expect(await service.transcribe(await audioEvent())).toEqual({ ok: false, reason: 'EMPTY' });
  });

  it('cota de minutos em 24 h por remetente', async () => {
    vi.stubEnv('NERO_AUDIO_DAILY_MINUTES', '1');
    const { service } = build(async () => ({ bytes: fakeOgg(40), mimeType: 'audio/ogg' }));
    const operator = await seedOperator(env, ['Cota']);
    const first = await insertInbound(env, operator.senderId, null, { messageType: 'audio', payload: audioPayload('1') });
    const second = await insertInbound(env, operator.senderId, null, { messageType: 'audio', payload: audioPayload('2') });
    expect((await service.transcribe(first)).ok).toBe(true);
    expect(await service.transcribe(second)).toEqual({ ok: false, reason: 'DAILY_LIMIT' });
    vi.stubEnv('NERO_AUDIO_DAILY_MINUTES', '30');
  });
});
```

- [ ] **Step 2:** Rodar e ver falhar.

- [ ] **Step 3: `transcriber.ts`**

```ts
// backend/src/assistant/audio/transcriber.ts
import OpenAI, { toFile } from 'openai';

export interface NeroTranscriber {
  readonly name: string;
  transcribe(input: { bytes: Buffer; extension: string; mimeType: string }): Promise<string>;
}

export const NERO_TRANSCRIBER = Symbol('NERO_TRANSCRIBER');

/** Transcrição pela OpenAI, com os bytes em memória (sem arquivo temporário). */
export class OpenAITranscriber implements NeroTranscriber {
  private client: OpenAI | null = null;
  get name() { return process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-transcribe'; }

  async transcribe(input: { bytes: Buffer; extension: string; mimeType: string }) {
    this.client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });
    const file = await toFile(input.bytes, `audio.${input.extension}`, { type: input.mimeType });
    const result = await this.client.audio.transcriptions.create({ file, model: this.name, language: 'pt' });
    return (result.text ?? '').trim();
  }
}
```

- [ ] **Step 4: `audio-transcription.service.ts`**

```ts
// backend/src/assistant/audio/audio-transcription.service.ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { whatsappConnections, whatsappInboxEvents } from '@gestaonf/database/schema';
import { and, eq, gte, sql } from 'drizzle-orm';
import { DatabaseService } from '../../database/database.module.js';
import { MediaRejectedError, MetaMediaClient } from '../../whatsapp/meta-media.client.js';
import { audioFormat, estimateSeconds } from './audio-format.js';
import { oggOpusDurationSeconds } from './ogg-duration.js';
import { NERO_TRANSCRIBER, type NeroTranscriber } from './transcriber.js';

type InboxEvent = typeof whatsappInboxEvents.$inferSelect;
export type AudioRejection = 'TOO_LONG' | 'TOO_LARGE' | 'DAILY_LIMIT' | 'UNSUPPORTED' | 'EMPTY' | 'FAILED';
export type TranscriptionOutcome = { ok: true; text: string } | { ok: false; reason: AudioRejection };

/** Respostas ao usuário para cada recusa, em linguagem simples. */
export const AUDIO_REPLIES: Record<AudioRejection, string> = {
  TOO_LONG: 'Seu áudio passou de 5 minutos. Pode mandar um mais curto ou escrever?',
  TOO_LARGE: 'Seu áudio é grande demais para eu ouvir. Pode mandar um mais curto ou escrever?',
  DAILY_LIMIT: 'Você atingiu o limite de áudios por hoje. Pode escrever sua mensagem?',
  UNSUPPORTED: 'Não consigo ouvir esse formato de áudio. Pode mandar uma mensagem de voz ou escrever?',
  EMPTY: 'Não consegui entender bem o áudio, pode repetir ou escrever?',
  FAILED: 'Não consegui ouvir seu áudio agora. Pode tentar de novo ou escrever?',
};

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

@Injectable()
export class AudioTranscriptionService {
  private readonly logger = new Logger(AudioTranscriptionService.name);

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(MetaMediaClient) private readonly media: MetaMediaClient,
    @Inject(NERO_TRANSCRIBER) private readonly transcriber: NeroTranscriber,
  ) {}

  /** Segundos de áudio já transcritos deste remetente nas últimas 24 horas. */
  private async usedSeconds(event: InboxEvent) {
    const [row] = await this.database.db.select({ total: sql<string>`coalesce(sum(${whatsappInboxEvents.mediaSeconds}), 0)` }).from(whatsappInboxEvents)
      .where(and(eq(whatsappInboxEvents.connectionId, event.connectionId), eq(whatsappInboxEvents.senderId, event.senderId), eq(whatsappInboxEvents.transcriptionStatus, 'DONE'), gte(whatsappInboxEvents.transcribedAt, new Date(Date.now() - 86_400_000))));
    return Number(row?.total ?? 0);
  }

  private async reject(event: InboxEvent, reason: AudioRejection, seconds: number | null = null): Promise<TranscriptionOutcome> {
    await this.database.db.update(whatsappInboxEvents).set({ transcriptionStatus: reason === 'FAILED' ? 'FAILED' : 'REJECTED', mediaSeconds: seconds, transcribedAt: new Date() })
      .where(eq(whatsappInboxEvents.id, event.id));
    return { ok: false, reason };
  }

  async transcribe(event: InboxEvent): Promise<TranscriptionOutcome> {
    if (event.transcriptionStatus === 'DONE' && event.messageText) return { ok: true, text: event.messageText };
    const audio = (event.payload as { audio?: { id?: unknown; mime_type?: unknown; sha256?: unknown } } | null)?.audio;
    if (!audio || typeof audio.id !== 'string') return this.reject(event, 'FAILED');
    const format = audioFormat(typeof audio.mime_type === 'string' ? audio.mime_type : null);
    if (!format) return this.reject(event, 'UNSUPPORTED');
    const dailyLimit = positiveNumber('NERO_AUDIO_DAILY_MINUTES', 30) * 60;
    const used = await this.usedSeconds(event);
    if (used >= dailyLimit) return this.reject(event, 'DAILY_LIMIT');

    const [connection] = await this.database.db.select({ phoneNumberId: whatsappConnections.phoneNumberId }).from(whatsappConnections).where(eq(whatsappConnections.id, event.connectionId)).limit(1);
    if (!connection) return this.reject(event, 'FAILED');
    let bytes: Buffer;
    try {
      ({ bytes } = await this.media.download(audio.id, connection.phoneNumberId, { maxBytes: positiveNumber('NERO_AUDIO_MAX_BYTES', 16 * 1024 * 1024), sha256: typeof audio.sha256 === 'string' ? audio.sha256 : null }));
    } catch (error) {
      if (error instanceof MediaRejectedError && error.reason === 'TOO_LARGE') return this.reject(event, 'TOO_LARGE');
      this.logger.warn({ event: 'nero_audio_download_failed', errorType: error instanceof Error ? error.name : 'Unknown' });
      return this.reject(event, 'FAILED');
    }

    const measured = format.extension === 'ogg' ? oggOpusDurationSeconds(bytes) : null;
    const seconds = Math.ceil(measured ?? estimateSeconds(format, bytes.length));
    if (seconds > positiveNumber('NERO_AUDIO_MAX_SECONDS', 300)) return this.reject(event, 'TOO_LONG', seconds);
    if (used + seconds > dailyLimit) return this.reject(event, 'DAILY_LIMIT', seconds);

    let text: string;
    try {
      text = await this.transcriber.transcribe({ bytes, extension: format.extension, mimeType: format.mime });
    } catch (error) {
      this.logger.warn({ event: 'nero_audio_transcription_failed', errorType: error instanceof Error ? error.name : 'Unknown' });
      return this.reject(event, 'FAILED', seconds);
    }
    if (!text.replace(/[\s.…,!?;:-]/g, '')) return this.reject(event, 'EMPTY', seconds);
    await this.database.db.update(whatsappInboxEvents).set({ messageText: text, transcriptionStatus: 'DONE', mediaSeconds: seconds, transcribedAt: new Date() })
      .where(eq(whatsappInboxEvents.id, event.id));
    return { ok: true, text };
  }
}
```

Observação: a cota conta só áudios transcritos com sucesso (`DONE`); recusas guardam a duração para diagnóstico, mas não consomem a cota.

- [ ] **Step 5:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 6: Áudio no fluxo do Nero

**Files:** Modify `backend/src/assistant/nilo.service.ts`, `agent-orchestrator.service.ts`, `prompt.ts`, `assistant.module.ts`, `backend/tests/nero-company-links.test.ts`; Test `backend/tests/nero-audio-flow.test.ts`

- [ ] **Step 1: Testes de fluxo**

```ts
// backend/tests/nero-audio-flow.test.ts — TEMPORÁRIO (apagar na Task 7)
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { ActionService } from '../src/assistant/actions/action.service.js';
import { AgentOrchestrator } from '../src/assistant/agent-orchestrator.service.js';
import { AudioTranscriptionService } from '../src/assistant/audio/audio-transcription.service.js';
import type { NeroTranscriber } from '../src/assistant/audio/transcriber.js';
import { ConversationService } from '../src/assistant/conversation.service.js';
import { NiloService } from '../src/assistant/nilo.service.js';
import { createToolRegistry } from '../src/assistant/tools/index.js';
import type { MetaMediaClient } from '../src/whatsapp/meta-media.client.js';
import { WhatsAppOutboundService } from '../src/whatsapp/whatsapp-outbound.service.js';
import { audioPayload, createNeroTestEnv, fakeOgg, insertInbound, say, ScriptedModel, seedOperator, seenText, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

function nero(model: ScriptedModel, transcripts: string[], seconds = 5) {
  const registry = createToolRegistry(env.database);
  const actions = new ActionService(env.database, registry);
  const media = { download: vi.fn(async () => ({ bytes: fakeOgg(seconds), mimeType: 'audio/ogg' })) } as unknown as MetaMediaClient;
  const transcriber: NeroTranscriber = { name: 'fake', transcribe: vi.fn(async () => transcripts.shift() ?? '') };
  const audio = new AudioTranscriptionService(env.database, media, transcriber);
  return {
    service: new NiloService(env.database, env.links, new WhatsAppOutboundService(env.database), new ConversationService(env.database), actions, new AgentOrchestrator(env.database, model, registry, actions), audio),
    media,
  };
}

const sent = (linkId: string) => env.db.select().from(schema.whatsappOutboundMessages).where(eq(schema.whatsappOutboundMessages.linkId, linkId)).orderBy(schema.whatsappOutboundMessages.createdAt);
const audioIn = (senderId: string, id = '555') => insertInbound(env, senderId, null, { messageType: 'audio', payload: audioPayload(id) });

describe('áudio no fluxo do Nero', () => {
  it('nota de voz vira fala do usuário marcada como voz e recebe resposta', async () => {
    const model = new ScriptedModel([say('Entendi a venda para o Roberto. Ele já está cadastrado?')]);
    const { service } = nero(model, ['Fiz uma venda de um site de cinco mil pro Roberto']);
    const operator = await seedOperator(env, ['Voz']);
    await service.processInboxEvent((await audioIn(operator.senderId)).id);
    expect(seenText(model.requests[0])).toContain('mensagem de voz transcrita');
    expect(seenText(model.requests[0])).toContain('pro Roberto');
    expect((await sent(operator.linkId))[0].body).toBe('Entendi a venda para o Roberto. Ele já está cadastrado?');
    const [history] = await env.db.select().from(schema.neroMessages).where(eq(schema.neroMessages.role, 'USER')).orderBy(schema.neroMessages.seq);
    expect(history.source).toBe('AUDIO');
  });

  it('áudio + texto em rajada formam um único turno', async () => {
    const model = new ScriptedModel([say('Certo.')]);
    const { service } = nero(model, ['Vendi um site pro Roberto']);
    const operator = await seedOperator(env, ['Rajada voz']);
    const voice = await audioIn(operator.senderId);
    const text = await insertInbound(env, operator.senderId, 'Lança pra mim');
    await service.processInboxEvent(voice.id);
    await service.processInboxEvent(text.id);
    expect(model.requests).toHaveLength(1);
    expect(seenText(model.requests[0])).toContain('Vendi um site pro Roberto');
    expect(seenText(model.requests[0])).toContain('Lança pra mim');
  });

  it('áudio longo recebe a recusa, sem chamar o modelo', async () => {
    const model = new ScriptedModel([]);
    const { service } = nero(model, ['nunca usado'], 400);
    const operator = await seedOperator(env, ['Longo']);
    await service.processInboxEvent((await audioIn(operator.senderId)).id);
    expect(model.requests).toHaveLength(0);
    expect((await sent(operator.linkId))[0].body).toBe('Seu áudio passou de 5 minutos. Pode mandar um mais curto ou escrever?');
  });

  it('transcrição vazia pede para repetir', async () => {
    const model = new ScriptedModel([]);
    const { service } = nero(model, ['   ']);
    const operator = await seedOperator(env, ['Vazio']);
    await service.processInboxEvent((await audioIn(operator.senderId)).id);
    expect((await sent(operator.linkId))[0].body).toBe('Não consegui entender bem o áudio, pode repetir ou escrever?');
  });

  it('remetente sem vínculo: áudio não é baixado', async () => {
    const { service, media } = nero(new ScriptedModel([]), ['x']);
    await service.processInboxEvent((await audioIn('5511999990000')).id);
    expect(media.download).not.toHaveBeenCalled();
  });

  it('Nero desligado: áudio não é baixado e recebe o aviso', async () => {
    const model = new ScriptedModel([]);
    model.enabled = () => false;
    const { service, media } = nero(model, ['x']);
    const operator = await seedOperator(env, ['Desligado voz']);
    await service.processInboxEvent((await audioIn(operator.senderId)).id);
    expect(media.download).not.toHaveBeenCalled();
    expect((await sent(operator.linkId))[0].body).toBe('O Nero está temporariamente indisponível. Tente novamente mais tarde ou use o GestãoNF.');
  });
});
```

- [ ] **Step 2:** Rodar e ver falhar (construtor do `NiloService` sem o parâmetro de áudio).

- [ ] **Step 3: `NiloService`** — alterações pontuais:

1. Importar `AudioTranscriptionService` e `AUDIO_REPLIES` de `./audio/audio-transcription.service.js` e acrescentar ao construtor como **último** parâmetro:

```ts
    @Inject(AudioTranscriptionService) private readonly audio: AudioTranscriptionService,
```

2. Em `collectBurst`, trocar `eq(whatsappInboxEvents.messageType, 'text')` por `inArray(whatsappInboxEvents.messageType, ['text', 'audio'])` e o filtro por:

```ts
    const batch = rows.filter((row) => row.id === event.id || row.messageType === 'audio'
      || (row.messageText?.trim() && !connectionToken(row.messageText) && !OPT_OUT.test(row.messageText.trim())));
```

3. Novo método:

```ts
  /** Transcreve os áudios do lote. Recusas recebem resposta própria e saem do turno; os textos seguem. */
  private async transcribeBatch(batch: Event[], link: Link, conversation: Conversation) {
    const ready: Event[] = [];
    for (const item of batch) {
      if (item.messageType !== 'audio') { ready.push(item); continue; }
      if (!this.orchestrator.enabled()) continue;
      const outcome = await this.audio.transcribe(item);
      if (outcome.ok) ready.push({ ...item, messageText: outcome.text });
      else await this.say(item, link, conversation, AUDIO_REPLIES[outcome.reason], `nero-audio:${item.id}`);
    }
    return ready;
  }
```

4. Em `processLockedEvent`, trocar a linha da recusa de tipo não suportado por:

```ts
      const isAudio = event.messageType === 'audio';
      if (!buttonId && !isAudio && (event.messageType !== 'text' || !text)) { await this.plain(event, TEXT.unsupported, 'unsupported', link.id); await this.finish(batchIds); return; }
```

e o ramo sem botão por:

```ts
      else {
        const batch = await this.collectBurst(event);
        batchIds = batch.map((item) => item.id);
        const ready = await this.transcribeBatch(batch, link, conversation);
        if (ready.length) await this.handleTurn(ready, link, conversation, eligible);
        else if (!this.orchestrator.enabled()) await this.say(event, link, conversation, TEXT.disabled, `nero:${event.id}`);
      }
```

5. Em `handleTurn`, marcar a origem:

```ts
    const userMessages: NewMessage[] = batch.map((item) => ({ role: 'USER', content: item.messageText!.trim(), source: item.messageType === 'audio' ? 'AUDIO' : 'TEXT', inboxEventId: item.id }));
```

- [ ] **Step 4: Orquestrador** — em `historyInput` (`agent-orchestrator.service.ts`), a fala do usuário vinda de áudio vai marcada:

```ts
    : { role: item.role === 'USER' ? 'user' : 'assistant', content: item.role === 'USER' && item.source === 'AUDIO' ? `(mensagem de voz transcrita) ${item.content}` : item.content });
```

- [ ] **Step 5: Prompt** — em `prompt.ts`, na seção "Conversa", acrescentar a linha abaixo e incrementar `NERO_PROMPT_VERSION` (ex.: `2026-11-10.3`):

```ts
    '- Mensagens marcadas como "(mensagem de voz transcrita)" vieram de áudio: nomes, números e valores podem ter sido transcritos errado. Se algo importante parecer estranho, confirme com o usuário antes de usar.',
```

- [ ] **Step 6: Módulo** — em `assistant.module.ts`, acrescentar aos providers:

```ts
    { provide: NERO_TRANSCRIBER, useFactory: () => new OpenAITranscriber() },
    AudioTranscriptionService,
```

(importar `NERO_TRANSCRIBER`, `OpenAITranscriber` e `AudioTranscriptionService`; o `MetaMediaClient` vem do `WhatsAppModule`, já importado).

- [ ] **Step 7: Teste permanente** — em `backend/tests/nero-company-links.test.ts`, passar o novo parâmetro na construção do `NiloService`:

```ts
import { AudioTranscriptionService } from '../src/assistant/audio/audio-transcription.service.js';
import { OpenAITranscriber } from '../src/assistant/audio/transcriber.js';
import { MetaMediaClient } from '../src/whatsapp/meta-media.client.js';
// ...
  nero = new NiloService(database, links, outbound, new ConversationService(database), actions, new AgentOrchestrator(database, new OpenAINeroModel(), registry, actions), new AudioTranscriptionService(database, new MetaMediaClient(), new OpenAITranscriber()));
```

- [ ] **Step 8:** Rodar `nero-audio-flow`, `nero-company-links` e os demais `nero-` desta fase; typecheck. Sem commit.

---

### Task 7: Variáveis, avaliação real, verificação e limpeza

**Files:** Modify `.env.example`, `compose.yaml`; Create (temporário) `backend/tests/nero-audio-eval.live.test.ts`

- [ ] **Step 1: Variáveis** — no bloco do Nero em `.env.example`:

```dotenv
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe
NERO_AUDIO_MAX_SECONDS=300
NERO_AUDIO_MAX_BYTES=16777216
NERO_AUDIO_DAILY_MINUTES=30
```

e repassar as quatro no `environment` dos serviços `api` e `worker` do `compose.yaml` no formato `${VAR:-padrão}`.

- [ ] **Step 2: Avaliação real** (só com `NERO_LIVE_EVAL=1`; gera a voz com TTS da OpenAI, sem Meta)

```ts
// backend/tests/nero-audio-eval.live.test.ts — TEMPORÁRIO (apagar nesta task)
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { ActionService } from '../src/assistant/actions/action.service.js';
import { AgentOrchestrator } from '../src/assistant/agent-orchestrator.service.js';
import { AudioTranscriptionService } from '../src/assistant/audio/audio-transcription.service.js';
import { oggOpusDurationSeconds } from '../src/assistant/audio/ogg-duration.js';
import { OpenAITranscriber } from '../src/assistant/audio/transcriber.js';
import { ConversationService } from '../src/assistant/conversation.service.js';
import { OpenAINeroModel } from '../src/assistant/model/nero-model.js';
import { NiloService } from '../src/assistant/nilo.service.js';
import { createToolRegistry } from '../src/assistant/tools/index.js';
import type { MetaMediaClient } from '../src/whatsapp/meta-media.client.js';
import { WhatsAppOutboundService } from '../src/whatsapp/whatsapp-outbound.service.js';
import { audioPayload, createNeroTestEnv, insertInbound, seedOperator, type NeroTestEnv } from './nero-fixture.js';

const live = process.env.NERO_LIVE_EVAL === '1';
let env: NeroTestEnv, apiKey: string | undefined, voice: Buffer;
beforeAll(async () => {
  apiKey = process.env.OPENAI_API_KEY;
  if (!live) return;
  env = await createNeroTestEnv();
  const speech = await new OpenAI({ apiKey }).audio.speech.create({ model: 'gpt-4o-mini-tts', voice: 'alloy', response_format: 'opus', input: 'Oi Nero, fiz uma venda de um site de cinco mil reais pro meu cliente Roberto. Lança pra mim?' });
  voice = Buffer.from(await speech.arrayBuffer());
}, 180_000);
afterAll(async () => { await env?.close(); });

describe.runIf(live)('avaliação de áudio com OpenAI real', () => {
  it('lê a duração do OGG real gerado pelo TTS', () => {
    const seconds = oggOpusDurationSeconds(voice);
    console.log('Duração lida →', seconds);
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(20);
  });

  it('transcreve a voz e o Nero responde mantendo o contexto, sem jargão', async () => {
    vi.stubEnv('OPENAI_API_KEY', apiKey ?? ''); vi.stubEnv('NILO_ENABLED', 'true');
    const registry = createToolRegistry(env.database);
    const actions = new ActionService(env.database, registry);
    const media = { download: async () => ({ bytes: voice, mimeType: 'audio/ogg' }) } as unknown as MetaMediaClient;
    const audio = new AudioTranscriptionService(env.database, media, new OpenAITranscriber());
    const nero = new NiloService(env.database, env.links, new WhatsAppOutboundService(env.database), new ConversationService(env.database), actions, new AgentOrchestrator(env.database, new OpenAINeroModel(), registry, actions), audio);
    const operator = await seedOperator(env, ['Eval Voz']);
    const event = await insertInbound(env, operator.senderId, null, { messageType: 'audio', payload: audioPayload('777') });
    await nero.processInboxEvent(event.id);
    const [saved] = await env.db.select().from(schema.whatsappInboxEvents).where(eq(schema.whatsappInboxEvents.id, event.id));
    console.log('Transcrição →', saved.messageText);
    const [reply] = await env.db.select().from(schema.whatsappOutboundMessages).where(eq(schema.whatsappOutboundMessages.linkId, operator.linkId));
    console.log('Resposta →', reply.body);
    expect(saved.transcriptionStatus).toBe('DONE');
    expect(saved.messageText).toMatch(/Roberto/i);
    expect(reply.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}|propor_operacoes|get_sales_report|transcri/i);
  }, 180_000);
});
```

Run (com o `cd` exato): `NERO_LIVE_EVAL=1 npm exec -w backend -- vitest run tests/nero-audio-eval.live.test.ts --silent=false --reporter=verbose`. Registrar duração, transcrição e resposta. Falha por comportamento do modelo → ajustar só `prompt.ts` (incrementando a versão), no máximo 3 rodadas, sem afrouxar asserções. Falha de API (crédito, modelo inexistente) → parar e reportar sem segredos.

- [ ] **Step 3: Verificação** — rodar todos os `tests/nero-` desta fase, `npm run backend:test` (com o `hookTimeout` novo, deve ficar verde; se algo falhar, separar o que é desta fase do que é pré-existente), `npm run backend:typecheck && npm run frontend:typecheck`.

- [ ] **Step 4: Limpeza** — apagar `backend/tests/nero-fixture.ts`, `nero-fixture.test.ts`, `nero-audio-format.test.ts`, `nero-media.test.ts`, `nero-transcription.test.ts`, `nero-audio-flow.test.ts`, `nero-audio-eval.live.test.ts`; apagar `test-results`/`coverage` se existirem; conferir que não sobrou banco `gestaonf_nero_test_*`. Manter `backend/vitest.config.ts` e `nero-company-links.test.ts`. Rodar de novo `npm run backend:test` e os typechecks.

- [ ] **Step 5:** Sem commit. Relatar arquivos, migration 0038, resultados e a saída da avaliação real.

---

## Cobertura do spec (seção 9)

| Requisito | Task |
| --- | --- |
| Remetente não vinculado não baixa mídia | 6 (teste) |
| Download só de host Meta, redirecionamento revalidado, tamanho, sha256 | 4 |
| Formatos aceitos sem ffmpeg; recusa amr/aac | 3, 5 |
| Bytes em memória, sem arquivo temporário | 5 |
| Duração do OGG; limite 5 min; limite de tamanho | 3, 5 |
| Transcrição gravada no evento; rajada; `source=AUDIO`; marcação no histórico; aviso no prompt | 2, 5, 6 |
| Vazio / falha com respostas próprias | 5, 6 |
| Cota em 24 h | 5 |
| Nero desligado não baixa | 6 |
| Avaliação real ponta a ponta | 7 |
