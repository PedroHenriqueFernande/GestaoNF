// backend/tests/nero-fixture.test.ts — TEMPORÁRIO
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { buildNero, createNeroTestEnv, insertInbound, ScriptedModel, say, seedOperator, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

describe('fixture da Fase 3', () => {
  it('processa um inbound com o modelo roteirizado e grava 1 mensagem de saída', async () => {
    const operator = await seedOperator(env, ['Cadastros']);
    const { nero } = buildNero(env, new ScriptedModel([say('oi')]));
    const event = await insertInbound(env, operator.senderId, 'olá');
    await nero.processInboxEvent(event.id);
    const sent = await env.db.select().from(schema.whatsappOutboundMessages).where(eq(schema.whatsappOutboundMessages.recipientId, operator.senderId));
    expect(sent).toHaveLength(1);
  });
});
