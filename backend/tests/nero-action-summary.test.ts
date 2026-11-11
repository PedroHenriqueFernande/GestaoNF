// backend/tests/nero-action-summary.test.ts — TEMPORÁRIO
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { WriteOperation } from '../src/assistant/tools/types.js';
import { ActionService } from '../src/assistant/actions/action.service.js';
import { createToolRegistry } from '../src/assistant/tools/index.js';
import { activeConversation, createNeroTestEnv, readServices, seedOperator, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

const withSummary: WriteOperation = {
  kind: 'WRITE', name: 'teste_com_resumo', description: 'Operação de teste', schema: z.object({}).strict(), allowed: () => true,
  summarize: () => 'Resumo estático (não deve aparecer)',
  async execute() { return { entityId: null, label: 'Com resumo', summary: 'Telefone: A → B' }; },
};
const withoutSummary: WriteOperation = {
  kind: 'WRITE', name: 'teste_sem_resumo', description: 'Operação de teste', schema: z.object({}).strict(), allowed: () => true,
  summarize: () => 'Resumo estático',
  async execute() { return { entityId: null, label: 'Sem resumo' }; },
};

describe('resumo vindo do ensaio', () => {
  it('usa o summary do ensaio quando existe e o summarize quando não existe', async () => {
    const registry = createToolRegistry(env.database, readServices(env)).registerWrite(withSummary).registerWrite(withoutSummary);
    const actions = new ActionService(env.database, registry);
    const { ctx } = await activeConversation(env, await seedOperator(env, ['Resumo']));
    const result = await actions.propose(ctx, [{ tool: 'teste_com_resumo', args: {} }, { tool: 'teste_sem_resumo', args: {} }]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.summary).toContain('Telefone: A → B');
    expect(result.summary).toContain('Resumo estático');
    expect(result.summary).not.toContain('não deve aparecer');
  });
});
