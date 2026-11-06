# NFS-e: correção de rejeição, cancelamento e substituição — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir nova emissão após rejeição, cancelar NFS-e autorizada (evento e101101) e substituir NFS-e autorizada (DPS com `<subst>`) no ambiente de homologação.

**Architecture:** Várias emissões por venda, com no máximo uma aberta, calculada por um módulo único de trava fiscal (`sale-fiscal-state.ts`). O cancelamento é uma linha em `nfse_document_events`, processada pelo worker via outbox (`nfse.event`), com o mesmo modelo de lease e consulta antes de reenvio usado na DPS. A substituição é uma emissão `kind=SUBSTITUTION` cuja DPS leva `<subst>`; a autorização marca a original como `SUBSTITUTED` na mesma transação.

**Tech Stack:** NestJS 12 + Fastify, Drizzle ORM / PostgreSQL 17, xml-crypto, xmllint-wasm, Vitest, React 19 + TanStack Query.

**Spec:** [2026-11-06-nfse-correcao-cancelamento-substituicao-design.md](../specs/2026-11-06-nfse-correcao-cancelamento-substituicao-design.md)

**Commits:** o repositório tem ~500 alterações pendentes da reorganização de pastas. Nesta execução não haverá commits por tarefa; o commit fica para o usuário decidir.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `backend/src/fiscal/contracts/homologation-20261020/{pedRegEvento,evento,tiposEventos}_v1.01.xsd` | Esquemas oficiais de evento (criar) |
| `backend/src/fiscal/nfse-event-contract.ts` | Identificador, XML do pedido de cancelamento, assinatura e validação de eventos (criar) |
| `backend/src/fiscal/nfse-contract.ts` | `buildDps` passa a aceitar `substitution`; o assinador fica genérico por elemento de referência (modificar) |
| `backend/database/src/schema.ts` + `backend/database/drizzle/0029_*.sql` | Colunas e tabela novas (modificar/gerar) |
| `backend/src/fiscal/sale-fiscal-state.ts` | Cálculo da trava fiscal da venda (criar) |
| `backend/src/sales/sales.service.ts` | `update` e `cancel` usam a trava fiscal (modificar) |
| `backend/src/fiscal/nfse-preview.service.ts` | Cobertura de itens e modo substituição (modificar) |
| `backend/src/fiscal/nfse-issuance.service.ts` | Nova emissão após rejeição, emissão substituta e histórico ampliado (modificar) |
| `backend/src/fiscal/nfse-processor.service.ts` | Na autorização, confere `chSubstda` e marca a original (modificar) |
| `backend/src/fiscal/nfse-document-actions.service.ts` | Pedir cancelamento, abrir/desistir de substituição, reconsultar (criar) |
| `backend/src/fiscal/nfse-event-processor.service.ts` | Worker do cancelamento (criar) |
| `backend/src/fiscal/nfse-national.client.ts` | Constantes dos caminhos de evento e `extractEventXml` (modificar) |
| `backend/src/fiscal/nfse.controller.ts`, `nfse.schemas.ts`, `fiscal.module.ts` | Rotas e validação (modificar) |
| `backend/src/jobs/nfse-worker.service.ts` | Consumir `nfse.event` (modificar) |
| `backend/tests/nfse-event-contract.test.ts` | Testes de XML (criar) |
| `backend/tests/nfse-lifecycle.test.ts` | Testes com banco: trava, rejeição, cancelamento, substituição, isolamento (criar) |
| `frontend/src/api/nfse.types.ts`, `frontend/src/api/client.ts` | Tipos e chamadas novos (modificar) |
| `frontend/src/features/fiscal/NfseSaleActions.tsx`, `NfseDocumentActions.tsx`, `nfse.css` | Histórico, cancelamento e substituição na UI (modificar/criar) |
| `frontend/src/features/sales/SaleDetailPanel.tsx` | Aviso de substituição aberta (modificar) |

---

### Task 1: Contrato de eventos

**Files:**
- Create: `backend/src/fiscal/contracts/homologation-20261020/pedRegEvento_v1.01.xsd`, `evento_v1.01.xsd`, `tiposEventos_v1.01.xsd` (copiados do pacote oficial verificado)
- Create: `backend/src/fiscal/nfse-event-contract.ts`
- Modify: `backend/src/fiscal/nfse-contract.ts` (exportar `signXml(xml, referenceElement, …)` e manter `signDps` como atalho)
- Modify: `docs/architecture/nfse-national-research-manifest.json` (hashes dos XSDs de evento)
- Test: `backend/tests/nfse-event-contract.test.ts`

- [ ] **Step 1: Testes de XML.** Gerar um certificado RSA autoassinado com `node-forge` no teste. Asserções:
  - `eventIdentifier(chave50)` retorna `PRE{chave}101101` com 59 caracteres.
  - `buildCancellationRequest({ accessKey, authorTaxId, reasonCode: '1', reasonText: 'Erro de digitação no valor', environment: 'HOMOLOGATION', at })` assinado com `signEvent` passa em `validateEventXml(xml, 'pedRegEvento')`.
  - `reasonText` com 14 caracteres lança erro.
  - `buildDps` com `substitution: { accessKey, reasonCode: '99', reasonText: 'Correção da descrição do serviço' }` produz `<subst>` entre `cLocEmi` e `prest`, e passa em `validateFiscalXml`.
- [ ] **Step 2:** Rodar `npm exec -w backend -- vitest run tests/nfse-event-contract.test.ts`. Esperado: FAIL, porque o módulo não existe.
- [ ] **Step 3:** Copiar os XSDs. Implementar `nfse-event-contract.ts`:
  - `eventIdentifier`;
  - `buildCancellationRequest`, que gera `pedRegEvento versao="1.01"` / `infPedReg Id` / `tpAmb` / `verAplic` / `dhEvento` (ISO com `+00:00`) / `CNPJAutor` / `chNFSe` / `e101101` (com `xDesc`, `cMotivo`, `xMotivo`);
  - `signEvent`, que chama `signXml` com a referência `infPedReg`;
  - `validateEventXml`, com preload dos esquemas de evento.

  Adicionar `substitution` opcional ao snapshot e ao `buildDps`.
- [ ] **Step 4:** Rodar o teste. Esperado: PASS.

### Task 2: Migration 0029

**Files:**
- Modify: `backend/database/src/schema.ts`
- Generate: `backend/database/drizzle/0029_*.sql` (`npm run db:generate`)

- [ ] **Step 1:** Mudanças no schema:
  - **`nfseEmissionRequests`:** remover `nfse_emissions_sale_environment_uq`. Adicionar `kind`, `previousEmissionId` e `substitutesDocumentId`, com o check `nfse_emissions_kind_chk` e FKs compostas.
  - **`nfseDocuments`:** adicionar `status`, `cancelledAt`, `substitutedAt`, `substitutedByDocumentId` e os campos `substitution*`, com os checks.
  - **Nova `nfseDocumentEvents`:** colunas da seção 4.3 da spec. Índices únicos `(company_id, request_key)` e o parcial `(document_id, event_type) WHERE status <> 'REJECTED'`. Checks de status, motivo e tamanho do texto.
  - **`nfseTransmissionAttempts`:** `dpsId` passa a aceitar nulo. Adicionar `documentEventId` e o check de exclusividade. O check de `operation` aceita `SEND_EVENT` e `LOOKUP_EVENT`.
- [ ] **Step 2:** `npm run db:generate`. Revisar o SQL gerado: as FKs autorreferentes e o índice parcial precisam estar presentes.
- [ ] **Step 3:** `npm run db:migrate` e `npm run typecheck`. Esperado: sem erros.

### Task 3: Trava fiscal da venda

**Files:**
- Create: `backend/src/fiscal/sale-fiscal-state.ts`
- Modify: `backend/src/sales/sales.service.ts:232-233,378-379`
- Test: `backend/tests/nfse-lifecycle.test.ts`, bloco `trava fiscal`

Interface:

```ts
export type SaleFiscalState = {
  inProgress: boolean;            // DPS ou evento em processamento
  activeDocuments: Array<{ id: string; dpsId: string; number: string; accessKey: string; itemIds: string[]; substitutionOpen: boolean; substitutionSaleVersion: number | null }>;
  coveredItemIds: Set<string>;
  substitution: { documentId: string; accessKey: string; reasonCode: string; reasonText: string | null; saleVersion: number } | null;
  canEditSale: boolean; canCancelSale: boolean; lockReason: string | null;
};
export async function saleFiscalState(db: Db, companyId: string, saleId: string, environment?: 'HOMOLOGATION' | 'PRODUCTION'): Promise<SaleFiscalState>
```

- [ ] **Step 1:** Testes da matriz da seção 5 da spec. Cada estado é montado inserindo linhas diretamente em `nfse_dps`, `nfse_documents` e `nfse_document_events`. Para cada um, verificar `SalesService.update` e `cancel`: lançam `ConflictException` ou passam.
- [ ] **Step 2:** Rodar. Esperado: FAIL.
- [ ] **Step 3:** Implementar e trocar as duas checagens `fiscalDps` do `SalesService` por `saleFiscalState`.
- [ ] **Step 4:** Rodar. Esperado: PASS.

### Task 4: Nova emissão após rejeição e cobertura

**Files:**
- Modify: `backend/src/fiscal/nfse-preview.service.ts` (`build` recebe o estado fiscal; filtra itens cobertos; em modo substituição inclui todos os itens e exige um grupo)
- Modify: `backend/src/fiscal/nfse-issuance.service.ts` (`emit`, `get`, `forSale`)
- Test: `nfse-lifecycle.test.ts`, bloco `rejeição`

- [ ] **Step 1:** Testes:
  - Com todas as DPS `REJECTED`, uma nova `emit` cria outra emissão com `previousEmissionId` e número `n+1`.
  - Com DPS `RESERVED`, retorna 409 `NFSE_IN_PROGRESS`.
  - Com nota autorizada cobrindo tudo, retorna 409 `NFSE_ALREADY_AUTHORIZED`.
- [ ] **Step 2:** Implementar:
  - Em `emit`, trocar a checagem `issued` pelo estado fiscal, calculado dentro da transação depois do `FOR UPDATE` da venda.
  - Gravar `previousEmissionId` e `kind`.
  - Em `get`, incluir `kind`, `previousEmissionId`, o status do documento, a substituição aberta e o cancelamento ativo.
  - Em `forSale`, ordenar por `createdAt` e anexar `fiscalState`.
- [ ] **Step 3:** Rodar. Esperado: PASS.

### Task 5: Cancelamento

**Files:**
- Create: `backend/src/fiscal/nfse-document-actions.service.ts`, `backend/src/fiscal/nfse-event-processor.service.ts`
- Modify: `nfse-national.client.ts`, `nfse.controller.ts`, `nfse.schemas.ts`, `fiscal.module.ts`, `jobs/nfse-worker.service.ts`
- Test: `nfse-lifecycle.test.ts`, bloco `cancelamento`

- [ ] **Step 1:** Testes. O `NationalNfseClient.call` e o `CertificateService.withSigningCredential` são substituídos por stubs com certificado de teste.
  - Pedido idempotente: a mesma chave devolve o mesmo evento.
  - Dois pedidos concorrentes resultam em um evento ativo e um 409.
  - Processamento com resposta 200 `eventoXmlGZipB64`: o evento vai para `REGISTERED` e a nota para `CANCELLED`, e a venda destrava.
  - Resposta 400 com `erros`: o evento vai para `REJECTED` e a nota continua `AUTHORIZED`.
  - Timeout seguido de uma consulta que encontra o evento: `REGISTERED`, sem um segundo `SEND_EVENT`.
- [ ] **Step 2:** Implementar o serviço de ações, o processador, as rotas e o tópico do worker.
- [ ] **Step 3:** Rodar. Esperado: PASS.

### Task 6: Substituição

**Files:**
- Modify: `nfse-document-actions.service.ts` (abrir e desistir), `nfse-preview.service.ts`, `nfse-issuance.service.ts`, `nfse-processor.service.ts` (`authorize`)
- Test: `nfse-lifecycle.test.ts`, bloco `substituição`

- [ ] **Step 1:** Testes:
  - Abrir: a venda fica editável.
  - Desistir sem alterar a venda: 204. Depois de alterar: 409.
  - A prévia em modo substituição tem `substitution` no snapshot. Com dois grupos, gera o erro `SUBSTITUTION_SINGLE_GROUP`.
  - `authorize` com XML contendo `chSubstda` correto: a original vai para `SUBSTITUTED`. Sem `chSubstda`: lança erro e a original continua ativa.
- [ ] **Step 2:** Implementar.
- [ ] **Step 3:** Rodar. Esperado: PASS.

### Task 7: Frontend

**Files:**
- Modify: `frontend/src/api/nfse.types.ts`, `frontend/src/api/client.ts`, `frontend/src/features/fiscal/NfseSaleActions.tsx`, `frontend/src/features/fiscal/nfse.css`, `frontend/src/features/sales/SaleDetailPanel.tsx`
- Create: `frontend/src/features/fiscal/NfseDocumentActions.tsx`

- [ ] **Step 1:** Tipos e chamadas novos: `cancelNfse`, `openNfseSubstitution`, `discardNfseSubstitution` e `reconcileNfseEvent`.
- [ ] **Step 2:** Histórico com status novos. Ações por nota: XML, Cancelar, Substituir e Reconsultar. Janelas de cancelamento e substituição. O texto do botão de emissão muda conforme o estado.
- [ ] **Step 3:** Aviso de substituição aberta na venda, com o botão Desistir.
- [ ] **Step 4:** `npm run frontend:typecheck` e `npm run frontend:build`. Esperado: sem erros.

### Task 8: Verificação final e documentação

- [ ] `npm run typecheck` e `npm run backend:test`. Todos devem passar.
- [ ] Atualizar `docs/architecture/nfse-national-homologation.md` (estados, rotas e o estado operacional) e o manifesto.
- [ ] Subir backend e frontend com `npm run dev` e conferir a janela de NFS-e.
