# Nero — Fase 2: Leituras — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).
>
> **Regras do projeto para todas as tarefas:**
> - **Nunca fazer `git commit`, `git add` ou `git rm`.** Tudo fica no working tree.
> - **Testes temporários** (`ArquivosMD/procedimento-padrao-testes.md`): apagados na Task 6. O teste permanente `backend/tests/nero-company-links.test.ts` só recebe o ajuste da criação do registro de ferramentas.
> - Português do Brasil em textos e comentários.
> - **Comando de teste** (quirk do Windows — use exatamente este `cd`):
>   `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && npm exec -w backend -- vitest run tests/<arquivo>.test.ts`
>   O "No test files found" do workspace `backend/database` é ruído.

**Goal:** O Nero consulta o GestãoNF pelo WhatsApp: busca clientes e serviços, lista e detalha vendas, mostra contas a receber e lê os 8 relatórios, sempre no escopo da empresa e do usuário, com respostas curtas em texto.

**Architecture:** Seis ferramentas `READ` novas em `backend/src/assistant/tools/`, cada uma chamando o serviço de domínio que a web já usa (`CustomersService`, `ServicesService`, `SalesService`, `FinanceReadService`, `ReportsReadService`), de modo que filtros, escopo de CRM por papel e regras de cálculo são os mesmos do site. Um módulo comum (`read-support.ts`) valida os argumentos do modelo (zod), resolve períodos a partir da data local da empresa e compacta o resultado (sem campos internos, no máximo 10 itens, textos truncados) com uma memória curta para o histórico. `consultar_vendas` substitui `get_sales_report`. O registro passa a receber os serviços por injeção. Spec: `docs/superpowers/specs/2026-11-10-nero-agente-secretario-design.md`, seções 4.1 e 10.

**Tech Stack:** NestJS 12, Drizzle 0.45 + PostgreSQL 17, Zod 4, OpenAI Responses API (strict JSON Schema), Vitest 5.

---

## Ferramentas

| Ferramenta | Serviço | Argumentos (strict; todos em `required`, nulos quando não usados) | Saída ao modelo |
| --- | --- | --- | --- |
| `buscar_clientes` | `CustomersService.list` | `busca: string\|null`, `situacao: 'ATIVOS'\|'INATIVOS'\|'TODOS'` | total + até 10: id, tipo, nome, nome fantasia, CPF/CNPJ, telefone, e-mail, cidade/UF, situação |
| `buscar_servicos` | `ServicesService.list` | `busca`, `situacao` | total + até 10: id, nome, código interno, unidade, preço padrão, situação |
| `consultar_vendas` | SQL agregado + `SalesService.list` | `periodo`, `inicio`, `fim`, `situacao: 'CONFIRMADAS'\|'RASCUNHOS'\|'CANCELADAS'\|'TODAS'`, `busca` (cliente, nº do pedido ou OS), `escopo: 'EMPRESA'\|'MINHAS'` | período, quantidade, total (confirmadas no período), até 10 pedidos (nº, cliente, data, total, situação) |
| `consultar_venda` | `SalesService.list` (por nº) + `SalesService.get` | `numero_pedido: string` (5 dígitos) | pedido: nº, situação, cliente, data, OS, itens (descrição, qtd, valor), parcelas (nº, forma, valor, vencimento, pago, restante, situação), total |
| `contas_a_receber` | `FinanceReadService.summary` + `.list` | `periodo`, `inicio`, `fim`, `base: 'VENDA'\|'VENCIMENTO'\|'RECEBIMENTO'`, `situacao: 'TODAS'\|'PENDENTES'\|'PARCIAIS'\|'PAGAS'`, `vencidas: 'TODAS'\|'SO_VENCIDAS'\|'SEM_VENCIDAS'`, `busca` | resumo (original, recebido, a receber, vencido, nº de vendas/parcelas) + até 10 vendas com parcelas |
| `relatorio` | `ReportsReadService.read` (escopo CRM por papel) | `tipo` (8 relatórios), `periodo`, `inicio`, `fim`, `busca` | resumo + até 10 linhas |

Períodos (`periodo`): `HOJE`, `ULTIMOS_7_DIAS`, `ESTE_MES`, `MES_PASSADO`, `ESTE_ANO`, `PERSONALIZADO` (exige `inicio`/`fim` AAAA-MM-DD válidos, início ≤ fim, no máximo 366 dias), `SEM_PERIODO` (só onde o serviço permite: busca de vendas e contas a receber sem filtro de data, catálogos).

Tipos de `relatorio`: `servicos_fechados`→`closed-services`, `recebimentos`→`service-receipts`, `entradas_de_leads`→`lead-entries`, `clientes`→`customers`, `catalogo_de_servicos`→`service-catalog`, `reunioes`→`meetings`, `taxa_de_desqualificacao`→`disqualification-rate`, `taxa_de_perda`→`loss-rate`. Os dois catálogos aceitam `SEM_PERIODO`; os demais exigem período.

Permissões: todas as leituras usam `rules.anyMember` (o site não restringe essas telas por papel). O escopo de CRM para COLLABORATOR é aplicado pelo próprio `ReportsReadService` via `CrmPolicyService`.

---

## Mapa de arquivos

| Arquivo | Ação |
| --- | --- |
| `backend/src/assistant/tools/read-support.ts` | Criar: `PERIOD_VALUES`, `periodProperties`, `resolvePeriod`, `parseToolArgs`, `compactList`, `truncate` |
| `backend/src/assistant/tools/catalog-tools.ts` | Criar: `buscar_clientes`, `buscar_servicos` |
| `backend/src/assistant/tools/sales-tools.ts` | Criar: `consultar_vendas`, `consultar_venda` |
| `backend/src/assistant/tools/finance-tools.ts` | Criar: `contas_a_receber` |
| `backend/src/assistant/tools/report-tools.ts` | Criar: `relatorio` |
| `backend/src/assistant/tools/sales-report.tool.ts` | Apagar (substituída por `consultar_vendas`) |
| `backend/src/assistant/tools/index.ts` | Modificar: `createToolRegistry(database, readers)` |
| `backend/src/assistant/assistant.module.ts` | Modificar: importar módulos de domínio e injetar serviços |
| `backend/src/finance/finance.module.ts` | Modificar: exportar `FinanceReadService` |
| `backend/src/assistant/prompt.ts` | Modificar: orientação de consultas; nova versão |
| `backend/tests/nero-company-links.test.ts` | Modificar (permanente): nova assinatura do registro |
| `backend/tests/nero-fixture.ts` + testes `nero-*` | Criar (temporários) |

---

### Task 1: Fixture temporária com dados de negócio

**Files:** Create `backend/tests/nero-fixture.ts`, `backend/tests/nero-fixture.test.ts`

- [ ] **Step 1:** Criar `nero-fixture.ts` com o mesmo conteúdo base da Fase 1 (`createNeroTestEnv`, `randomSender`, `seedOperator`, `insertInbound`, `ScriptedModel`, `say`, `callTool`, `seenText` — copiar de `docs/superpowers/plans/2026-11-10-nero-fase-1-audio.md`, Task 1, Step 4, removendo `audioPayload` e `fakeOgg`), acrescentando:

```ts
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import { FinanceReadService } from '../src/finance/finance-read.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import type { FilesService } from '../src/files/files.service.js';
import type { FiscalService } from '../src/fiscal/fiscal.service.js';
import type { ReadServices } from '../src/assistant/tools/index.js';

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

/** Cliente, serviço e uma venda confirmada com duas parcelas (uma recebida, uma a vencer), inseridos direto no banco. */
export async function seedBusiness(env: NeroTestEnv, companyId: string, userId: string, options: { customer?: string; soldOn: string; total?: string; receivedOn?: string; dueOn?: string }) {
  const [customer] = await env.db.insert(schema.customers).values({ companyId, kind: 'PF', name: options.customer ?? 'Roberto Almeida', phone: '61999990000' }).returning();
  const [service] = await env.db.insert(schema.services).values({ companyId, name: 'Criação de site', unitLabel: 'UN' }).returning();
  return { customer, service };
}
```

Para vendas confirmadas com parcelas e recebíveis, a fixture **não** insere direto: usa `SalesService.create` + `SalesService.confirm`, que é o caminho real e gera recebíveis e movimentos corretamente. Acrescentar:

```ts
export async function seedConfirmedSale(env: NeroTestEnv, companyId: string, userId: string, input: { customerId: string; serviceId: string; soldOn: string; total: string; receivedOn: string; dueOn: string }) {
  const sales = new SalesService(env.database, { attachToSale: async () => undefined } as unknown as FilesService, { saleFiscalDefaults: async () => ({}) } as unknown as FiscalService);
  const half = (Number(input.total) / 2).toFixed(2);
  const draft = await sales.create(companyId, userId, randomUUID(), {
    customerId: input.customerId, soldOn: input.soldOn,
    items: [{ serviceId: input.serviceId, quantity: '1.0000', unitPrice: input.total, discountAmount: '0.00' }],
    installments: [{ paymentMethod: 'PIX', amount: half, receivedOn: input.receivedOn }, { paymentMethod: 'BOLETO', amount: half, dueOn: input.dueOn }],
  });
  const detail = await sales.get(companyId, draft.id);
  await sales.confirm(companyId, draft.id, userId, { expectedVersion: detail.version, initialReceipts: [] });
  return sales.get(companyId, draft.id);
}
```

Se `create`/`confirm` exigirem outras dependências de `FilesService`/`FiscalService`, ler `backend/src/sales/sales.service.ts` e simular apenas os métodos efetivamente chamados (sem lógica), relatando o ajuste. Se o caminho real ficar inviável, inserir em `sales`, `sale_items`, `sale_installments`, `receivables` e `receivable_movements` respeitando os checks do schema e relatar.

- [ ] **Step 2: Teste de fumaça**

```ts
// backend/tests/nero-fixture.test.ts — TEMPORÁRIO
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createNeroTestEnv, seedBusiness, seedConfirmedSale, seedOperator, type NeroTestEnv } from './nero-fixture.js';

let env: NeroTestEnv;
beforeAll(async () => { env = await createNeroTestEnv(); }, 120_000);
afterAll(async () => { await env?.close(); });

describe('fixture da Fase 2', () => {
  it('cria venda confirmada com parcela recebida e parcela a vencer', async () => {
    const operator = await seedOperator(env, ['Leituras']);
    const companyId = operator.companies[0].id;
    const { customer, service } = await seedBusiness(env, companyId, operator.userId, { soldOn: '2026-11-05' });
    const sale = await seedConfirmedSale(env, companyId, operator.userId, { customerId: customer.id, serviceId: service.id, soldOn: '2026-11-05', total: '5000.00', receivedOn: '2026-11-05', dueOn: '2026-12-10' });
    expect(sale.status).toBe('CONFIRMED');
    expect(sale.installments.map((part) => part.paymentStatus).sort()).toEqual(['PAID', 'PENDING']);
  });
});
```

- [ ] **Step 3:** Rodar até passar. Sem commit.

---

### Task 2: Suporte comum às leituras

**Files:** Create `backend/src/assistant/tools/read-support.ts`; Test `backend/tests/nero-read-support.test.ts`

- [ ] **Step 1: Testes**

```ts
// backend/tests/nero-read-support.test.ts — TEMPORÁRIO
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { compactList, parseToolArgs, resolvePeriod, truncate } from '../src/assistant/tools/read-support.js';

describe('períodos', () => {
  it('resolve presets a partir da data local', () => {
    expect(resolvePeriod({ periodo: 'HOJE', inicio: null, fim: null }, '2026-11-11')).toEqual({ from: '2026-11-11', to: '2026-11-11' });
    expect(resolvePeriod({ periodo: 'ULTIMOS_7_DIAS', inicio: null, fim: null }, '2026-11-11')).toEqual({ from: '2026-11-05', to: '2026-11-11' });
    expect(resolvePeriod({ periodo: 'ESTE_MES', inicio: null, fim: null }, '2026-11-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(resolvePeriod({ periodo: 'MES_PASSADO', inicio: null, fim: null }, '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolvePeriod({ periodo: 'ESTE_ANO', inicio: null, fim: null }, '2026-11-11')).toEqual({ from: '2026-01-01', to: '2026-12-31' });
    expect(resolvePeriod({ periodo: 'SEM_PERIODO', inicio: null, fim: null }, '2026-11-11', { allowNone: true })).toBeNull();
  });
  it('valida o personalizado e recusa SEM_PERIODO quando não permitido', () => {
    expect(resolvePeriod({ periodo: 'PERSONALIZADO', inicio: '2026-03-01', fim: '2026-03-31' }, '2026-11-11')).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    for (const bad of [{ inicio: '01/03/2026', fim: '2026-03-31' }, { inicio: '2026-02-30', fim: '2026-03-01' }, { inicio: '2026-04-01', fim: '2026-03-01' }, { inicio: '2025-01-01', fim: '2026-03-01' }, { inicio: null, fim: '2026-03-01' }]) {
      expect(() => resolvePeriod({ periodo: 'PERSONALIZADO', ...bad }, '2026-11-11')).toThrow(/AAAA-MM-DD/);
    }
    expect(() => resolvePeriod({ periodo: 'SEM_PERIODO', inicio: null, fim: null }, '2026-11-11')).toThrow(/período/);
  });
});

describe('argumentos e compactação', () => {
  it('argumento inválido do modelo vira erro de validação claro', () => {
    expect(() => parseToolArgs(z.object({ busca: z.string() }).strict(), { busca: 1 })).toThrow(/argumentos/i);
  });
  it('remove campos internos, limita itens e trunca textos', () => {
    const rows = Array.from({ length: 15 }, (_, index) => ({ id: `${index}`, companyId: 'x', idempotencyKey: 'y', requestHash: 'z', _order: 1, name: 'a'.repeat(300) }));
    const result = compactList(rows, 10);
    expect(result.items).toHaveLength(10);
    expect(result.omitted).toBe(5);
    expect(Object.keys(result.items[0]).sort()).toEqual(['id', 'name']);
    expect(String(result.items[0].name).length).toBeLessThanOrEqual(201);
    expect(truncate('abc', 2)).toBe('ab…');
  });
});
```

- [ ] **Step 2:** Rodar e ver falhar.

- [ ] **Step 3: `read-support.ts`**

```ts
// backend/src/assistant/tools/read-support.ts
import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';

export const PERIOD_VALUES = ['HOJE', 'ULTIMOS_7_DIAS', 'ESTE_MES', 'MES_PASSADO', 'ESTE_ANO', 'PERSONALIZADO', 'SEM_PERIODO'] as const;
export type PeriodArgs = { periodo: typeof PERIOD_VALUES[number]; inicio: string | null; fim: string | null };

/** Propriedades de período para os JSON Schemas strict das ferramentas. */
export const periodProperties = {
  periodo: { type: 'string', enum: [...PERIOD_VALUES], description: 'Use PERSONALIZADO com inicio e fim; SEM_PERIODO só quando o usuário não limitar datas e a consulta permitir.' },
  inicio: { type: ['string', 'null'], description: 'Data inicial AAAA-MM-DD (só em PERSONALIZADO).' },
  fim: { type: ['string', 'null'], description: 'Data final AAAA-MM-DD (só em PERSONALIZADO; no máximo 366 dias depois do início).' },
} as const;

const CUSTOM_MESSAGE = 'Informe data inicial e final no formato AAAA-MM-DD, com no máximo 366 dias';
const iso = (date: Date) => date.toISOString().slice(0, 10);

function validDate(value: string | null): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function resolvePeriod(args: PeriodArgs, today: string, options: { allowNone?: boolean } = {}): { from: string; to: string } | null {
  const [year, month, day] = today.split('-').map(Number);
  switch (args.periodo) {
    case 'HOJE': return { from: today, to: today };
    case 'ULTIMOS_7_DIAS': return { from: iso(new Date(Date.UTC(year, month - 1, day - 6))), to: today };
    case 'ESTE_MES': return { from: iso(new Date(Date.UTC(year, month - 1, 1))), to: iso(new Date(Date.UTC(year, month, 0))) };
    case 'MES_PASSADO': return { from: iso(new Date(Date.UTC(year, month - 2, 1))), to: iso(new Date(Date.UTC(year, month - 1, 0))) };
    case 'ESTE_ANO': return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'SEM_PERIODO':
      if (options.allowNone) return null;
      throw new BadRequestException('Esta consulta precisa de um período');
    case 'PERSONALIZADO': {
      if (!validDate(args.inicio) || !validDate(args.fim)) throw new BadRequestException(CUSTOM_MESSAGE);
      const span = (Date.parse(args.fim) - Date.parse(args.inicio)) / 86_400_000;
      if (span < 0 || span > 366) throw new BadRequestException(CUSTOM_MESSAGE);
      return { from: args.inicio, to: args.fim };
    }
    default: throw new BadRequestException('Período inválido');
  }
}

/** Valida os argumentos vindos do modelo; o strict da OpenAI garante tipos, não regras. */
export function parseToolArgs<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new BadRequestException(`Argumentos inválidos: ${result.error.issues.map((issue) => `${issue.path.join('.') || 'argumentos'} ${issue.message}`).join('; ')}`);
  return result.data;
}

export const truncate = (value: string, max = 200) => (value.length > max ? `${value.slice(0, max)}…` : value);

const INTERNAL_KEYS = new Set(['companyId', 'idempotencyKey', 'requestHash', 'version', 'createdByUserId', 'updatedAt', 'createdAt']);

function clean(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return truncate(value);
  if (Array.isArray(value)) return depth > 3 ? `[${value.length} itens]` : value.slice(0, 10).map((item) => clean(item, depth + 1));
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).filter(([key, item]) => !key.startsWith('_') && !INTERNAL_KEYS.has(key) && item !== null && item !== undefined)
      .map(([key, item]) => [key, clean(item, depth + 1)]));
  }
  return value;
}

/** No máximo `limit` itens, sem campos internos e com textos truncados. */
export function compactList(rows: unknown[], limit = 10) {
  return { items: rows.slice(0, limit).map((row) => clean(row) as Record<string, unknown>), omitted: Math.max(0, rows.length - limit) };
}

export const compact = (value: unknown) => clean(value);
```

- [ ] **Step 4:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 3: Clientes e serviços

**Files:** Create `backend/src/assistant/tools/catalog-tools.ts`; Test `backend/tests/nero-catalog-tools.test.ts`

- [ ] **Step 1: Testes** — semear 2 empresas; "Roberto" na empresa A e "Roberta" na B; serviço "Criação de site" ativo e "Antigo" inativo em A. Verificar: busca "robert" na A devolve só o da A (isolamento); `situacao: 'TODOS'` traz o inativo; saída sem `companyId`; memória `"Busca de clientes \"robert\": 1 encontrado."`; argumento inválido (`situacao: 'X'`) lança `BadRequestException`. Usar `contextFor` montado com `loadExecutionContext` (copiar o helper `activeConversation` da Fase 0 para a fixture se necessário: conversa ACTIVE + run).

- [ ] **Step 2: `catalog-tools.ts`**

```ts
// backend/src/assistant/tools/catalog-tools.ts
import { z } from 'zod';
import type { CustomersService } from '../../customers/customers.service.js';
import type { ServicesService } from '../../services/services.service.js';
import { rules } from '../nero-policy.js';
import { compactList, parseToolArgs } from './read-support.js';
import type { ReadTool } from './types.js';

const STATUS = { ATIVOS: 'ACTIVE', INATIVOS: 'INACTIVE', TODOS: 'ALL' } as const;
const argsSchema = z.object({ busca: z.string().trim().min(1).max(100).nullable(), situacao: z.enum(['ATIVOS', 'INATIVOS', 'TODOS']) }).strict();
const parameters = {
  type: 'object',
  properties: {
    busca: { type: ['string', 'null'], description: 'Parte do nome, nome fantasia, CPF/CNPJ ou telefone; null lista os primeiros.' },
    situacao: { type: 'string', enum: ['ATIVOS', 'INATIVOS', 'TODOS'] },
  },
  required: ['busca', 'situacao'], additionalProperties: false,
};
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

export function createCustomerSearchTool(customers: CustomersService): ReadTool {
  return {
    kind: 'READ', name: 'buscar_clientes', parameters, allowed: rules.anyMember,
    description: 'Busca clientes cadastrados na empresa atual. Use antes de qualquer pedido que dependa de um cliente; se houver mais de um parecido, pergunte qual.',
    async run(ctx, raw) {
      const args = parseToolArgs(argsSchema, raw);
      const result = await customers.list(ctx.companyId, { limit: 10, offset: 0, status: STATUS[args.situacao], search: args.busca ?? undefined });
      const rows = result.items.map((item) => ({ id: item.id, tipo: item.kind, nome: item.name, nomeFantasia: item.tradeName, documento: item.taxId, telefone: item.phone, email: item.email, cidade: item.cityName, uf: item.stateCode, situacao: item.status }));
      return {
        output: { total: result.total, ...compactList(rows) },
        memory: `Busca de clientes${args.busca ? ` "${args.busca}"` : ''}: ${plural(result.total, 'encontrado', 'encontrados')}${rows.length ? ` (${rows.slice(0, 3).map((row) => row.nome).join(', ')})` : ''}.`,
      };
    },
  };
}

export function createServiceSearchTool(services: ServicesService): ReadTool {
  return {
    kind: 'READ', name: 'buscar_servicos', parameters, allowed: rules.anyMember,
    description: 'Busca serviços do catálogo da empresa atual (nome ou código). Use antes de qualquer pedido que dependa de um serviço.',
    async run(ctx, raw) {
      const args = parseToolArgs(argsSchema, raw);
      const result = await services.list(ctx.companyId, { limit: 10, offset: 0, status: STATUS[args.situacao], search: args.busca ?? undefined });
      const rows = result.items.map((item) => ({ id: item.id, nome: item.name, codigo: item.internalCode, unidade: item.unitLabel, precoPadrao: item.defaultPrice ?? null, situacao: item.status }));
      return {
        output: { total: result.total, ...compactList(rows) },
        memory: `Busca de serviços${args.busca ? ` "${args.busca}"` : ''}: ${plural(result.total, 'encontrado', 'encontrados')}${rows.length ? ` (${rows.slice(0, 3).map((row) => row.nome).join(', ')})` : ''}.`,
      };
    },
  };
}
```

Conferir os nomes reais das colunas de `services` (`internalCode`, `unitLabel`, preço padrão) em `backend/database/src/schema.ts` e ajustar `precoPadrao` ao nome real (ou remover se não existir), relatando.

- [ ] **Step 3:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 4: Vendas e venda por número

**Files:** Create `backend/src/assistant/tools/sales-tools.ts`; Delete `sales-report.tool.ts`; Test `backend/tests/nero-sales-tools.test.ts`

- [ ] **Step 1: Testes** — semear venda confirmada de R$ 5.000,00 em `2026-11-05` (usuário A), outra de R$ 1.000,00 (usuário B, mesma empresa), um rascunho, e uma venda em outra empresa. Com `ctx.today = '2026-11-11'`:
  - `consultar_vendas { periodo: 'ESTE_MES', situacao: 'CONFIRMADAS', escopo: 'EMPRESA', busca: null }` → `quantidade 2`, `total '6000.00'`, sem a venda da outra empresa;
  - `escopo: 'MINHAS'` → só a do usuário do contexto;
  - `busca: 'Roberto'` filtra pelo cliente;
  - `situacao: 'RASCUNHOS'` lista o rascunho;
  - `consultar_venda { numero_pedido: <nº> }` → itens e duas parcelas (PAID e PENDING), sem `idempotencyKey`/`companyId`;
  - `numero_pedido: '123'` (formato) → `BadRequestException`; número inexistente → `NotFoundException` com "Pedido não encontrado".

- [ ] **Step 2: `sales-tools.ts`**

```ts
// backend/src/assistant/tools/sales-tools.ts
import { NotFoundException } from '@nestjs/common';
import { sales } from '@gestaonf/database/schema';
import { and, count, eq, gte, lte, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { SalesService } from '../../sales/sales.service.js';
import type { Db } from '../db-types.js';
import { money } from '../nero-format.js';
import { rules } from '../nero-policy.js';
import { compact, compactList, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

const SALE_STATUS = { CONFIRMADAS: 'CONFIRMED', RASCUNHOS: 'DRAFT', CANCELADAS: 'CANCELED', TODAS: 'ALL' } as const;
const listSchema = z.object({
  periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(),
  situacao: z.enum(['CONFIRMADAS', 'RASCUNHOS', 'CANCELADAS', 'TODAS']), busca: z.string().trim().min(1).max(100).nullable(), escopo: z.enum(['EMPRESA', 'MINHAS']),
}).strict();

export function createSalesListTool(db: Db, salesService: SalesService): ReadTool {
  return {
    kind: 'READ', name: 'consultar_vendas', allowed: rules.anyMember,
    description: 'Consulta vendas da empresa atual: quantidade e total das confirmadas no período e os pedidos mais recentes. "busca" filtra por cliente, número do pedido ou ordem de serviço. Use escopo MINHAS quando o usuário falar das vendas que ele mesmo lançou.',
    parameters: {
      type: 'object',
      properties: {
        ...periodProperties,
        situacao: { type: 'string', enum: ['CONFIRMADAS', 'RASCUNHOS', 'CANCELADAS', 'TODAS'] },
        busca: { type: ['string', 'null'] },
        escopo: { type: 'string', enum: ['EMPRESA', 'MINHAS'] },
      },
      required: ['periodo', 'inicio', 'fim', 'situacao', 'busca', 'escopo'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(listSchema, raw);
      const range = resolvePeriod(args, ctx.today, { allowNone: true });
      const conditions = [eq(sales.companyId, ctx.companyId), eq(sales.status, 'CONFIRMED')];
      if (range) conditions.push(gte(sales.soldOn, range.from), lte(sales.soldOn, range.to));
      if (args.escopo === 'MINHAS') conditions.push(eq(sales.createdByUserId, ctx.userId));
      if (args.busca) conditions.push(sql`(${sales.orderCode} = ${args.busca} OR ${sales.customerNameSnapshot} ILIKE ${`%${args.busca.replace(/[\\%_]/g, '\\$&')}%`} OR ${sales.workOrderNumber} ILIKE ${`%${args.busca.replace(/[\\%_]/g, '\\$&')}%`})`);
      const [totals] = await db.select({ quantity: count(), total: sql<string>`coalesce(sum(${sales.totalAmount}), 0)::numeric(15,2)::text` }).from(sales).where(and(...conditions));
      const page = await salesService.list(ctx.companyId, { limit: 50, offset: 0, status: SALE_STATUS[args.situacao], search: args.busca ?? undefined, from: range?.from, to: range?.to });
      const mine = args.escopo === 'MINHAS' ? page.items.filter((item) => item.createdByUserId === ctx.userId) : page.items;
      const rows = mine.map((item) => ({ pedido: item.orderCode, cliente: item.customerNameSnapshot, data: item.soldOn, total: item.totalAmount, situacao: item.status, os: item.workOrderNumber, lancadoPor: item.createdByUserName }));
      return {
        output: { periodo: range ?? 'sem filtro de data', confirmadas: { quantidade: totals.quantity, total: totals.total }, ...compactList(rows) },
        memory: `Vendas${range ? ` de ${range.from} a ${range.to}` : ''}${args.escopo === 'MINHAS' ? ' (do usuário)' : ''}: ${totals.quantity} confirmadas, total ${money(totals.total)}.`,
      };
    },
  };
}

export function createSaleDetailTool(salesService: SalesService): ReadTool {
  const schema = z.object({ numero_pedido: z.string().regex(/^\d{5}$/, 'deve ter 5 dígitos') }).strict();
  return {
    kind: 'READ', name: 'consultar_venda', allowed: rules.anyMember,
    description: 'Mostra um pedido pelo número de 5 dígitos: cliente, itens, parcelas, o que já foi recebido e o que falta.',
    parameters: { type: 'object', properties: { numero_pedido: { type: 'string', description: 'Número do pedido com 5 dígitos.' } }, required: ['numero_pedido'], additionalProperties: false },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const found = await salesService.list(ctx.companyId, { limit: 1, offset: 0, status: 'ALL', search: args.numero_pedido });
      const match = found.items.find((item) => item.orderCode === args.numero_pedido);
      if (!match) throw new NotFoundException('Pedido não encontrado');
      const sale = await salesService.get(ctx.companyId, match.id);
      const output = compact({
        pedido: sale.orderCode, situacao: sale.status, cliente: sale.customerNameSnapshot, data: sale.soldOn, os: sale.workOrderNumber, total: sale.totalAmount,
        itens: sale.items.map((item) => ({ descricao: item.description ?? item.serviceNameSnapshot, quantidade: item.quantity, total: item.totalAmount })),
        parcelas: sale.installments.map((part) => ({ numero: part.number, forma: part.paymentMethod, valor: part.amount, vencimento: part.dueOn, recebido: part.paidAmount, restante: part.remainingAmount, situacao: part.paymentStatus })),
      }) as Record<string, unknown>;
      return { output, memory: `Pedido ${sale.orderCode}: ${sale.customerNameSnapshot}, ${money(sale.totalAmount)}, ${sale.status}.` };
    },
  };
}
```

Conferir em `schema.ts` os nomes reais das colunas de `sale_items` (descrição/nome do serviço, `totalAmount`) e de `sale_installments` (`number`, `paymentMethod`, `amount`, `dueOn`) e ajustar, relatando. Apagar `sales-report.tool.ts` (`rm`).

- [ ] **Step 3:** Rodar e ver passar; typecheck. Sem commit.

---

### Task 5: Contas a receber, relatórios, registro, módulo e prompt

**Files:** Create `finance-tools.ts`, `report-tools.ts`; Modify `tools/index.ts`, `assistant.module.ts`, `finance/finance.module.ts`, `prompt.ts`, `backend/tests/nero-company-links.test.ts`; Tests `backend/tests/nero-finance-report-tools.test.ts`, `backend/tests/nero-read-flow.test.ts`

- [ ] **Step 1: `finance-tools.ts`**

```ts
// backend/src/assistant/tools/finance-tools.ts
import { z } from 'zod';
import type { FinanceReadService } from '../../finance/finance-read.service.js';
import { money } from '../nero-format.js';
import { rules } from '../nero-policy.js';
import { compactList, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

const BASIS = { VENDA: 'SALE', VENCIMENTO: 'DUE', RECEBIMENTO: 'RECEIPT' } as const;
const SETTLEMENT = { TODAS: 'ALL', PENDENTES: 'PENDING', PARCIAIS: 'PARTIAL', PAGAS: 'PAID' } as const;
const OVERDUE = { TODAS: 'ALL', SO_VENCIDAS: 'ONLY', SEM_VENCIDAS: 'EXCLUDE' } as const;
const schema = z.object({
  periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(),
  base: z.enum(['VENDA', 'VENCIMENTO', 'RECEBIMENTO']), situacao: z.enum(['TODAS', 'PENDENTES', 'PARCIAIS', 'PAGAS']),
  vencidas: z.enum(['TODAS', 'SO_VENCIDAS', 'SEM_VENCIDAS']), busca: z.string().trim().min(1).max(100).nullable(),
}).strict();

export function createReceivablesTool(finance: FinanceReadService): ReadTool {
  return {
    kind: 'READ', name: 'contas_a_receber', allowed: rules.anyMember,
    description: 'Contas a receber das vendas confirmadas: total original, recebido, a receber e vencido, e as vendas com parcelas. Para "o que vence este mês" use base VENCIMENTO; para "o que entrou" use base RECEBIMENTO; para atrasados use vencidas SO_VENCIDAS.',
    parameters: {
      type: 'object',
      properties: {
        ...periodProperties,
        base: { type: 'string', enum: ['VENDA', 'VENCIMENTO', 'RECEBIMENTO'] },
        situacao: { type: 'string', enum: ['TODAS', 'PENDENTES', 'PARCIAIS', 'PAGAS'] },
        vencidas: { type: 'string', enum: ['TODAS', 'SO_VENCIDAS', 'SEM_VENCIDAS'] },
        busca: { type: ['string', 'null'], description: 'Cliente ou número do pedido.' },
      },
      required: ['periodo', 'inicio', 'fim', 'base', 'situacao', 'vencidas', 'busca'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const range = resolvePeriod(args, ctx.today, { allowNone: true });
      const filters = {
        dateBasis: BASIS[args.base], settlement: SETTLEMENT[args.situacao], overdue: OVERDUE[args.vencidas],
        ...(range ? { dateFrom: range.from, dateTo: range.to } : {}),
        ...(args.busca ? (/^\d{5}$/.test(args.busca) ? { orderCode: args.busca } : { search: args.busca }) : {}),
      };
      const [summary, page] = await Promise.all([finance.summary(ctx.companyId, filters), finance.list(ctx.companyId, { ...filters, limit: 10 })]);
      const rows = page.items.map((sale) => ({
        pedido: sale.orderCode, cliente: sale.customerName, total: sale.totalAmount, recebido: sale.paidAmount, restante: sale.remainingAmount,
        parcelas: sale.payments.map((payment) => ({ numero: payment.number, forma: payment.paymentMethod, valor: payment.originalAmount, vencimento: payment.dueOn, restante: payment.remainingAmount, situacao: payment.settlement, vencida: payment.isOverdue })),
      }));
      return {
        output: { periodo: range ?? 'sem filtro de data', resumo: { vendas: summary.saleCount, parcelas: summary.paymentCount, original: summary.originalAmount, recebido: summary.paidAmount, aReceber: summary.remainingAmount, vencido: summary.overdueAmount }, ...compactList(rows), haMais: Boolean(page.nextCursor) },
        memory: `Contas a receber${range ? ` (${args.base.toLowerCase()} de ${range.from} a ${range.to})` : ''}: a receber ${money(summary.remainingAmount)}, vencido ${money(summary.overdueAmount)}, recebido ${money(summary.paidAmount)}.`,
      };
    },
  };
}
```

Conferir os campos reais do grupo devolvido por `FinanceReadService.list` (`orderCode`, `customerName`, `payments[]` etc. em `finance-read.service.ts`) e ajustar, relatando. Em `finance/finance.module.ts`, acrescentar `exports: [FinanceReadService]`.

- [ ] **Step 2: `report-tools.ts`**

```ts
// backend/src/assistant/tools/report-tools.ts
import { z } from 'zod';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import type { ReportType } from '../../reports/reports.schemas.js';
import { rules } from '../nero-policy.js';
import { compact, compactList, parseToolArgs, PERIOD_VALUES, periodProperties, resolvePeriod } from './read-support.js';
import type { ReadTool } from './types.js';

const TYPES: Record<string, { type: ReportType; label: string; catalog: boolean }> = {
  servicos_fechados: { type: 'closed-services', label: 'Serviços fechados', catalog: false },
  recebimentos: { type: 'service-receipts', label: 'Recebimentos', catalog: false },
  entradas_de_leads: { type: 'lead-entries', label: 'Entradas de leads', catalog: false },
  clientes: { type: 'customers', label: 'Clientes', catalog: true },
  catalogo_de_servicos: { type: 'service-catalog', label: 'Catálogo de serviços', catalog: true },
  reunioes: { type: 'meetings', label: 'Reuniões', catalog: false },
  taxa_de_desqualificacao: { type: 'disqualification-rate', label: 'Taxa de desqualificação', catalog: false },
  taxa_de_perda: { type: 'loss-rate', label: 'Taxa de perda', catalog: false },
};
const NAMES = Object.keys(TYPES) as [string, ...string[]];
const schema = z.object({ tipo: z.enum(NAMES), periodo: z.enum(PERIOD_VALUES), inicio: z.string().nullable(), fim: z.string().nullable(), busca: z.string().trim().min(1).max(200).nullable() }).strict();

export function createReportTool(reports: ReportsReadService): ReadTool {
  return {
    kind: 'READ', name: 'relatorio', allowed: rules.anyMember,
    description: 'Lê um dos relatórios do GestãoNF: servicos_fechados, recebimentos, entradas_de_leads, clientes, catalogo_de_servicos, reunioes, taxa_de_desqualificacao, taxa_de_perda. Os dois catálogos aceitam SEM_PERIODO; os demais exigem período. Respeita o que o usuário pode ver no CRM.',
    parameters: {
      type: 'object',
      properties: { tipo: { type: 'string', enum: NAMES }, ...periodProperties, busca: { type: ['string', 'null'] } },
      required: ['tipo', 'periodo', 'inicio', 'fim', 'busca'], additionalProperties: false,
    },
    async run(ctx, raw) {
      const args = parseToolArgs(schema, raw);
      const definition = TYPES[args.tipo];
      const range = resolvePeriod(args, ctx.today, { allowNone: definition.catalog });
      const result = await reports.read({ companyId: ctx.companyId, userId: ctx.userId }, definition.type, {
        limit: 10, status: 'ALL', ...(range ? { from: range.from, to: range.to } : {}), ...(args.busca ? { search: args.busca } : {}),
      });
      return {
        output: { relatorio: definition.label, periodo: range ?? 'sem filtro de data', visibilidade: result.visibility === 'ASSIGNED' ? 'somente o que é seu' : 'empresa', resumo: compact(result.summary), ...compactList(result.items), haMais: Boolean(result.nextCursor) },
        memory: `Relatório ${definition.label}${range ? ` de ${range.from} a ${range.to}` : ''}: ${JSON.stringify(compact(result.summary)).slice(0, 200)}`,
      };
    },
  };
}
```

- [ ] **Step 3: Registro e módulo**

```ts
// backend/src/assistant/tools/index.ts
import type { DatabaseService } from '../../database/database.module.js';
import type { CustomersService } from '../../customers/customers.service.js';
import type { FinanceReadService } from '../../finance/finance-read.service.js';
import type { ReportsReadService } from '../../reports/reports-read.service.js';
import type { SalesService } from '../../sales/sales.service.js';
import type { ServicesService } from '../../services/services.service.js';
import { createCustomerSearchTool, createServiceSearchTool } from './catalog-tools.js';
import { createReceivablesTool } from './finance-tools.js';
import { ToolRegistry } from './registry.js';
import { createReportTool } from './report-tools.js';
import { createSaleDetailTool, createSalesListTool } from './sales-tools.js';
import { newTopicTool, switchCompanyTool } from './session-tools.js';

export type ReadServices = { customers: CustomersService; services: ServicesService; sales: SalesService; finance: FinanceReadService; reports: ReportsReadService };

/** Registro padrão. Fases seguintes acrescentam operações WRITE aqui. */
export function createToolRegistry(database: DatabaseService, readers: ReadServices) {
  return new ToolRegistry()
    .registerRead(createCustomerSearchTool(readers.customers))
    .registerRead(createServiceSearchTool(readers.services))
    .registerRead(createSalesListTool(database.db, readers.sales))
    .registerRead(createSaleDetailTool(readers.sales))
    .registerRead(createReceivablesTool(readers.finance))
    .registerRead(createReportTool(readers.reports))
    .registerRead(switchCompanyTool)
    .registerRead(newTopicTool);
}
```

Em `assistant.module.ts`: importar `CustomersModule`, `ServicesModule`, `SalesModule`, `FinanceModule`, `ReportsModule` e trocar o provider do registro por:

```ts
    {
      provide: ToolRegistry,
      useFactory: (database: DatabaseService, customers: CustomersService, services: ServicesService, sales: SalesService, finance: FinanceReadService, reports: ReportsReadService) =>
        createToolRegistry(database, { customers, services, sales, finance, reports }),
      inject: [DatabaseService, CustomersService, ServicesService, SalesService, FinanceReadService, ReportsReadService],
    },
```

Validar o bootstrap do worker: script temporário no scratchpad com `NestFactory.createApplicationContext(WorkerModule, { logger: false })` seguido de `app.get(ToolRegistry)` e `app.close()` **sem** chamar `init` dos workers (usar `NestFactory.create...` com `{ abortOnError: false }` e fechar logo) — ou rodar o `npm run backend:typecheck` e um teste que instancie o `AssistantModule` via `Test.createTestingModule` se o pacote `@nestjs/testing` existir. Relatar como validou.

- [ ] **Step 4: Prompt** — em `prompt.ts`, na seção "Conversa", acrescentar e incrementar `NERO_PROMPT_VERSION` (ex.: `2026-11-11.1`):

```ts
    '- Para responder perguntas sobre clientes, serviços, vendas, contas a receber e relatórios, use as ferramentas de consulta. Escolha o período a partir do que o usuário disse ("hoje", "esta semana" = ULTIMOS_7_DIAS, "este mês", "mês passado") e, se ele não disser, pergunte ou use o mês atual quando fizer sentido.',
    '- Resuma o resultado em poucas linhas: totais primeiro, depois no máximo 5 itens. Se houver mais, diga quantos e ofereça filtrar. Pedidos são citados pelo número de 5 dígitos.',
```

- [ ] **Step 5: Teste permanente** — em `backend/tests/nero-company-links.test.ts`, passar os leitores ao registro (só construção, sem novos casos):

```ts
import { CustomersService } from '../src/customers/customers.service.js';
import { ServicesService } from '../src/services/services.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import { FinanceReadService } from '../src/finance/finance-read.service.js';
import { ReportsReadService } from '../src/reports/reports-read.service.js';
import { CrmPolicyService } from '../src/crm/crm-policy.service.js';
import type { FilesService } from '../src/files/files.service.js';
import type { FiscalService } from '../src/fiscal/fiscal.service.js';
// ...
  const registry = createToolRegistry(database, {
    customers: new CustomersService(database), services: new ServicesService(database),
    sales: new SalesService(database, {} as FilesService, {} as FiscalService),
    finance: new FinanceReadService(database), reports: new ReportsReadService(database, new CrmPolicyService(database)),
  });
```

- [ ] **Step 6: Testes** — `nero-finance-report-tools.test.ts`:
  - `contas_a_receber { periodo: 'SEM_PERIODO', base: 'VENDA', situacao: 'TODAS', vencidas: 'TODAS', busca: null }` sobre a venda de R$ 5.000 (metade recebida) → `aReceber '2500.00'`, `recebido '2500.00'`;
  - `vencidas: 'SO_VENCIDAS'` com a parcela vencendo no futuro → `vencido '0.00'`;
  - `relatorio { tipo: 'servicos_fechados', periodo: 'ESTE_MES' }` traz a venda; `tipo: 'clientes', periodo: 'SEM_PERIODO'` funciona; `tipo: 'reunioes', periodo: 'SEM_PERIODO'` → `BadRequestException`;
  - escopo CRM: um COLLABORATOR em `relatorio { tipo: 'entradas_de_leads' }` recebe `visibilidade: 'somente o que é seu'`.

  `nero-read-flow.test.ts` (com `ScriptedModel` e `NiloService` montado como no teste permanente):
  - "quanto vendi este mês?" → o roteiro chama `consultar_vendas` e responde; a memória `"Vendas de … confirmadas, total …"` entra no histórico (`nero_messages` TOOL);
  - "e quanto falta receber?" no turno seguinte → o modelo recebe a memória da consulta anterior no input;
  - catálogo do modelo inclui as 6 ferramentas novas e não inclui `get_sales_report`.

- [ ] **Step 7:** Rodar todos os `tests/nero-`, `nero-company-links` e `npm run backend:typecheck`. Sem commit.

---

### Task 6: Avaliação real, verificação e limpeza

- [ ] **Step 1: Avaliação** `backend/tests/nero-read-eval.live.test.ts` (só com `NERO_LIVE_EVAL=1`), usando `OpenAINeroModel` real, `NiloService` e a fixture com dados semeados (cliente Roberto Almeida, serviço Criação de site, venda confirmada de R$ 5.000,00 em `ctx.today` do mês atual com metade recebida e metade vencendo no mês seguinte, mais uma venda de R$ 1.200,00 a outro cliente). Cenários, um evento de texto cada, conferindo a resposta enviada:
  1. "Quanto vendi este mês?" → resposta contém "6.200" (R$ 6.200,00); `assistant_actions` com `consultar_vendas`.
  2. "Quanto ainda falta receber?" → contém "2.500"; usou `contas_a_receber`.
  3. "Me mostra o pedido <nº da venda do Roberto>" → contém "Roberto" e "2.500"; usou `consultar_venda`.
  4. "O Roberto Almeida está cadastrado? Qual o telefone dele?" → contém "99999" ou "9999-0000"; usou `buscar_clientes`.
  5. "Quais serviços eu tenho no catálogo?" → contém "Criação de site".
  6. "Me dá o relatório de serviços fechados do mês" → usou `relatorio`; contém "Roberto".
  Em todas: sem UUID, sem nome de ferramenta, sem "AAAA-MM-DD".
  Run: `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && NERO_LIVE_EVAL=1 npm exec -w backend -- vitest run tests/nero-read-eval.live.test.ts --silent=false --reporter=verbose`. Registrar as respostas. Falha de comportamento → ajustar só `prompt.ts` ou as descrições das ferramentas (incrementando a versão do prompt), no máximo 3 rodadas, sem afrouxar asserções.

- [ ] **Step 2: Verificação** — todos os `tests/nero-`, `npm run backend:test`, `npm run backend:typecheck && npm run frontend:typecheck`.

- [ ] **Step 3: Limpeza** — apagar `backend/tests/nero-fixture.ts`, `nero-fixture.test.ts`, `nero-read-support.test.ts`, `nero-catalog-tools.test.ts`, `nero-sales-tools.test.ts`, `nero-finance-report-tools.test.ts`, `nero-read-flow.test.ts`, `nero-read-eval.live.test.ts`; `test-results`/`coverage`; conferir bancos `gestaonf_nero_test_*` = 0. Rodar `npm run backend:test` e os typechecks de novo. Sem commit.
