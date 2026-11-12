# Nero — Fase 4: Vendas — Plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development ou superpowers:executing-plans. Passos com checkbox (`- [ ]`).
>
> **Regras do projeto para todas as tarefas:**
> - **Nunca fazer `git commit`, `git add` ou `git rm`.** Tudo fica no working tree.
> - **Testes temporários** (`ArquivosMD/procedimento-padrao-testes.md`): apagados na Task 7. O teste permanente `backend/tests/nero-company-links.test.ts` só recebe o ajuste da construção do registro (novo serviço `payments`).
> - Português do Brasil em textos e comentários.
> - **Comando de teste** (quirk do Windows — use exatamente este `cd`):
>   `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && npm exec -w backend -- vitest run tests/<arquivo>.test.ts`
>   O "No test files found" do workspace `backend/database` é ruído.
> - Nunca subir o `WorkerModule` inteiro para validar DI; use um módulo com `DatabaseModule` + `AssistantModule`.
> - As mudanças em `SalesService`/`SalesPaymentsService` afetam a web: rodar `npm run backend:test` ao fim de cada task que tocar nelas.

**Goal:** O Nero lança vendas (já confirmadas), dá baixa em recebimentos, estorna recebimentos e cancela vendas pelo WhatsApp, sempre com resumo e uma única confirmação por lote, com as mesmas regras do site.

**Architecture:** Quatro operações `WRITE` novas (`criar_venda`, `baixar_recebimento`, `estornar_recebimento`, `cancelar_venda`) no `ToolRegistry`, oferecidas por `propor_operacoes`. Os comandos de domínio que hoje abrem a própria transação ganham variantes `…InTx` (`confirmInTx`, `cancelInTx`, `receiptInTx`, `reverseInTx`) e um composto `createConfirmedInTx` (rascunho + confirmação, com nova tentativa em savepoint se o número do pedido colidir). Baixa, estorno e cancelamento usam o controle de versão do lote (já existente para cadastros), que passa a aceitar uma chave por operação (`versionKey`) porque essas operações identificam o registro pelo número do pedido. Spec: `docs/superpowers/specs/2026-11-10-nero-agente-secretario-design.md`, seções 6.2, 6.3, 7, 10, **10.1** e 11.

**Tech Stack:** NestJS 12, Drizzle 0.45 (transações aninhadas = savepoints) + PostgreSQL 17, Zod 4, OpenAI Responses API, Vitest 5.

---

## Mapa de arquivos

| Arquivo | Ação |
| --- | --- |
| `backend/src/sales/sales.service.ts` | Modificar: `confirmInTx`, `cancelInTx`, `createConfirmedInTx`; `confirm`/`cancel` passam a usá-los |
| `backend/src/sales/sales-payments.service.ts` | Modificar: `receiptInTx`, `reverseInTx`; `receipt`/`reverse` passam a usá-los |
| `backend/src/sales/sales.module.ts` | Modificar: exportar `SalesPaymentsService` |
| `backend/src/assistant/tools/types.ts` | Modificar: `versionKey` na operação e no resultado |
| `backend/src/assistant/actions/action.service.ts` | Modificar: usar `versionKey` no controle de versão |
| `backend/src/assistant/tools/sale-support.ts` | Criar: normalização de valores/formas de pagamento, localização de pedido/parcela, formatação de resumo |
| `backend/src/assistant/tools/sale-operations.ts` | Criar: `criar_venda` |
| `backend/src/assistant/tools/payment-operations.ts` | Criar: `baixar_recebimento`, `estornar_recebimento`, `cancelar_venda` |
| `backend/src/assistant/tools/index.ts` | Modificar: `ReadServices.payments`; registrar as 4 operações |
| `backend/src/assistant/assistant.module.ts` | Modificar: injetar `SalesPaymentsService` |
| `backend/src/assistant/prompt.ts` | Modificar: orientação de vendas; nova versão |
| `backend/tests/nero-company-links.test.ts` | Modificar (permanente): `payments` na construção do registro |
| `backend/tests/nero-fixture.ts` + `nero-*.test.ts` | Criar (temporários) |

---

### Task 1: Fixture temporária

**Files:** Create `backend/tests/nero-fixture.ts`, `backend/tests/nero-fixture.test.ts`

- [x] **Step 1:** Recriar a fixture usada nas Fases 2 e 3 (`createNeroTestEnv`, `randomSender`, `seedOperator`, `insertInbound`, `readServices`, `activeConversation`, `contextFor`, `ScriptedModel`, `say`, `callTool`, `seenText`, `buttonPayload`, `VALID_CPF`, `buildNero`) conferindo as assinaturas reais em `backend/src/assistant/*` e no teste permanente. Acrescentar:
  - `readServices(env)` passa a incluir `payments: new SalesPaymentsService(env.database, sales)` (o `sales` com dublês `{ syncSaleInTx: async () => undefined }` e `{ resolveTax: async () => null }`, que são os únicos métodos de `FilesService`/`FiscalService` usados por `create`/`confirm`).
  - `seedBusiness(env, companyId, userId)` → cliente "Roberto Almeida" (PF, telefone `61999990000`) e serviço "Criação de site", com `createdByUserId`.
  - `seedConfirmedSale(env, companyId, userId, { customerId, serviceId, soldOn, total, receivedOn, dueOn })` pelo caminho real `SalesService.create` + `confirm`: duas parcelas que somam o total (segunda = total − primeira, em centavos), a primeira já recebida em `receivedOn` (com o `initialReceipts` montado a partir das parcelas com `initialReceivedOn`), a segunda vencendo em `dueOn`.

- [x] **Step 2:** Teste de fumaça: venda semeada fica `CONFIRMED` com parcelas `PAID` e `PENDING`; `buildNero` processa "olá" com `ScriptedModel([say('oi')])`. Rodar até passar. Sem commit.

---

### Task 2: Comandos de venda dentro da transação do lote

**Files:** Modify `sales.service.ts`, `sales-payments.service.ts`, `sales.module.ts`; Test `backend/tests/nero-sales-intx.test.ts`

- [x] **Step 1: Testes** (banco temporário):
  1. `createConfirmedInTx` dentro de uma transação revertida (erro sentinela) não deixa pedido; dentro de uma transação confirmada grava pedido `CONFIRMED`, recebíveis e o movimento inicial da parcela recebida.
  2. Colisão do número do pedido: com `orderCode` forçado (mock de `sales-codes.orderCode` via `vi.spyOn` no módulo, devolvendo primeiro um código já existente na empresa e depois um livre) o pedido é criado com o segundo código **e a transação externa continua utilizável** (prova do savepoint).
  3. `confirmInTx`, `cancelInTx`, `receiptInTx`, `reverseInTx` respeitam as mesmas regras e mensagens dos métodos públicos: valor acima do saldo → "Valor maior que o saldo pendente"; cancelamento com valor recebido → "Existem valores recebidos; regularize o financeiro antes de cancelar"; estorno duplicado → "Recebimento já estornado"; pedido de outra empresa → "Pedido não encontrado".
  4. Estorno + cancelamento do mesmo pedido na **mesma** transação funciona (o cancelamento enxerga o estorno).
  5. Os métodos públicos (`confirm`, `cancel`, `receipt`, `reverse`) continuam com o mesmo comportamento, inclusive a idempotência por chave de `receipt`/`reverse`.

- [x] **Step 2: `SalesService`** — extrair sem mudar regras:

```ts
  type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

  /** Corpo de `confirm`, dentro da transação recebida. */
  async confirmInTx(tx: Tx, companyId: string, id: string, userId: string, input: ConfirmSaleInput) {
    // mover para cá exatamente o corpo atual de `confirm` (da leitura com FOR UPDATE até o insert em saleStatusHistory)
  }

  async confirm(companyId: string, id: string, userId: string, input: ConfirmSaleInput) {
    await this.database.db.transaction((tx) => this.confirmInTx(tx, companyId, id, userId, input));
    return this.get(companyId, id);
  }

  /** Corpo de `cancel`, dentro da transação recebida. */
  async cancelInTx(tx: Tx, companyId: string, id: string, userId: string, expectedVersion: number, reason: string) { /* corpo atual de cancel */ }

  async cancel(companyId: string, id: string, userId: string, expectedVersion: number, reason: string) {
    await this.database.db.transaction((tx) => this.cancelInTx(tx, companyId, id, userId, expectedVersion, reason));
    return this.get(companyId, id);
  }

  /**
   * Uso interno (assistente): cria o rascunho e o confirma na transação recebida.
   * O número do pedido é sorteado; uma colisão é repetida dentro de um savepoint, sem abortar a transação externa.
   * Devolve as linhas lidas pela própria transação (o pedido ainda não está visível para outras conexões).
   */
  async createConfirmedInTx(tx: Tx, companyId: string, userId: string, key: string, input: CreateSaleInput) {
    const requestHash = createHash('sha256').update(JSON.stringify({ userId, input })).digest('hex');
    let sale: typeof sales.$inferSelect | undefined;
    for (let attempt = 0; attempt < 16 && !sale; attempt++) {
      try {
        sale = await tx.transaction((savepoint) => this.createDraftInTx(savepoint, companyId, userId, key, input, { requestHash }));
      } catch (error) {
        if (!isUniqueViolation(error) || constraintName(error) !== 'sales_company_order_code_uq') throw error;
      }
    }
    if (!sale) throw new ConflictException('Não foi possível reservar um código de pedido; tente novamente');
    const installments = await tx.select().from(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, sale.id))).orderBy(saleInstallments.number);
    const initialReceipts = installments.filter((part) => part.initialReceivedOn).map((part) => ({ installmentId: part.id, amount: part.amount, paymentMethod: part.paymentMethod, receivedOn: part.initialReceivedOn! }));
    await this.confirmInTx(tx, companyId, sale.id, userId, { expectedVersion: sale.version, initialReceipts });
    const [confirmed] = await tx.select().from(sales).where(eq(sales.id, sale.id)).limit(1);
    const items = await tx.select().from(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, sale.id))).orderBy(saleItems.position);
    return { sale: confirmed, items, installments };
  }
```

Conferir que `constraintName`, `isUniqueViolation`, `createHash`, `saleInstallments`, `saleItems` já estão importados (o `create` usa os mesmos) e ajustar. O tipo `Tx` pode reaproveitar o que o arquivo já usa na assinatura de `createDraftInTx`.

- [x] **Step 3: `SalesPaymentsService`** — extrair `receiptInTx(tx, companyId, saleId, installmentId, userId, key, input)` e `reverseInTx(tx, companyId, saleId, movementId, userId, key, reason)` com o corpo atual de dentro de cada `transaction(...)`; `receipt`/`reverse` mantêm `matchExisting` e o tratamento de unicidade e chamam `this.database.db.transaction((tx) => this.receiptInTx(...))`. Dentro do `InTx`, unicidade da chave **não** é tratada (a transação aborta e quem chama relança).

- [x] **Step 4:** Em `sales.module.ts`, `exports: [SalesService, SalesPaymentsService]`.

- [x] **Step 5:** Rodar o teste, `npm run backend:test` e `npm run backend:typecheck`. Sem commit.

---

### Task 3: Chave de versão por operação

**Files:** Modify `backend/src/assistant/tools/types.ts`, `backend/src/assistant/actions/action.service.ts`; Test `backend/tests/nero-version-key.test.ts`

- [x] **Step 1: `types.ts`**

```ts
/** `summary`: linha do resumo calculada no ensaio; `version`: versão lida no ensaio; `versionKey`: chave do registro versionado (padrão: entityId). */
export type OperationResult = { entityId: string | null; label: string; summary?: string; version?: string; versionKey?: string };
```

e em `WriteOperation`:

```ts
  /** Chave do registro versionado a partir dos argumentos (padrão: args.id). Use quando o registro é identificado por outro dado, como o número do pedido. */
  versionKey?(args: A): string;
```

- [x] **Step 2: `ActionService`** — no `runOperations`, trocar o uso de `args.id` por uma chave:

```ts
        const key = handler.versionKey ? handler.versionKey(args) : (args as { id?: string }).id;
        if (!dryRun && handler.requiresVersion && !touched.has(`${handler.versionScope}:${key}`)) {
          const version = versions?.[index];
          if (!key || !version || version.entityId !== key || typeof version.updatedAt !== 'string') throw new ConflictException(VERSION_CONFLICT_MESSAGE);
          expectedVersion = version.updatedAt;
        }
        // ...
        if (handler.versionScope && (result.versionKey ?? result.entityId)) touched.add(`${handler.versionScope}:${result.versionKey ?? result.entityId}`);
```

e no `propose`, ao guardar `operationVersions`:

```ts
dryResults.map((result): OperationVersion => (result.versionKey ?? result.entityId) && result.version ? { entityId: (result.versionKey ?? result.entityId)!, updatedAt: result.version } : null)
```

- [x] **Step 3: Teste** — operação fictícia com `versionKey: (args) => \`pedido:${args.numero}\`` e `requiresVersion`: proposta e confirmação sem mudança → executa; mudança da versão entre proposta e confirmação → `FAILED`/`CONFLICT` com `VERSION_CONFLICT_MESSAGE`; duas operações do mesmo escopo e chave no lote → só a primeira é conferida. Os cadastros da Fase 3 (`alterar_cliente`) continuam funcionando (um caso de regressão). Rodar; typecheck. Sem commit.

---

### Task 4: `criar_venda`

**Files:** Create `backend/src/assistant/tools/sale-support.ts`, `backend/src/assistant/tools/sale-operations.ts`; Test `backend/tests/nero-sale-operation.test.ts`

- [x] **Step 1: `sale-support.ts`**

```ts
// backend/src/assistant/tools/sale-support.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { receivableMovements, receivables, saleInstallments, sales } from '@gestaonf/database/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { cents } from '../../sales/sales-money.js';
import type { DbExecutor } from '../db-types.js';
import { brDate, money } from '../nero-format.js';

/** Formas de pagamento em português (modelo) → domínio. */
export const PAYMENT_METHODS = { PIX: 'PIX', DINHEIRO: 'CASH', CARTAO_CREDITO: 'CREDIT_CARD', CARTAO_DEBITO: 'DEBIT_CARD', BOLETO: 'BOLETO', TRANSFERENCIA: 'TRANSFER', OUTRO: 'OTHER' } as const;
export const PAYMENT_NAMES = Object.keys(PAYMENT_METHODS) as [keyof typeof PAYMENT_METHODS, ...(keyof typeof PAYMENT_METHODS)[]];
const PAYMENT_LABELS: Record<string, string> = { PIX: 'Pix', CASH: 'dinheiro', CREDIT_CARD: 'cartão de crédito', DEBIT_CARD: 'cartão de débito', BOLETO: 'boleto', TRANSFER: 'transferência', OTHER: 'outra forma' };
export const paymentLabel = (method: string) => PAYMENT_LABELS[method] ?? method;

/** "5000", "5000.5", "5.000,00", "5000,00" → "5000.00". */
export function toMoney(value: string, field = 'valor') {
  const text = value.trim().replace(/^R\$\s*/i, '');
  const normalized = /,\d{1,2}$/.test(text) ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '');
  if (!/^\d{1,13}(?:\.\d{1,2})?$/.test(normalized)) throw new BadRequestException(`O ${field} "${value}" não é um valor válido`);
  const [integer, fraction = ''] = normalized.split('.');
  return `${BigInt(integer)}.${fraction.padEnd(2, '0')}`;
}

/** "1" → "1.0000"; aceita até 4 casas. */
export function toQuantity(value: string | null | undefined) {
  const text = (value ?? '1').trim().replace(',', '.');
  if (!/^\d{1,11}(?:\.\d{1,4})?$/.test(text) || Number(text) <= 0) throw new BadRequestException(`A quantidade "${value}" não é válida`);
  const [integer, fraction = ''] = text.split('.');
  return `${BigInt(integer)}.${fraction.padEnd(4, '0')}`;
}

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'use AAAA-MM-DD');
export const orderNumber = z.string().transform((value, ctx) => {
  const match = value.trim().match(/^(?:pedido\s*)?#?\s*(\d{5})$/i);
  if (!match) { ctx.addIssue({ code: 'custom', message: 'número do pedido deve ter 5 dígitos' }); return z.NEVER; }
  return match[1];
});

/** Pedido da empresa pelo número, lido na transação do lote. */
export async function findSale(tx: DbExecutor, companyId: string, number: string) {
  const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.orderCode, number))).limit(1);
  if (!sale) throw new NotFoundException(`Pedido ${number} não encontrado`);
  return sale;
}

/** Parcela N do pedido, com o recebível, os movimentos e o saldo. */
export async function findInstallment(tx: DbExecutor, companyId: string, sale: typeof sales.$inferSelect, number: number) {
  const [part] = await tx.select().from(saleInstallments).where(and(eq(saleInstallments.companyId, companyId), eq(saleInstallments.saleId, sale.id), eq(saleInstallments.number, number))).limit(1);
  if (!part) throw new NotFoundException(`O pedido ${sale.orderCode} não tem a parcela ${number}`);
  const [receivable] = await tx.select().from(receivables).where(and(eq(receivables.companyId, companyId), eq(receivables.saleInstallmentId, part.id))).limit(1);
  if (!receivable) throw new BadRequestException(`O pedido ${sale.orderCode} ainda não está confirmado`);
  const movements = await tx.select().from(receivableMovements).where(and(eq(receivableMovements.companyId, companyId), eq(receivableMovements.receivableId, receivable.id))).orderBy(receivableMovements.recordedAt, receivableMovements.id);
  const paid = movements.reduce((sum, entry) => sum + (entry.kind === 'RECEIPT' ? cents(entry.amount) : -cents(entry.amount)), 0n);
  return { part, receivable, movements, remaining: cents(receivable.originalAmount) - paid };
}

export const centsToMoney = (value: bigint) => money((Number(value) / 100).toFixed(2));
export { brDate, money };
```

Conferir os nomes reais (`receivableMovements.recordedAt`, `saleInstallments.number`, `receivables.saleInstallmentId`) e o helper `amount`/`cents` de `sales-money.ts` (preferir `amount(bigint)` para formatar centavos sem passar por `Number`).

- [x] **Step 2: `sale-operations.ts`**

```ts
// backend/src/assistant/tools/sale-operations.ts
import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { amount, cents, itemAmounts } from '../../sales/sales-money.js';
import type { SalesService } from '../../sales/sales.service.js';
import { rules } from '../nero-policy.js';
import { brDate, isoDate, money, PAYMENT_METHODS, PAYMENT_NAMES, paymentLabel, toMoney, toQuantity } from './sale-support.js';
import type { WriteOperation } from './types.js';

const text = (max: number) => z.string().trim().min(1).max(max).nullish();
const argsSchema = z.object({
  cliente_id: z.uuid(),
  data: isoDate,
  itens: z.array(z.object({ servico_id: z.uuid(), quantidade: z.string().nullish(), valor_unitario: z.string(), desconto: z.string().nullish(), descricao: text(2000) }).strict()).min(1).max(20),
  parcelas: z.array(z.object({ forma: z.enum(PAYMENT_NAMES), valor: z.string(), vencimento: isoDate.nullish(), recebida_em: isoDate.nullish() }).strict()).min(1).max(24),
  os: text(40), observacoes: text(2000),
}).strict();
type Args = z.output<typeof argsSchema>;

function toDomain(args: Args) {
  const items = args.itens.map((item) => ({ serviceId: item.servico_id, quantity: toQuantity(item.quantidade), unitPrice: toMoney(item.valor_unitario, 'valor unitário'), discountAmount: item.desconto ? toMoney(item.desconto, 'desconto') : '0.00', ...(item.descricao ? { description: item.descricao } : {}) }));
  const installments = args.parcelas.map((part, index) => {
    if (!!part.vencimento === !!part.recebida_em) throw new BadRequestException(`Na parcela ${index + 1}, informe o vencimento ou a data em que já foi recebida (só um dos dois)`);
    const base = { paymentMethod: PAYMENT_METHODS[part.forma], amount: toMoney(part.valor, `valor da parcela ${index + 1}`) };
    return part.recebida_em ? { ...base, receivedOn: part.recebida_em } : { ...base, dueOn: part.vencimento! };
  });
  const total = items.reduce((sum, item) => sum + cents(itemAmounts(item.quantity, item.unitPrice, item.discountAmount).totalAmount), 0n);
  const parts = installments.reduce((sum, part) => sum + cents(part.amount), 0n);
  if (total !== parts) throw new BadRequestException(`As parcelas somam ${money(amount(parts))}, mas o total da venda é ${money(amount(total))}. Ajuste as parcelas.`);
  return { customerId: args.cliente_id, soldOn: args.data, items, installments, ...(args.os ? { workOrderNumber: args.os } : {}), ...(args.observacoes ? { notes: args.observacoes } : {}) };
}

export function createSaleOperation(salesService: SalesService): WriteOperation<Args> {
  return {
    kind: 'WRITE', name: 'criar_venda', allowed: rules.anyMember,
    description: 'Lança uma venda já confirmada. dados: {"cliente_id": id de buscar_clientes ou {"$ref": n}, "data": "AAAA-MM-DD" (data da venda), "itens": [{"servico_id": id de buscar_servicos ou {"$ref": n}, "quantidade": "1", "valor_unitario": "5000.00", "desconto": null, "descricao": null}], "parcelas": [{"forma": PIX|DINHEIRO|CARTAO_CREDITO|CARTAO_DEBITO|BOLETO|TRANSFERENCIA|OUTRO, "valor": "2500.00", "recebida_em": "AAAA-MM-DD" se já foi pago, ou "vencimento": "AAAA-MM-DD" se vai vencer}], "os": null, "observacoes": null}. As parcelas devem somar o total.',
    schema: argsSchema,
    summarize: (args) => `Nova venda com ${Array.isArray(args.itens) ? args.itens.length : 0} item(ns) e ${Array.isArray(args.parcelas) ? args.parcelas.length : 0} parcela(s)`,
    async execute(tx, ctx, args, options) {
      const { sale, items, installments } = await salesService.createConfirmedInTx(tx as never, ctx.companyId, ctx.userId, options.idempotencyKey, toDomain(args));
      const itemText = items.map((item) => `${item.serviceNameSnapshot} ${Number(item.quantity)} × ${money(item.unitPrice)}${item.discountAmount !== '0.00' ? ` (desconto ${money(item.discountAmount)})` : ''}`).join('; ');
      const partsText = installments.map((part) => `${part.number}) ${paymentLabel(part.paymentMethod)} ${money(part.amount)} ${part.initialReceivedOn ? `recebida em ${brDate(part.initialReceivedOn)}` : `vence em ${brDate(part.dueOn!)}`}`).join('; ');
      return {
        entityId: sale.id, label: `Venda ${sale.orderCode} — ${sale.customerNameSnapshot} — ${money(sale.totalAmount)}`,
        summary: `Venda para ${sale.customerNameSnapshot} em ${brDate(sale.soldOn!)}: ${itemText} · Total ${money(sale.totalAmount)} · Parcelas: ${partsText}`,
      };
    },
  };
}
```

Observações: o número do pedido sorteado no ensaio é descartado (a transação é revertida) e **não aparece no resumo**; ele só aparece no rótulo da execução ("✅ Pronto! Gravei… • Venda 12345 — …"). Conferir o tipo do `tx` aceito por `createConfirmedInTx` e remover o `as never` se os tipos baterem.

- [x] **Step 3: Testes** (`ActionService` + registro real):
  1. **Caso Roberto completo:** lote `[criar_cliente Roberto, criar_servico Criação de site, criar_venda { cliente_id: {$ref:0}, itens: [{servico_id: {$ref:1}, valor_unitario: "5000"}], parcelas: [{forma: PIX, valor: "2500", recebida_em: hoje}, {forma: BOLETO, valor: "2500", vencimento: +30 dias}] }]` → ensaio não grava; resumo único com as três linhas (venda com "Total R$ 5.000,00", "Pix R$ 2.500,00 recebida em …", "boleto R$ 2.500,00 vence em …"), **sem número de pedido**; `confirm` grava cliente, serviço e venda `CONFIRMED` com parcela 1 paga; rótulo "Venda 12345 — Roberto Almeida — R$ 5.000,00".
  2. Parcelas que não somam → recusa no ensaio com "As parcelas somam R$ 4.000,00, mas o total da venda é R$ 5.000,00".
  3. Parcela com vencimento **e** recebimento, ou sem nenhum → recusa clara.
  4. Valores "5.000,00", "5000,5", "R$ 300" normalizados; "abc" recusado.
  5. Cliente inativo → "Selecione um cliente ativo desta empresa"; serviço de outra empresa → recusa.
  6. Clique duplo → `ALREADY_EXECUTED`, uma única venda.

Rodar; typecheck. Sem commit.

---

### Task 5: Baixa, estorno e cancelamento

**Files:** Create `backend/src/assistant/tools/payment-operations.ts`; Modify `tools/index.ts`, `assistant.module.ts`, `backend/tests/nero-company-links.test.ts`; Test `backend/tests/nero-payment-operations.test.ts`

- [x] **Step 1: `payment-operations.ts`**

```ts
// backend/src/assistant/tools/payment-operations.ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { z } from 'zod';
import { amount, cents } from '../../sales/sales-money.js';
import type { SalesPaymentsService } from '../../sales/sales-payments.service.js';
import type { SalesService } from '../../sales/sales.service.js';
import { rules } from '../nero-policy.js';
import { brDate, findInstallment, findSale, isoDate, money, orderNumber, PAYMENT_METHODS, PAYMENT_NAMES, paymentLabel, toMoney } from './sale-support.js';
import type { WriteOperation } from './types.js';
import { VERSION_CONFLICT_MESSAGE } from './write-support.js';

const movementsVersion = (receivableId: string, count: number) => `${receivableId}:${count}`;
const assertVersion = (actual: string, expected: string | undefined) => { if (expected !== undefined && actual !== expected) throw new ConflictException(VERSION_CONFLICT_MESSAGE); };

const receiptArgs = z.object({ numero_pedido: orderNumber, parcela: z.number().int().positive(), valor: z.string().nullish(), forma: z.enum(PAYMENT_NAMES), recebido_em: isoDate.nullish(), referencia: z.string().trim().min(1).max(100).nullish() }).strict();

export function receiptOperation(payments: SalesPaymentsService): WriteOperation<z.output<typeof receiptArgs>> {
  return {
    kind: 'WRITE', name: 'baixar_recebimento', allowed: rules.anyMember, versionScope: 'receivable', requiresVersion: true,
    versionKey: (args) => `${args.numero_pedido}:${args.parcela}`,
    description: 'Dá baixa (registra pagamento) numa parcela de um pedido confirmado. dados: {"numero_pedido": "12345", "parcela": 2, "valor": null para o saldo inteiro ou "1000.00", "forma": PIX|DINHEIRO|CARTAO_CREDITO|CARTAO_DEBITO|BOLETO|TRANSFERENCIA|OUTRO, "recebido_em": null para hoje ou "AAAA-MM-DD", "referencia": null}. Consulte o pedido com consultar_venda antes se tiver dúvida sobre a parcela.',
    schema: receiptArgs,
    summarize: (args) => `Baixa no pedido ${String(args.numero_pedido)}, parcela ${String(args.parcela)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido);
      const { part, receivable, movements, remaining } = await findInstallment(tx, ctx.companyId, sale, args.parcela);
      const version = movementsVersion(receivable.id, movements.length);
      assertVersion(version, options.expectedVersion);
      if (remaining <= 0n) throw new BadRequestException(`A parcela ${args.parcela} do pedido ${sale.orderCode} já está quitada`);
      const value = args.valor ? toMoney(args.valor) : amount(remaining);
      const receivedOn = args.recebido_em ?? ctx.today;
      await payments.receiptInTx(tx as never, ctx.companyId, sale.id, part.id, ctx.userId, options.idempotencyKey, { amount: value, paymentMethod: PAYMENT_METHODS[args.forma], receivedOn, ...(args.referencia ? { reference: args.referencia } : {}) });
      return {
        entityId: receivable.id, label: `Baixa de ${money(value)} no pedido ${sale.orderCode}`, version, versionKey: `${sale.orderCode}:${args.parcela}`,
        summary: `Baixa no pedido ${sale.orderCode} (${sale.customerNameSnapshot}), parcela ${args.parcela}: ${money(value)} via ${paymentLabel(PAYMENT_METHODS[args.forma])} em ${brDate(receivedOn)} — saldo da parcela ${money(amount(remaining))} → ${money(amount(remaining - cents(value)))}`,
      };
    },
  };
}

const reverseArgs = z.object({ numero_pedido: orderNumber, parcela: z.number().int().positive(), valor: z.string().nullish(), data: isoDate.nullish(), motivo: z.string().trim().min(3).max(100) }).strict();

export function reverseOperation(payments: SalesPaymentsService): WriteOperation<z.output<typeof reverseArgs>> {
  return {
    kind: 'WRITE', name: 'estornar_recebimento', allowed: rules.anyMember, versionScope: 'receivable', requiresVersion: true,
    versionKey: (args) => `${args.numero_pedido}:${args.parcela}`,
    description: 'Estorna um recebimento de uma parcela. dados: {"numero_pedido": "12345", "parcela": 1, "valor": null ou "2500.00", "data": null ou "AAAA-MM-DD" (para escolher qual recebimento, se houver mais de um), "motivo": texto curto obrigatório}.',
    schema: reverseArgs,
    summarize: (args) => `Estorno no pedido ${String(args.numero_pedido)}, parcela ${String(args.parcela)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido);
      const { receivable, movements } = await findInstallment(tx, ctx.companyId, sale, args.parcela);
      const version = movementsVersion(receivable.id, movements.length);
      assertVersion(version, options.expectedVersion);
      const reversed = new Set(movements.filter((entry) => entry.reversesMovementId).map((entry) => entry.reversesMovementId));
      const value = args.valor ? toMoney(args.valor) : null;
      const candidates = movements.filter((entry) => entry.kind === 'RECEIPT' && !reversed.has(entry.id) && (!value || entry.amount === value) && (!args.data || entry.effectiveOn === args.data));
      if (!candidates.length) throw new BadRequestException(`Não há recebimento a estornar na parcela ${args.parcela} do pedido ${sale.orderCode}${value || args.data ? ' com esses dados' : ''}`);
      if (candidates.length > 1) throw new BadRequestException(`Há ${candidates.length} recebimentos nessa parcela: ${candidates.map((entry) => `${money(entry.amount)} em ${brDate(entry.effectiveOn)}`).join('; ')}. Diga qual estornar (valor ou data).`);
      const [target] = candidates;
      await payments.reverseInTx(tx as never, ctx.companyId, sale.id, target.id, ctx.userId, options.idempotencyKey, args.motivo);
      return {
        entityId: receivable.id, label: `Estorno de ${money(target.amount)} no pedido ${sale.orderCode}`, version, versionKey: `${sale.orderCode}:${args.parcela}`,
        summary: `Estorno no pedido ${sale.orderCode} (${sale.customerNameSnapshot}), parcela ${args.parcela}: ${money(target.amount)} recebido em ${brDate(target.effectiveOn)} — motivo: ${args.motivo}`,
      };
    },
  };
}

const cancelArgs = z.object({ numero_pedido: orderNumber, motivo: z.string().trim().min(3).max(500) }).strict();

export function cancelSaleOperation(salesService: SalesService): WriteOperation<z.output<typeof cancelArgs>> {
  return {
    kind: 'WRITE', name: 'cancelar_venda', allowed: rules.anyMember, versionScope: 'sale', requiresVersion: true,
    versionKey: (args) => args.numero_pedido,
    description: 'Cancela um pedido. dados: {"numero_pedido": "12345", "motivo": texto obrigatório}. Pedido com valor recebido precisa de estorno antes: proponha estornar_recebimento e cancelar_venda na mesma proposta, nessa ordem. Pedido com nota fiscal emitida não pode ser cancelado pelo Nero.',
    schema: cancelArgs,
    summarize: (args) => `Cancelar pedido ${String(args.numero_pedido)}`,
    async execute(tx, ctx, args, options) {
      const sale = await findSale(tx, ctx.companyId, args.numero_pedido);
      const version = String(sale.version);
      assertVersion(version, options.expectedVersion);
      await salesService.cancelInTx(tx as never, ctx.companyId, sale.id, ctx.userId, sale.version, args.motivo);
      return {
        entityId: sale.id, label: `Pedido ${sale.orderCode} cancelado`, version, versionKey: sale.orderCode,
        summary: `Cancelar pedido ${sale.orderCode} (${sale.customerNameSnapshot}, ${money(sale.totalAmount)}) — motivo: ${args.motivo}`,
      };
    },
  };
}
```

Conferir `receivableMovements.effectiveOn`/`reversesMovementId` no schema e os tipos de `ReceiptInput`. Atenção: no lote "estornar + cancelar", o estorno não muda `sales.version`, então a versão do cancelamento lida no ensaio continua válida na confirmação.

- [x] **Step 2: Registro e DI**
  - `tools/index.ts`: `ReadServices` ganha `payments: SalesPaymentsService`; registrar `createSaleOperation(readers.sales)`, `receiptOperation(readers.payments)`, `reverseOperation(readers.payments)`, `cancelSaleOperation(readers.sales)`.
  - `assistant.module.ts`: injetar `SalesPaymentsService` na factory do `ToolRegistry`.
  - `backend/tests/nero-company-links.test.ts` (permanente): `payments: new SalesPaymentsService(database, sales)` na construção do registro (criar a instância de `SalesService` numa variável e reutilizar). Nenhum caso novo.
  - Validar DI com módulo `DatabaseModule` + `AssistantModule` num script temporário no scratchpad (apagar depois).

- [x] **Step 3: Testes**:
  1. Baixa sem valor quita o saldo da parcela 2; resumo com "saldo da parcela R$ 2.500,00 → R$ 0,00"; segunda baixa na mesma parcela → "já está quitada".
  2. Baixa parcial (R$ 1.000) e depois o resto.
  3. Valor acima do saldo → "Valor maior que o saldo pendente".
  4. Pedido "#12345"/"pedido 12345" normalizados; pedido de outra empresa → "Pedido 12345 não encontrado".
  5. Mudança entre proposta e confirmação (outra baixa gravada direto no banco) → `CONFLICT` com `VERSION_CONFLICT_MESSAGE`; nada gravado.
  6. Estorno do único recebimento; com dois recebimentos sem `valor`/`data` → recusa listando os dois; com `data` escolhe o certo.
  7. **Estorno + cancelamento** do mesmo pedido numa única proposta → pedido `CANCELED`, movimento `REVERSAL` gravado; resumo com as duas linhas.
  8. Cancelamento com valor recebido e sem estorno → "Existem valores recebidos; regularize o financeiro antes de cancelar".
  9. Pedido cancelado mudando de versão entre proposta e confirmação (cancelado pela web) → conflito.
  10. Pedido com NFS-e emitida: se for viável simular o estado fiscal (ver `backend/src/fiscal/sale-fiscal-state.ts`), confirmar que `cancelar_venda` devolve o `lockReason`; se não for viável sem montar o módulo fiscal, registrar no relatório e cobrir na avaliação manual.

Rodar todos os `tests/nero-`, `npm run backend:test` e typecheck. Sem commit.

---

### Task 6: Prompt e fluxo completo

**Files:** Modify `backend/src/assistant/prompt.ts`; Test `backend/tests/nero-sales-flow.test.ts`

- [x] **Step 1: Prompt** — na seção "Gravações" (quando `canWrite`), acrescentar e incrementar `NERO_PROMPT_VERSION`:

```ts
      '- Vendas: para lançar uma venda você precisa de cliente, serviço, valor, data da venda e como foi ou será pago (forma de pagamento; se já recebeu, a data; se vai vencer, o vencimento). Se o usuário disser "hoje" ou não disser a data de uma venda que acabou de fazer, use a data de hoje — o resumo mostra a data para ele conferir.',
      '- Procure cliente e serviço antes. Se não existirem, ofereça cadastrar e, se ele aceitar, junte cadastros e venda na mesma proposta usando {"$ref": n}.',
      '- "Metade agora e metade depois" vira duas parcelas que somam o total. Nunca invente forma de pagamento ou vencimento: pergunte.',
      '- Baixa, estorno e cancelamento: identifique o pedido pelo número de 5 dígitos e a parcela pelo número; se o usuário não souber, use consultar_vendas/consultar_venda para achar. Estorno e cancelamento exigem um motivo. Para cancelar um pedido com valor recebido, proponha o estorno e o cancelamento juntos.',
```

- [x] **Step 2: Testes de fluxo** (`buildNero` + `ScriptedModel` + `buttonPayload`):
  1. Caso Roberto: o roteiro chama `buscar_clientes` (nada), `buscar_servicos` (nada) e `propor_operacoes` com cliente + serviço + venda → mensagem INTERACTIVE com três linhas; Confirmar → "✅ Pronto! Gravei…" com "Venda NNNNN — Roberto Almeida — R$ 5.000,00".
  2. Parcelas que não somam → o modelo recebe a recusa com a diferença e responde pedindo ajuste; nada gravado.
  3. "O Roberto pagou a segunda parcela" → roteiro `consultar_vendas` → `propor_operacoes` com `baixar_recebimento` → Confirmar → parcela quitada.
  4. "Cancela o pedido X, lancei errado" com valor recebido → roteiro propõe estorno + cancelamento → Confirmar → pedido cancelado.

Rodar todos os `tests/nero-` e typecheck. Sem commit.

---

### Task 7: Avaliação real, verificação e limpeza

- [x] **Step 1: Avaliação** `backend/tests/nero-sales-eval.live.test.ts` (só com `NERO_LIVE_EVAL=1`), `OpenAINeroModel` real e `buildNero`; operador novo por cenário; clique em Confirmar simulado com o primeiro botão da última mensagem INTERACTIVE:
  1. "Cadastra o cliente Roberto Almeida (pessoa física) e o serviço Criação de site, e lança uma venda de R$ 5.000 pra ele hoje: metade no Pix já recebida e metade no boleto vencendo daqui a 30 dias." → uma proposta com cliente, serviço e venda; confirmar → venda `CONFIRMED`, total 5000.00, parcela Pix paga.
  2. Venda semeada do Roberto (Pix pago, boleto pendente). "O Roberto pagou o boleto hoje no Pix" → proposta de baixa da parcela 2 com "→ R$ 0,00"; confirmar → quitada.
  3. Mesma venda semeada. "Cancela a venda do Roberto, foi lançada errado" → proposta com estorno da parcela paga **e** cancelamento (ou o Nero explica que precisa estornar antes e propõe os dois); confirmar → pedido `CANCELED`.
  4. "Lança uma venda de R$ 1.000 pro Roberto em duas parcelas de R$ 400 no Pix" → resposta em texto apontando que as parcelas não somam; nada gravado.
  Em todas: sem UUID, sem nome de ferramenta. Registrar as respostas. Falha de comportamento → ajustar só `prompt.ts`/descrições das operações (incrementando a versão), no máximo 3 rodadas, sem afrouxar asserções.
  Run: `cd /c/Users/pedro/Documents/GitHub/GestaoNF/backend && cd .. && NERO_LIVE_EVAL=1 npm exec -w backend -- vitest run tests/nero-sales-eval.live.test.ts --silent=false --reporter=verbose`.

- [x] **Step 2: Verificação** — todos os `tests/nero-`, `npm run backend:test`, `npm run backend:typecheck && npm run frontend:typecheck`.

- [x] **Step 3: Limpeza** — apagar a fixture e os testes `nero-*` desta fase (exceto `nero-company-links.test.ts`), `test-results`/`coverage`; conferir bancos `gestaonf_nero_test_*` = 0 (se sobrar, `DROP DATABASE ... WITH (FORCE)` só desses). Sem commit.

---

## Cobertura do spec (Fase 4, seções 10.1 e 11)

| Requisito | Task |
| --- | --- |
| Caso Roberto (cliente + serviço + venda) em uma confirmação | 4, 6, 7 |
| Parcelas que não somam detectadas no ensaio com a diferença | 4, 6, 7 |
| Recebimento inicial automático da parcela já paga | 2, 4 |
| Colisão do número do pedido sem abortar o lote | 2 |
| Baixa idempotente e recusada acima do saldo | 5 |
| Estorno (inclusive escolha entre vários recebimentos) | 5 |
| Estorno + cancelamento numa confirmação; cancelamento com valor recebido explicado; NFS-e bloqueia | 2, 5, 6, 7 |
| Recusa se o pedido mudou depois do resumo (`versionKey`) | 3, 5 |
| Mesmas permissões e regras do site; API web inalterada | 2, 5 |
| Sem UUID nas mensagens; pedido citado pelo número | 4, 5, 7 |

---

## Registro da execução — 11/11/2026

Implementação das Tasks 2 a 6 conferida no código contra este plano e a seção 10.1 da spec: variantes `…InTx` e `createConfirmedInTx` em `SalesService`/`SalesPaymentsService`, `SalesPaymentsService` exportado, `versionKey` no `ActionService`, as quatro operações registradas e injetadas, prompt na versão `2026-11-11.4`. A implementação vai além do plano em dois pontos: pedido e recebível são travados (`FOR UPDATE`) antes de ler a versão, e `toMoney` recusa formatos ambíguos ("5,000", "0,500"). Nenhum commit, alteração de índice do Git ou migração.

Os testes temporários das Tasks 2 a 6 já tinham sido removidos antes desta verificação, sem registro dos seus resultados. A fixture (Task 1) foi recriada a partir do commit `e13cf61` com `payments`, `seedBusiness`, `seedConfirmedSale` e um auxiliar de saldo por parcela (a tabela `receivables` não tem coluna de status) para executar a Task 7.

| Verificação | Resultado |
| --- | --- |
| Fumaça da fixture (venda semeada `CONFIRMED`, saldos `0.00`/`2500.00`, Nero responde) | Passou |
| Todos os `tests/nero-` | 12 passaram; 4 avaliações reais ignoradas sem `NERO_LIVE_EVAL` |
| `npm run backend:test`, antes da limpeza | 222 passaram; 4 ignorados |
| `npm run backend:test`, após a limpeza (verificação anterior, mesmo código) | 221 passaram |
| `npm run backend:typecheck` e `npm run frontend:typecheck` | Ambos passaram |
| Bancos `gestaonf_nero_test_*` ao terminar | Nenhum |

### Avaliação com modelo real

Uma rodada, sem mudança no prompt nem nas descrições das operações:

1. **Caso Roberto:** uma proposta com cliente, serviço e venda ("Venda para Roberto Almeida em 11/11/2026: Criação de site 1 × R$ 5.000,00 · Total R$ 5.000,00 · Parcelas: 1) Pix R$ 2.500,00 recebida em 11/11/2026; 2) boleto R$ 2.500,00 vence em 11/12/2026"). Confirmar gravou a venda `CONFIRMED`, total 5000.00, parcela Pix quitada; rótulo "Venda 63295 — Roberto Almeida — R$ 5.000,00".
2. **Baixa:** "Baixa no pedido … (Roberto Almeida), parcela 2: R$ 2.500,00 via Pix em 11/11/2026 — saldo da parcela R$ 2.500,00 → R$ 0,00"; confirmada, parcela quitada. A primeira execução falhou só na asserção: a moeda pt-BR usa espaço inquebrável depois de "R$". A asserção passou a normalizar esse espaço (sem afrouxar o conteúdo) e o cenário passou.
3. **Cancelamento:** o Nero propôs direto o estorno da parcela 1 e o cancelamento na mesma proposta; confirmada, pedido `CANCELED`.
4. **Parcelas que não somam:** resposta em texto ("R$ 400 + R$ 400 dá R$ 800, não R$ 1.000 — quer ajustar o total ou o valor das parcelas?"), sem proposta e sem venda gravada.

Nenhuma mensagem trouxe UUID ou nome de ferramenta.

### Limpeza

Fixture e testes temporários removidos; `backend/tests/nero-company-links.test.ts` preservado (só o ajuste de `payments` da Task 2). Sem `test-results`/`coverage` nem bancos temporários. Todo o trabalho permanece no working tree.
