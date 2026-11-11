// backend/tests/nero-write-operations.test.ts — TEMPORÁRIO
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@gestaonf/database/schema';
import { ActionService } from '../src/assistant/actions/action.service.js';
import { createToolRegistry } from '../src/assistant/tools/index.js';
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { activeConversation, createNeroTestEnv, readServices, seedOperator, VALID_CPF, VALID_CPF_2, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
let actions: ActionService;
let customers: CustomersService;
let services: ServicesService;
beforeAll(async () => {
  env = await createNeroTestEnv();
  actions = new ActionService(env.database, createToolRegistry(env.database, readServices(env)));
  customers = new CustomersService(env.database);
  services = new ServicesService(env.database);
}, 120_000);
afterAll(async () => { await env?.close(); });

/** O Intl usa espaço inseparável entre "R$" e o valor; nos testes normalizamos. */
const plain = (text: string) => text.replace(/ /g, ' ');
const customersOf = (companyId: string) => env.db.select().from(schema.customers).where(eq(schema.customers.companyId, companyId));
const servicesOf = (companyId: string) => env.db.select().from(schema.services).where(eq(schema.services.companyId, companyId));

async function scenario(name: string, role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'COLLABORATOR' = 'OWNER') {
  const operator = await seedOperator(env, [name], role);
  const { ctx } = await activeConversation(env, operator);
  return { operator, ctx, companyId: ctx.companyId };
}

describe('operações de cadastro', () => {
  it('lote alterar 1 + criar 2: um resumo, ensaio sem gravar, confirmação grava tudo e é idempotente', async () => {
    const { ctx, companyId, operator } = await scenario('Lote');
    const roberto = await customers.create(companyId, operator.userId, { kind: 'PF', name: 'Roberto Almeida', phone: '61999990000' });
    const proposed = await actions.propose(ctx, [
      { tool: 'alterar_cliente', args: { id: roberto.id, alteracoes: { phone: '61988887777' } } },
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Ana Souza', taxId: VALID_CPF } },
      { tool: 'criar_servico', args: { name: 'Criação de site', suggestedUnitPrice: '5000.00' } },
    ]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    const summary = plain(proposed.summary);
    expect(summary).toContain('Alterar cliente Roberto Almeida: Telefone: 61999990000 → 61988887777');
    expect(summary).toContain('Novo cliente: Tipo: Pessoa física · Nome: Ana Souza');
    expect(summary).toContain('CPF/CNPJ: 529.982.247-25');
    expect(summary).toContain('Novo serviço:');
    expect(summary).toContain('Preço sugerido: R$ 5.000,00');
    // O ensaio não gravou nada.
    expect(await customersOf(companyId)).toHaveLength(1);
    expect((await customers.get(companyId, roberto.id)).phone).toBe('61999990000');
    expect(await servicesOf(companyId)).toHaveLength(0);

    const confirmed = await actions.confirm(proposed.actionId, ctx);
    expect(confirmed.status).toBe('EXECUTED');
    expect((await customers.get(companyId, roberto.id)).phone).toBe('61988887777');
    expect((await customersOf(companyId)).map((customer) => customer.name).sort()).toEqual(['Ana Souza', 'Roberto Almeida']);
    expect(await servicesOf(companyId)).toHaveLength(1);
    expect((await actions.confirm(proposed.actionId, ctx)).status).toBe('ALREADY_EXECUTED');
    expect(await customersOf(companyId)).toHaveLength(2);
  });

  it('CPF inválido: proposta recusada na operação certa e nada gravado', async () => {
    const { ctx, companyId } = await scenario('CPF inválido');
    const result = await actions.propose(ctx, [
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Ana', taxId: VALID_CPF } },
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Beto', taxId: '12345678900' } },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toMatchObject({ kind: 'VALIDATION', operationIndex: 1, message: 'CPF inválido' });
    expect(await customersOf(companyId)).toHaveLength(0);
  });

  it('CPF já usado por outro cliente vira conflito já na proposta', async () => {
    const { ctx, companyId, operator } = await scenario('CPF duplicado');
    await customers.create(companyId, operator.userId, { kind: 'PF', name: 'Ana', taxId: VALID_CPF });
    const result = await actions.propose(ctx, [{ tool: 'criar_cliente', args: { kind: 'PF', name: 'Outra Ana', taxId: VALID_CPF } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toMatchObject({ kind: 'CONFLICT', operationIndex: 0, message: 'CPF/CNPJ já cadastrado nesta empresa' });
    expect(await customersOf(companyId)).toHaveLength(1);
  });

  it('código interno repetido em serviço vira conflito', async () => {
    const { ctx, companyId, operator } = await scenario('Código repetido');
    await services.create(companyId, operator.userId, { name: 'Site', internalCode: 'SITE' });
    const result = await actions.propose(ctx, [{ tool: 'criar_servico', args: { name: 'Outro site', internalCode: 'SITE' } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toMatchObject({ kind: 'CONFLICT', message: 'Código interno já cadastrado nesta empresa' });
    expect(await servicesOf(companyId)).toHaveLength(1);
  });

  it('$ref: cria um cliente e o altera no mesmo lote', async () => {
    const { ctx, companyId } = await scenario('Referência');
    const proposed = await actions.propose(ctx, [
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Carla' } },
      { tool: 'alterar_cliente', args: { id: { $ref: 0 }, alteracoes: { phone: '61977776666' } } },
    ]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect((await actions.confirm(proposed.actionId, ctx)).status).toBe('EXECUTED');
    const rows = await customersOf(companyId);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('61977776666');
  });

  it('alteração sem mudança real é recusada com mensagem clara', async () => {
    const { ctx, companyId, operator } = await scenario('Sem mudança');
    const roberto = await customers.create(companyId, operator.userId, { kind: 'PF', name: 'Roberto Almeida', phone: '61999990000' });
    const result = await actions.propose(ctx, [{ tool: 'alterar_cliente', args: { id: roberto.id, alteracoes: { phone: '61999990000' } } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause.kind).toBe('VALIDATION');
    expect(result.cause.message).toContain('Os dados informados já são os atuais do cliente Roberto Almeida');
  });

  it('corrida de CPF entre a proposta e a confirmação: FAILED/CONFLICT e nada do lote é gravado', async () => {
    const { ctx, companyId } = await scenario('Corrida');
    const proposed = await actions.propose(ctx, [
      { tool: 'criar_servico', args: { name: 'Consultoria' } },
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Ana', taxId: VALID_CPF_2 } },
    ]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    // Outro processo grava o mesmo CPF direto no banco antes da confirmação.
    await env.db.insert(schema.customers).values({ companyId, kind: 'PF', name: 'Concorrente', taxId: VALID_CPF_2 });
    const confirmed = await actions.confirm(proposed.actionId, ctx);
    expect(confirmed.status).toBe('FAILED');
    if (confirmed.status !== 'FAILED') return;
    expect(confirmed.cause).toMatchObject({ kind: 'CONFLICT', operationIndex: 1, message: 'CPF/CNPJ já cadastrado nesta empresa' });
    expect(await servicesOf(companyId)).toHaveLength(0);
    expect((await customersOf(companyId)).map((customer) => customer.name)).toEqual(['Concorrente']);
  });

  it('isolamento: alterar cliente de outra empresa não encontra o cliente', async () => {
    const mine = await scenario('Minha empresa');
    const other = await scenario('Outra empresa');
    const foreign = await customers.create(other.companyId, other.operator.userId, { kind: 'PF', name: 'Cliente alheio', phone: '1' });
    const result = await actions.propose(mine.ctx, [{ tool: 'alterar_cliente', args: { id: foreign.id, alteracoes: { phone: '2' } } }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cause).toMatchObject({ kind: 'VALIDATION', operationIndex: 0, message: 'Cliente não encontrado' });
    expect((await customers.get(other.companyId, foreign.id)).phone).toBe('1');
  });

  it('COLLABORATOR também cria clientes e serviços, como no site', async () => {
    const { ctx, companyId } = await scenario('Colaborador', 'COLLABORATOR');
    const proposed = await actions.propose(ctx, [
      { tool: 'criar_cliente', args: { kind: 'PF', name: 'Duda' } },
      { tool: 'criar_servico', args: { name: 'Suporte' } },
    ]);
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;
    expect((await actions.confirm(proposed.actionId, ctx)).status).toBe('EXECUTED');
    expect(await customersOf(companyId)).toHaveLength(1);
    expect(await servicesOf(companyId)).toHaveLength(1);
  });
});
