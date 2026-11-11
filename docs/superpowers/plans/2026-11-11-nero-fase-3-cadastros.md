# Nero — Fase 3: Cadastros — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).
>
> **Regras do projeto para todas as tarefas:**
> - **Nunca fazer `git commit`, `git add` ou `git rm`.** Tudo fica no working tree.
> - **Testes temporários** (`ArquivosMD/procedimento-padrao-testes.md`): apagados na Task 6. O teste permanente `backend/tests/nero-company-links.test.ts` não muda nesta fase (salvo se a assinatura do registro mudar — não deve).
> - Português do Brasil em textos e comentários.
> - **Comando de teste** (quirk do Windows — use exatamente este `cd`):
>   `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && npm exec -w backend -- vitest run tests/<arquivo>.test.ts`
>   O "No test files found" do workspace `backend/database` é ruído.
> - Nunca subir o `WorkerModule` inteiro para validar DI (dispara workers contra o banco de dev); use um módulo com `DatabaseModule` + `AssistantModule`.

**Goal:** O Nero cria e altera clientes e serviços pelo WhatsApp, com um único resumo e uma única confirmação para vários cadastros (ex.: alterar 1 + criar 2), usando as mesmas validações do site (CPF/CNPJ com dígito verificador, duplicidade de CPF/CNPJ e de código interno, regras fiscais) e explicando qualquer recusa em linguagem simples.

**Architecture:** Quatro operações `WRITE` (`criar_cliente`, `alterar_cliente`, `criar_servico`, `alterar_servico`) registradas no `ToolRegistry` e oferecidas ao modelo pela ferramenta `propor_operacoes` (Fase 0). Cada operação valida os argumentos com os schemas de domínio já existentes (`createCustomerSchema`, `updateCustomerSchema`, `createServiceSchema`, `updateServiceSchema`) e grava pelos serviços de domínio dentro da transação do lote, via novos métodos `updateInTx` (e os `createInTx` existentes). O ensaio da proposta (transação revertida) passa a poder devolver a **linha do resumo** já com dados do banco (ex.: "Telefone: (61) 9999-0000 → (61) 98888-7777"), mantendo o resumo determinístico. Spec: `docs/superpowers/specs/2026-11-10-nero-agente-secretario-design.md`, seções 6.2, 6.3, 7 e 10.

**Tech Stack:** NestJS 12, Drizzle 0.45 + PostgreSQL 17, Zod 4, OpenAI Responses API, Vitest 5.

---

## Decisões

- **Permissões:** as mesmas do site — qualquer membro ativo cria e altera clientes e serviços (`rules.anyMember`). Inativar é uma alteração (`status`), como no site.
- **Campos aceitos:** os mesmos do formulário da web, com as chaves dos schemas de domínio (em inglês) descritas em português ao modelo. Mínimo para cliente: `kind` (PF/PJ) e `name`; para serviço: `name`.
- **Duplicidade:** CPF/CNPJ e código interno únicos (índices existentes) → `ConflictException` com a mensagem do site ("CPF/CNPJ já cadastrado nesta empresa" / "Código interno já cadastrado nesta empresa"), detectada já no ensaio. Nomes repetidos não são bloqueados pelo sistema; o prompt manda buscar antes de criar e perguntar se o cliente já existe.
- **Resumo:** criação lista os dados informados; alteração mostra "campo: antes → depois" só dos campos que mudam. Rótulos de campo em português.
- **Lote atômico** já garantido pela Fase 0: se uma operação falha na confirmação, nada é gravado.

---

## Mapa de arquivos

| Arquivo | Ação |
| --- | --- |
| `backend/src/customers/customers.service.ts` | Modificar: `updateInTx`; `update` passa a usá-lo |
| `backend/src/services/services.service.ts` | Modificar: `updateInTx`; `update` passa a usá-lo |
| `backend/src/assistant/tools/types.ts` | Modificar: `execute` pode devolver `summary` |
| `backend/src/assistant/actions/action.service.ts` | Modificar: usar `summary` do ensaio quando houver |
| `backend/src/assistant/tools/write-support.ts` | Criar: rótulos de campos, formatação de valores, `describeCreate`, `describeChanges`, `uniqueAsConflict` |
| `backend/src/assistant/tools/customer-operations.ts` | Criar: `criar_cliente`, `alterar_cliente` |
| `backend/src/assistant/tools/service-operations.ts` | Criar: `criar_servico`, `alterar_servico` |
| `backend/src/assistant/tools/index.ts` | Modificar: registrar as 4 operações |
| `backend/src/assistant/prompt.ts` | Modificar: orientação de cadastros; nova versão |
| `backend/tests/nero-*.test.ts`, `nero-fixture.ts` | Criar (temporários) |

---

### Task 1: Fixture temporária

**Files:** Create `backend/tests/nero-fixture.ts`, `backend/tests/nero-fixture.test.ts`

- [ ] **Step 1:** Recriar a fixture da Fase 2 (ver `docs/superpowers/plans/2026-11-11-nero-fase-2-leituras.md`, Task 1, e o que a Fase 2 efetivamente usou: `createNeroTestEnv`, `randomSender`, `seedOperator`, `insertInbound`, `readServices`, `activeConversation`, `contextFor`, `ScriptedModel`, `say`, `callTool`, `seenText`), acrescentando:

```ts
/** Payload de clique em botão, no formato do webhook da Meta. */
export const buttonPayload = (id: string, title: string) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title } } });

/** CPF e CNPJ válidos (dígitos verificadores corretos) para testes. */
export const VALID_CPF = '52998224725';
export const VALID_CPF_2 = '11144477735';
export const VALID_CNPJ = '11222333000181';

/** NiloService completo sobre o banco temporário, com o modelo informado e o registro padrão. */
export function buildNero(env: NeroTestEnv, model: NeroModel) { /* monta registry = createToolRegistry(env.database, readServices(env)), ActionService, ConversationService, AgentOrchestrator(env.database, model, registry, actions), WhatsAppOutboundService, AudioTranscriptionService(env.database, new MetaMediaClient(), new OpenAITranscriber()) e devolve { nero, registry, actions } */ }
```

Implementar `buildNero` de verdade (o comentário acima descreve o conteúdo) conferindo as assinaturas reais em `backend/src/assistant/*` e no teste permanente `backend/tests/nero-company-links.test.ts`.

- [ ] **Step 2:** Teste de fumaça: `seedOperator` + `buildNero(env, new ScriptedModel([say('oi')]))` processa um inbound "olá" e grava 1 mensagem de saída. Rodar até passar. Sem commit.

---

### Task 2: `updateInTx` nos serviços de domínio

**Files:** Modify `backend/src/customers/customers.service.ts`, `backend/src/services/services.service.ts`; Test `backend/tests/nero-domain-intx.test.ts`

- [ ] **Step 1: Testes**

```ts
// backend/tests/nero-domain-intx.test.ts — TEMPORÁRIO
// Cenários (banco temporário via fixture):
// 1. customers.updateInTx dentro de uma transação revertida não persiste (rollback manual com erro sentinela).
// 2. customers.update (API) continua: altera telefone; CPF inválido → BadRequestException('CPF inválido'); CPF de outro cliente → ConflictException('CPF/CNPJ já cadastrado nesta empresa'); id de outra empresa → NotFoundException.
// 3. services.updateInTx idem; código interno repetido → ConflictException('Código interno já cadastrado nesta empresa').
// 4. updateInTx devolve { before, after } com as linhas antes e depois.
```

Escrever os testes concretos para os 4 cenários (usar `VALID_CPF`/`VALID_CPF_2`).

- [ ] **Step 2: `CustomersService.updateInTx`**

```ts
  /** Altera dentro da transação recebida; devolve a linha antes e depois. Duplicidade vira ConflictException. */
  async updateInTx(db: DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0], companyId: string, id: string, input: UpdateCustomer) {
    const [existing] = await db.select().from(customers).where(and(eq(customers.companyId, companyId), eq(customers.id, id))).for('update');
    if (!existing) throw new NotFoundException('Cliente não encontrado');
    const merged = { ...existing, ...input };
    if (merged.kind !== 'PF' && merged.kind !== 'PJ') throw new BadRequestException('Tipo inválido');
    validateCustomerTaxId(merged.kind, merged.taxId, merged.tradeName);
    this.validateFiscalData(merged);
    try {
      const [customer] = await db.update(customers).set({ ...input, updatedAt: new Date() })
        .where(and(eq(customers.companyId, companyId), eq(customers.id, id))).returning();
      return { before: existing, after: customer };
    } catch (error) {
      if (isUniqueViolation(error)) throw new ConflictException('CPF/CNPJ já cadastrado nesta empresa');
      throw error;
    }
  }

  async update(companyId: string, id: string, input: UpdateCustomer) {
    return (await this.database.db.transaction((tx) => this.updateInTx(tx, companyId, id, input))).after;
  }
```

E em `createInTx`, envolver o insert no mesmo `try/catch` de unicidade (lançando a `ConflictException`), mantendo `create` como está (o catch externo fica redundante mas inofensivo — pode ser removido).

- [ ] **Step 3: `ServicesService.updateInTx`** — mesmo padrão: `select ... for('update')` para obter `before` (NotFound se não existir), `update ... returning`, `ConflictException('Código interno já cadastrado nesta empresa')` em unicidade, devolve `{ before: withFiscalClassification(before), after: withFiscalClassification(after) }`; `update` chama dentro de transação e devolve `after`. `createInTx` com o mesmo `try/catch` de unicidade.

- [ ] **Step 4:** Rodar até passar; `npm run backend:typecheck`. Sem commit.

---

### Task 3: Resumo vindo do ensaio

**Files:** Modify `backend/src/assistant/tools/types.ts`, `backend/src/assistant/actions/action.service.ts`; Test `backend/tests/nero-action-summary.test.ts`

- [ ] **Step 1:** Em `types.ts`, o retorno de `execute` passa a ser `{ entityId: string | null; label: string; summary?: string }`, com o comentário: "`summary`: linha do resumo calculada no ensaio (com dados do banco); se ausente, usa `summarize`."

- [ ] **Step 2:** Em `ActionService.propose`, guardar os resultados do ensaio (não só os rótulos) e montar as linhas assim:

```ts
    const lines = operations.map((operation, index) => dryResults[index]?.summary ?? this.registry.write(operation.tool)!.summarize(operation.args, labels));
```

- [ ] **Step 3: Teste** — uma operação fictícia (registrada só no teste) que devolve `summary: 'Telefone: A → B'` no ensaio aparece exatamente assim no resumo; outra sem `summary` continua usando `summarize`. Rodar até passar; typecheck. Sem commit.

---

### Task 4: Operações de cliente e serviço

**Files:** Create `write-support.ts`, `customer-operations.ts`, `service-operations.ts`; Modify `tools/index.ts`; Test `backend/tests/nero-write-operations.test.ts`

- [ ] **Step 1: `write-support.ts`**

```ts
// backend/src/assistant/tools/write-support.ts
import { money } from '../nero-format.js';
import { label } from './read-support.js';

/** Rótulos em português dos campos de cliente e serviço (chaves dos schemas de domínio). */
export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo', name: 'Nome', tradeName: 'Nome fantasia', taxId: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', notes: 'Observações', status: 'Situação',
  street: 'Rua', number: 'Número', complement: 'Complemento', district: 'Bairro', postalCode: 'CEP', cityName: 'Cidade', cityIbgeCode: 'Código IBGE da cidade',
  stateCode: 'UF', countryCode: 'País', municipalRegistration: 'Inscrição municipal', caepfCode: 'CAEPF', foreignTaxId: 'Documento estrangeiro',
  noForeignTaxIdReason: 'Motivo sem documento estrangeiro', foreignPostalCode: 'CEP estrangeiro', foreignStateProvince: 'Estado/província estrangeiro',
  internalCode: 'Código interno', description: 'Descrição', unitLabel: 'Unidade', suggestedUnitPrice: 'Preço sugerido', nationalTaxCode: 'Código de tributação nacional',
  nbsCode: 'Código NBS', simplesActivityCode: 'Anexo do Simples',
};

const PRICE_FIELDS = new Set(['suggestedUnitPrice']);

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (PRICE_FIELDS.has(field)) return money(String(value));
  if (field === 'taxId') return formatTaxId(String(value));
  return label(String(value));
}

export function formatTaxId(value: string) {
  const digits = value.replace(/\W/g, '');
  if (/^\d{11}$/.test(digits)) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (/^[A-Z0-9]{12}\d{2}$/i.test(digits)) return digits.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, '$1.$2.$3/$4-$5');
  return value;
}

/** "Nome: X · Telefone: Y" dos campos informados (ignora vazios e status padrão). */
export function describeFields(values: Record<string, unknown>, skip: string[] = []) {
  return Object.entries(values).filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined && value !== '' && FIELD_LABELS[key])
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, value)}`).join(' · ');
}

/** Só os campos que mudam: "Telefone: A → B". */
export function describeChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  const parts = Object.entries(changes).filter(([key, value]) => FIELD_LABELS[key] && (before[key] ?? null) !== (value ?? null))
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, before[key])} → ${formatValue(key, value)}`);
  return parts.length ? parts.join(' · ') : 'nenhuma mudança';
}
```

Conferir se `label()` de `read-support.ts` traduz `PF`/`PJ`/`ACTIVE`/`INACTIVE` (a Fase 2 criou o mapa) e acrescentar o que faltar.

- [ ] **Step 2: `customer-operations.ts`**

```ts
// backend/src/assistant/tools/customer-operations.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import type { CustomersService } from '../../customers/customers.service.js';
import { createCustomerSchema, updateCustomerSchema } from '../../customers/customers.schemas.js';
import { rules } from '../nero-policy.js';
import type { WriteOperation } from './types.js';
import { describeChanges, describeFields } from './write-support.js';

const CUSTOMER_FIELDS = 'kind ("PF" ou "PJ", obrigatório na criação), name (obrigatório na criação), tradeName (só PJ), taxId (CPF ou CNPJ, só dígitos), email, phone, notes, status ("ACTIVE"/"INACTIVE"), street, number, complement, district, postalCode, cityName, cityIbgeCode, stateCode, countryCode';

export function createCustomerOperation(customers: CustomersService): WriteOperation<z.output<typeof createCustomerSchema>> {
  return {
    kind: 'WRITE', name: 'criar_cliente', allowed: rules.anyMember,
    description: `Cadastra um cliente. dados: {${CUSTOMER_FIELDS}}. Antes de criar, busque com buscar_clientes para não duplicar. CPF/CNPJ é opcional.`,
    schema: createCustomerSchema,
    summarize: (args) => `Novo cliente: ${describeFields(args, ['status'])}`,
    async execute(tx, ctx, args) {
      const customer = await customers.createInTx(tx, ctx.companyId, ctx.userId, args);
      return { entityId: customer.id, label: `Cliente ${customer.name}`, summary: `Novo cliente: ${describeFields(customer, ['status', 'countryCode'])}` };
    },
  };
}

const updateArgs = z.object({ id: z.uuid(), alteracoes: updateCustomerSchema }).strict();

export function updateCustomerOperation(customers: CustomersService): WriteOperation<z.output<typeof updateArgs>> {
  return {
    kind: 'WRITE', name: 'alterar_cliente', allowed: rules.anyMember,
    description: `Altera um cliente existente. dados: {"id": id do cliente vindo de buscar_clientes (ou {"$ref": n} de um cliente criado no mesmo lote), "alteracoes": {só os campos que mudam: ${CUSTOMER_FIELDS}}}. Para inativar use status "INACTIVE".`,
    schema: updateArgs,
    summarize: (args) => `Alterar cliente: ${describeFields((args.alteracoes ?? {}) as Record<string, unknown>)}`,
    async execute(tx, ctx, args) {
      const { before, after } = await customers.updateInTx(tx, ctx.companyId, args.id, args.alteracoes);
      const changes = describeChanges(before, args.alteracoes);
      if (changes === 'nenhuma mudança') throw new BadRequestException(`Os dados informados já são os atuais do cliente ${before.name}`);
      return { entityId: after.id, label: `Cliente ${after.name}`, summary: `Alterar cliente ${before.name}: ${changes}` };
    },
  };
}
```

- [ ] **Step 3: `service-operations.ts`** — mesmo padrão com `createServiceSchema`/`updateServiceSchema`, `ServicesService.createInTx`/`updateInTx`, nomes `criar_servico`/`alterar_servico`, campos `name (obrigatório na criação), internalCode, description, unitLabel, suggestedUnitPrice (ex.: "5000.00"), nationalTaxCode (6 dígitos), nbsCode (9 dígitos), simplesActivityCode, status`, descrição "Antes de criar, busque com buscar_servicos para não duplicar.", resumo `Novo serviço: …` / `Alterar serviço <nome>: …`, rótulo `Serviço <nome>`.

- [ ] **Step 4: Registro** — em `tools/index.ts`, acrescentar ao `ReadServices` nada de novo (os serviços já estão lá) e registrar:

```ts
    .registerWrite(createCustomerOperation(readers.customers))
    .registerWrite(updateCustomerOperation(readers.customers))
    .registerWrite(createServiceOperation(readers.services))
    .registerWrite(updateServiceOperation(readers.services))
```

- [ ] **Step 5: Testes** (`ActionService` + operações reais sobre o banco temporário):
  1. Lote "alterar 1 + criar 2" (cliente existente com telefone A; criar Ana PF com `VALID_CPF`; criar serviço "Criação de site" com preço `5000.00`): ensaio não grava; resumo único contém `Alterar cliente Roberto Almeida: Telefone: … → …`, `Novo cliente: Tipo: Pessoa física · Nome: Ana … · CPF/CNPJ: 529.982.247-25` e `Novo serviço: … Preço sugerido: R$ 5.000,00`; `confirm` grava os três; segundo `confirm` → `ALREADY_EXECUTED`.
  2. CPF inválido (`12345678900`) → proposta recusada com `cause.message 'CPF inválido'` e `operationIndex` certo; nada gravado.
  3. CPF já usado por outro cliente → `kind 'CONFLICT'`, mensagem "CPF/CNPJ já cadastrado nesta empresa".
  4. Código interno repetido em serviço → "Código interno já cadastrado nesta empresa".
  5. `$ref`: criar cliente e alterar o mesmo cliente no lote (`id: {"$ref": 0}`) funciona.
  6. Alteração sem mudança real → recusada com "Os dados informados já são os atuais…".
  7. Falha na execução (outro processo grava o mesmo CPF entre a proposta e a confirmação) → `FAILED`, `CONFLICT`, nada gravado do lote.
  8. Isolamento: `alterar_cliente` com id de cliente de outra empresa → `NotFoundException` (VALIDATION com "Cliente não encontrado").
  9. COLLABORATOR também cria (permissão igual ao site).

Rodar até passar; typecheck. Sem commit.

---

### Task 5: Prompt e fluxo completo

**Files:** Modify `backend/src/assistant/prompt.ts`; Test `backend/tests/nero-write-flow.test.ts`

- [ ] **Step 1: Prompt** — na seção "Gravações" (quando `canWrite`), acrescentar e incrementar `NERO_PROMPT_VERSION`:

```ts
      '- Cadastros: antes de criar cliente ou serviço, procure com buscar_clientes/buscar_servicos. Se já existir algo parecido, pergunte se é o mesmo antes de criar outro.',
      '- Para cadastrar cliente basta tipo (pessoa física ou jurídica) e nome; CPF/CNPJ, telefone e e-mail são opcionais — peça só se o usuário quiser informar. Para alterar, use o cliente/serviço encontrado na busca e mande só os campos que mudam.',
      '- Se o usuário pedir vários cadastros e alterações de uma vez, junte tudo em uma única proposta.',
```

Remover/ajustar a linha antiga que dizia "Nesta versão você ainda não grava dados pelo WhatsApp" — ela só aparece quando não há operações de escrita (`canWrite` falso), então continua válida para usuários sem permissão; manter.

- [ ] **Step 2: Testes de fluxo** (`buildNero` + `ScriptedModel`):
  1. "cadastra o cliente Ana Souza, CPF 529.982.247-25" → roteiro: `buscar_clientes` (nada) → `propor_operacoes` com `criar_cliente` → mensagem INTERACTIVE com o resumo e botões; tocar Confirmar → cliente gravado e resposta "✅ Pronto! Gravei…: • Cliente Ana Souza".
  2. CPF inválido no roteiro → o modelo recebe a recusa ("CPF inválido") e responde pedindo o CPF certo; nada gravado.
  3. Lote alterar 1 + criar 2 com uma única mensagem de confirmação e uma única gravação.
  4. "Corrigir" após a proposta → proposta SUPERSEDED, modelo pergunta o que mudar; nova proposta substitui.

Rodar todos os `tests/nero-` e typecheck. Sem commit.

---

### Task 6: Avaliação real, verificação e limpeza

- [ ] **Step 1: Avaliação** `backend/tests/nero-write-eval.live.test.ts` (só com `NERO_LIVE_EVAL=1`), com `OpenAINeroModel` real e `buildNero`; cada cenário com operador novo:
  1. "Cadastra o cliente Ana Souza, pessoa física, CPF 529.982.247-25, telefone 61 98888-7777" → última mensagem é INTERACTIVE, resumo contém "Ana Souza" e "529.982.247-25"; simular o clique em Confirmar (evento com `buttonPayload` do primeiro botão) → cliente existe no banco com esse CPF.
  2. Cliente "Roberto Almeida" semeado com telefone 61999990000. "O telefone do Roberto mudou para 61 97777-6666" → resumo contém "Roberto Almeida" e "→"; confirmar → telefone alterado.
  3. "Cadastra o cliente João Lima com CPF 123.456.789-00" → resposta em TEXTO (sem proposta) explicando que o CPF é inválido; nada gravado.
  4. "Cadastra o serviço Manutenção mensal por 300 reais e o cliente Pedro Costa" → uma única proposta com as duas linhas.
  Em todas: sem UUID, sem nome de ferramenta.
  Run: `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && NERO_LIVE_EVAL=1 npm exec -w backend -- vitest run tests/nero-write-eval.live.test.ts --silent=false --reporter=verbose`. Registrar respostas. Falha de comportamento → ajustar só `prompt.ts`/descrições das operações (incrementando a versão), no máximo 3 rodadas, sem afrouxar asserções.

- [ ] **Step 2: Verificação** — todos os `tests/nero-`, `npm run backend:test`, `npm run backend:typecheck && npm run frontend:typecheck`.

- [ ] **Step 3: Limpeza** — apagar a fixture e todos os testes `nero-*` desta fase (exceto `nero-company-links.test.ts`), `test-results`/`coverage`; conferir bancos `gestaonf_nero_test_*` = 0 (se sobrar, `DROP DATABASE ... WITH (FORCE)` só desses). Sem commit.
