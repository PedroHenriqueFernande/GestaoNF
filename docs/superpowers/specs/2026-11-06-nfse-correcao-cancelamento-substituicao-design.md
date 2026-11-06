# NFS-e nacional: correção de rejeição, cancelamento e substituição

Data: 06/11/2026. Estado: **implementado** (homologação). Plano: [../plans/2026-11-06-nfse-correcao-cancelamento-substituicao.md](../plans/2026-11-06-nfse-correcao-cancelamento-substituicao.md). Diferenças em relação ao desenho original estão em "Ajustes na implementação" (seção 13).
Base: [ADR do emissor nacional](../../architecture/adr-nfse-national-emission.md) e [arquitetura de homologação](../../architecture/nfse-national-homologation.md).

## 1. Objetivo

Hoje, depois de uma rejeição, a venda fica travada sem saída, e uma nota autorizada não pode ser cancelada nem corrigida. Esta entrega cria três fluxos:

1. **Correção de rejeição:** o usuário corrige a venda ou os cadastros e emite de novo, com um número de DPS novo.
2. **Cancelamento:** evento `e101101` assinado e enviado ao ambiente nacional. A nota passa a `CANCELLED`, a venda continua confirmada e volta a ser editável.
3. **Substituição:** uma DPS nova com o grupo `<subst>`. Quando ela é autorizada, a original passa a `SUBSTITUTED`.

Como na emissão atual, tudo vale apenas para **homologação (Produção Restrita)**. A produção continua bloqueada.

## 2. Decisões do produto

| Decisão | Escolha |
|---|---|
| Origem dos dados corrigidos | **Edição da própria venda** e dos cadastros. Não há formulário paralelo da nota |
| Venda após cancelar a nota | **Continua `CONFIRMED`**, destravada. O financeiro não é alterado. O usuário decide se emite outra nota ou cancela a venda pelo fluxo comercial |
| Substituição em venda com várias notas | **Não suportada.** Disponível só quando a venda tem exatamente uma nota ativa. Para as demais, o caminho é cancelar e emitir de novo |
| Numeração após rejeição | **Número de DPS novo** em cada tentativa. Número comprometido nunca volta ao contador (ADR, decisão 4) |
| Arquitetura | **Várias emissões por venda, com no máximo uma aberta.** Cada nova emissão liga-se à anterior. O cancelamento é um evento processado pelo worker |

**Regra de agrupamento (já existente):** o leiaute nacional aceita um único `cTribNac` por DPS. Serviços com a mesma classificação e a mesma competência formam uma nota; classificações diferentes geram notas separadas.

## 3. Contrato oficial

O pacote `esquemas_prod_restrita_20261020.zip` foi baixado novamente em 06/11/2026. O SHA-256 `25fdcecc…ea267` confere com o [manifesto](../../architecture/nfse-national-research-manifest.json), e os XSDs já instalados são idênticos aos do pacote.

Esquemas a instalar em `backend/src/fiscal/contracts/homologation-20261020/`, com registro de hash no manifesto:

| Arquivo | SHA-256 |
|---|---|
| `pedRegEvento_v1.01.xsd` | `e90b6816d29cca0bd5ed8f86ad98d3b7b0d8bbfc11a7583e6ff8f98170fd4009` |
| `evento_v1.01.xsd` | `986d0a1c4d27454f712169849aa7c2380aaa4560bd9c920e0ff03ba6599ae28b` |
| `tiposEventos_v1.01.xsd` | `1b32bea21089dc232d78b62d805e9c07382f440d4e0ea2cb3fb6b82ebde68c11` |

Fatos dos esquemas usados neste desenho:

- **Pedido de cancelamento:** `pedRegEvento@versao=1.01` contém `infPedReg@Id`, com os campos `tpAmb`, `verAplic`, `dhEvento`, `CNPJAutor`, `chNFSe` e `e101101`. O `e101101` traz `xDesc="Cancelamento de NFS-e"`, `cMotivo` e `xMotivo`, seguido da assinatura `ds:Signature`.
- **Identificador do pedido:** `Id = "PRE" + chNFSe(50) + "101101"`, com 59 caracteres. Como não há número sequencial, existe no máximo um pedido de cancelamento por nota.
- **`cMotivo` do cancelamento:** `1` erro na emissão, `2` serviço não prestado, `9` outros. O `xMotivo` tem de 15 a 255 caracteres.
- **Retorno do governo:** o elemento `evento`, com `infEvento` contendo `nSeqEvento`, `dhProc`, `nDFSe` e o `pedRegEvento` original.
- **Grupo de substituição:** o `infDPS` recebe `subst` depois de `cLocEmi` e antes de `prest`. O `subst` leva `chSubstda`, `cMotivo` e, opcionalmente, `xMotivo`.
  - Motivos: `01` desenquadramento do Simples, `02` enquadramento no Simples, `03` inclusão retroativa de imunidade/isenção, `04` exclusão retroativa, `05` rejeição pelo tomador ou intermediário, `99` outros.
  - O motivo `99` exige `xMotivo` nesta entrega.
- **Efeito da substituição:** o ambiente nacional registra na original o evento `e105102`, "Cancelamento por Substituição", que contém `chSubstituta`.

**Pendente de confirmação no Swagger, junto com o restante do contrato** (`NFSE_CONTRACT_CONFIRMED`):
- o caminho `POST /nfse/{chaveAcesso}/eventos`;
- o nome do campo JSON (provável `pedidoRegistroEventoXmlGZipB64`);
- o campo de retorno (provável `eventoXmlGZipB64`);
- a consulta `GET /nfse/{chaveAcesso}/eventos/{tipoEvento}/{nSeqEvento}`.

O cliente HTTP isola esses nomes em constantes.

## 4. Banco de dados (migration 0029)

### 4.1 `nfse_emission_requests`

- Remove o índice único `nfse_emissions_sale_environment_uq`. A garantia de "uma emissão aberta por venda" passa a ser feita em código, sob o `FOR UPDATE` da venda que a emissão já usa.
- Novos campos:
  - `kind varchar(16) not null default 'ISSUE'`, com check `IN ('ISSUE','SUBSTITUTION')`.
  - `previous_emission_id uuid null`, com FK composta `(company_id, previous_emission_id)` para a própria tabela. É a última emissão da venda no mesmo ambiente.
  - `substitutes_document_id uuid null`, com FK composta para `nfse_documents`.
- Check: `kind = 'SUBSTITUTION'` se, e somente se, `substitutes_document_id` estiver preenchido.

### 4.2 `nfse_documents`

- `status varchar(16) not null default 'AUTHORIZED'`, com check `IN ('AUTHORIZED','CANCELLED','SUBSTITUTED')`.
- `cancelled_at timestamptz null` e `substituted_at timestamptz null`.
- `substituted_by_document_id uuid null`, com FK composta para a própria tabela.
- Campos da substituição aberta, todos nulos quando não há substituição:
  - `substitution_reason_code varchar(2)`, com check `IN ('01','02','03','04','05','99')`;
  - `substitution_reason_text text`, com 15 a 255 caracteres quando informado;
  - `substitution_opened_by_user_id uuid` e `substitution_opened_at timestamptz`;
  - `substitution_sale_version integer`.
- Check: os quatro campos obrigatórios da substituição aberta estão todos nulos ou todos preenchidos.

### 4.3 `nfse_document_events` (nova)

| Campo | Tipo e regra |
|---|---|
| `id`, `company_id` | PK; FK para a empresa |
| `document_id` | FK composta para `nfse_documents` |
| `environment` | `HOMOLOGATION` ou `PRODUCTION` |
| `event_type` | `varchar(6)`; nesta entrega, check `IN ('101101')` |
| `reason_code`, `reason_text` | `1`, `2` ou `9`; texto de 15 a 255 caracteres |
| `identifier` | `PRE…` com 59 caracteres; único por `(environment, identifier)` quando o status não for `REJECTED` |
| `status` | `PENDING`, `READY`, `SENDING`, `UNKNOWN`, `REGISTERED` ou `REJECTED` |
| `signed_xml`, `signed_xml_sha256`, `certificate_id` | Preenchidos ao assinar |
| `official_xml`, `official_xml_sha256`, `sequence_number`, `processed_at` | Preenchidos ao registrar |
| `last_error`, `lease_token`, `lease_expires_at`, `sent_at`, `next_action_at` | Mesma semântica de `nfse_dps` |
| `request_key`, `request_hash` | Idempotência; único `(company_id, request_key)` |
| `created_by_user_id`, `created_at`, `updated_at` | Auditoria |

Índice único parcial `nfse_document_events_active_uq` em `(document_id, event_type)` onde `status <> 'REJECTED'`. Com isso há no máximo um cancelamento em andamento ou registrado por nota; depois de uma recusa, é possível pedir de novo.

### 4.4 `nfse_transmission_attempts`

- `dps_id` passa a aceitar nulo. Entra `document_event_id uuid null`, com FK composta.
- Check: exatamente um entre `dps_id` e `document_event_id` está preenchido.
- O check de `operation` passa a aceitar também `SEND_EVENT` e `LOOKUP_EVENT`.

### 4.5 `nfse_events` (auditoria)

Não muda. Os eventos de cancelamento são registrados com o `emission_id` da DPS que originou a nota. Novas ações: `CANCEL_REQUESTED`, `CANCEL_SIGNED`, `CANCEL_SENDING`, `CANCELLED`, `CANCEL_REJECTED`, `CANCEL_UNKNOWN`, `SUBSTITUTION_OPENED`, `SUBSTITUTION_DISCARDED` e `SUBSTITUTED`.

## 5. Trava fiscal da venda

Um único módulo, `fiscal/sale-fiscal-state.ts`, calcula o estado dentro da transação que já trava a venda (`FOR UPDATE`). Ele é usado por `SalesService.update`, `SalesService.cancel`, pela prévia e pela emissão.

Definições:
- **DPS em processamento:** status `RESERVED`, `READY`, `SENDING` ou `UNKNOWN`.
- **Evento em processamento:** status `PENDING`, `READY`, `SENDING` ou `UNKNOWN`.
- **Nota ativa:** `nfse_documents.status = 'AUTHORIZED'`.

| Estado | Editar venda | Cancelar venda | Emitir |
|---|---|---|---|
| DPS ou evento em processamento | ✖ | ✖ | ✖ |
| Sem nota ativa: nunca emitida, tudo rejeitado ou tudo cancelado/substituído | ✔ | ✔ | ✔ emissão normal de todos os itens |
| Uma nota ativa com substituição aberta | ✔ | ✖ | ✔ apenas como **substituta** |
| Nota(s) ativa(s) cobrindo todos os itens, sem substituição | ✖ | ✖ | ✖ (`NFSE_ALREADY_AUTHORIZED`) |
| Nota(s) ativa(s) cobrindo só parte dos itens | ✖ (cadastros podem ser corrigidos) | ✖ | ✔ apenas os itens sem nota |

**Cobertura:** um item está coberto quando o `id` dele aparece no grupo do snapshot de uma DPS cuja nota está ativa. A prévia de emissão normal considera apenas os itens não cobertos.

As mensagens de erro atuais da venda passam a explicar o motivo da trava. Exemplos: "Há uma NFS-e autorizada para esta venda. Cancele ou substitua a nota para alterá-la" e "Há uma solicitação fiscal em andamento".

## 6. Fluxos

### 6.1 Correção de rejeição

1. Todas as DPS da emissão ficam `REJECTED`. O usuário vê os motivos e a orientação "corrija a venda ou os cadastros e emita novamente".
2. A venda fica editável (seção 5). O usuário edita, faz nova prévia e emite.
3. Em `NfseIssuanceService.emit`, a checagem antiga "já existe solicitação" é substituída pela trava fiscal. A nova emissão recebe `previous_emission_id` igual à última emissão da venda e reserva números novos.
4. Quando a rejeição é parcial (algum grupo autorizado), a nova emissão cobre apenas os itens sem nota. A venda continua travada, mas os cadastros podem ser corrigidos.

### 6.2 Cancelamento

1. A rota `POST /fiscal/nfse/documents/:id/cancel` recebe o cabeçalho `Idempotency-Key` e o corpo `{ reasonCode: '1'|'2'|'9', reasonText }`.
2. Numa transação, o sistema:
   - trava a venda e a nota;
   - exige nota ativa, sem substituta em processamento, sem cancelamento ativo e no ambiente `HOMOLOGATION`;
   - grava `nfse_document_events` como `PENDING`, a outbox `nfse.event` e a auditoria `CANCEL_REQUESTED`.

   A rota responde 202.
3. O worker (`NfseEventProcessorService`) usa lease por evento e o mesmo controle de lote da DPS. Os passos:
   1. Monta o `pedRegEvento` com `dhEvento` igual ao horário atual e `CNPJAutor` igual ao CNPJ do prestador da nota.
   2. Assina o `infPedReg` com o perfil de assinatura configurado.
   3. Valida contra `pedRegEvento_v1.01.xsd` e grava `READY`.
   4. Marca `SENDING` e envia ao endpoint de eventos.
4. Tratamento da resposta:
   - **2xx com XML de evento:** valida contra `evento_v1.01.xsd` e confere `chNFSe`, o tipo `101101`, `tpAmb=2` e o CNPJ do autor. Numa transação, o evento vai para `REGISTERED` (com XML e sequência) e a nota para `CANCELLED`, com `cancelled_at`.
   - **4xx com `erros`, exceto 409 e 429:** o evento vai para `REJECTED` com o motivo, por exemplo prazo vencido. A nota continua ativa.
   - **Timeout, 5xx ou resposta ilegível:** o evento vai para `UNKNOWN`. A próxima execução consulta o evento antes de qualquer reenvio. Um reenvio só repete o **mesmo** XML assinado, com a mesma identidade.
5. Depois de `CANCELLED`, a venda volta a ficar editável e permite emitir de novo.

### 6.3 Substituição

1. A rota `POST /fiscal/nfse/documents/:id/substitution` recebe `{ reasonCode: '01'..'05'|'99', reasonText? }`. O `reasonText` é obrigatório quando o motivo é `99`.
2. Exige uma única nota ativa na venda, sem evento ou DPS em processamento. Grava os campos de substituição aberta e `substitution_sale_version = sales.version`, além da auditoria `SUBSTITUTION_OPENED`. A venda fica editável.
3. Com a substituição aberta, a prévia funciona em modo substituição:
   - cobre todos os itens da venda;
   - precisa resultar em **um único grupo**, senão gera o erro `SUBSTITUTION_SINGLE_GROUP`;
   - o snapshot ganha `substitution: { documentId, accessKey, reasonCode, reasonText }`, que entra no hash.
4. Na emissão, o `kind` é `SUBSTITUTION` e `substitutes_document_id` é preenchido. O `buildDps` inclui `<subst>` na posição do XSD.
5. Na autorização da substituta, além das conferências atuais, o XML autorizado precisa conter `chSubstda` igual à chave da original. Na mesma transação:
   - a original vai para `SUBSTITUTED`, com `substituted_at` e `substituted_by_document_id`;
   - os campos de substituição aberta são limpos;
   - a auditoria registra `SUBSTITUTED`.
6. Se a substituta for rejeitada, a original continua `AUTHORIZED` e a substituição continua aberta. O usuário corrige e tenta de novo.
7. A rota `DELETE /fiscal/nfse/documents/:id/substitution` só funciona quando `sales.version = substitution_sale_version` e não há substituta em processamento. Ela limpa os campos e registra `SUBSTITUTION_DISCARDED`. Se a venda já foi alterada, a resposta é 409, com a orientação de emitir a substituta ou desfazer as alterações na venda.

## 7. API

Todas as rotas exigem autenticação, `CompanyGuard` e papel `OWNER` ou `ADMIN` (`NfsePreviewService.manager`). As entradas são validadas com Zod estrito.

| Rota | Resposta |
|---|---|
| `POST /sales/:saleId/nfse/emissions` *(ajustada)* | 202. Erros 409: `NFSE_IN_PROGRESS`, `NFSE_ALREADY_AUTHORIZED` e `SUBSTITUTION_SINGLE_GROUP` |
| `GET /sales/:saleId/nfse/emissions` *(ampliada)* | Lista ordenada com `kind`, `previousEmissionId` e itens com documento (`status`, substituição aberta e cancelamento ativo), além do estado de trava da venda |
| `POST /fiscal/nfse/documents/:id/cancel` | 202, com o evento |
| `GET /fiscal/nfse/document-events/:id` | Situação do cancelamento |
| `POST /fiscal/nfse/document-events/:id/reconcile` | 202. Agenda nova consulta, só para `UNKNOWN` ou `READY` |
| `POST /fiscal/nfse/documents/:id/substitution` | 200, com a nota atualizada |
| `DELETE /fiscal/nfse/documents/:id/substitution` | 204 |

## 8. Worker

- `NfseWorkerService` passa a consumir também o tópico `nfse.event` e encaminha para `NfseEventProcessorService.process`.
- A política de nova tentativa é igual à de `nfse.process`:
  - `WAIT` volta à fila em 5 s;
  - `UNKNOWN` usa backoff exponencial de até 15 min, com no máximo 8 tentativas;
  - depois disso, o evento fica `UNKNOWN` aguardando reconsulta manual.
- Novo módulo `nfse-event-contract.ts`, com quatro funções:
  - `eventIdentifier(chave)`;
  - `buildCancellationRequest(...)`;
  - `signEvent(...)`, que reaproveita o assinador XMLDSig com referência em `infPedReg`;
  - `validateEventXml(xml, 'pedRegEvento' | 'evento')`.

## 9. Frontend

Na janela de NFS-e da venda (`NfseSaleActions.tsx`):

- **Histórico de emissões:** cada tentativa mostra número da DPS, status, motivo da rejeição e documento. Os status novos são Cancelada, Substituída, Cancelamento em andamento e Substituição aberta.
- **Ações por nota ativa:**
  - **Baixar XML.**
  - **Cancelar:** abre a janela de cancelamento, com o seletor de motivo e a justificativa (contador de 15 a 255 caracteres).
  - **Substituir:** só quando a venda tem uma nota. Abre uma janela com o seletor de motivo e o texto.
  - **Reconsultar:** para cancelamentos `UNKNOWN`.
- **Botão de emissão:** o texto passa a ser Emitir NFS-e, Emitir novamente (depois de rejeição ou cancelamento) ou Emitir substituta, conforme o estado. Fica desabilitado quando a trava impede.

Na tela da venda (`SaleEditor` e `SaleDetailPanel`):
- Aviso "Substituição da NFS-e nº X em andamento: corrija a venda e clique em Emitir substituta", com o botão **Desistir**.
- As mensagens de trava vêm do estado calculado no servidor.

Tipos novos em `frontend/src/api/nfse.types.ts` e métodos novos em `api/client.ts`.

## 10. Testes

Vitest com Postgres real, no padrão de `backend/tests/*.test.ts`, que cria banco temporário e aplica as migrations. Testes de unidade para o XML.

1. **XML:**
   - o pedido de cancelamento assinado valida contra `pedRegEvento_v1.01.xsd`, e o `Id` tem 59 caracteres no padrão `PRE…101101`;
   - a DPS com `<subst>` valida contra `DPS_v1.01.xsd`;
   - a assinatura do evento é verificada.
2. **Trava fiscal:** a matriz da seção 5, com edição e cancelamento da venda permitidos ou bloqueados em cada estado.
3. **Rejeição:** a nova emissão depois de tudo rejeitado usa número novo e preenche `previous_emission_id`. Não é possível emitir com DPS em processamento. A rejeição parcial cobre só os itens sem nota.
4. **Cancelamento:**
   - idempotência da rota e dois pedidos concorrentes resultando em um único evento ativo;
   - worker com cliente simulado em três cenários: registrado (nota `CANCELLED`), recusado (nota continua ativa) e incerto (consulta e depois registra);
   - pedido novo permitido depois de `REJECTED`.
5. **Substituição:**
   - abrir, editar a venda, emitir e autorizar resulta na original `SUBSTITUTED`;
   - a rejeição da substituta mantém a original ativa;
   - desistir é bloqueado depois de editar a venda;
   - a edição que gera dois grupos resulta em `SUBSTITUTION_SINGLE_GROUP`;
   - um retorno sem `chSubstda` correspondente não marca a original.
6. **Isolamento:** uma empresa não acessa nota, evento ou substituição de outra empresa.

## 11. Fora de escopo

- Substituição em venda com mais de uma nota ativa: bloqueada com orientação.
- Solicitação de análise fiscal para cancelamento fora do prazo (`e101103`) e demais eventos (manifestações, bloqueios).
- Emissão, cancelamento e substituição em produção: continuam bloqueados até a liberação específica.
- PDF/DANFSe de nota cancelada com tarja. A tela mostra o status, e o XML continua disponível.

## 12. Ordem de implementação

1. Instalar os XSDs de evento, atualizar o manifesto e criar `nfse-event-contract.ts`, com os testes de XML.
2. Escrever a migration 0029 e atualizar o schema Drizzle.
3. Criar `sale-fiscal-state.ts` e aplicar em `SalesService.update` e `cancel`, com os testes da matriz.
4. Correção de rejeição na emissão (`emit`, cobertura e `previous_emission_id`), com testes.
5. Cancelamento: rota, worker, cliente e reconsulta, com testes.
6. Substituição: abrir e desistir, prévia em modo substituição, `<subst>` no `buildDps` e marcação na autorização, com testes.
7. Frontend: histórico, janelas de cancelamento e substituição, avisos na venda.
8. Atualizar a documentação de arquitetura (seções 10 e 11 da homologação) e o ADR, na seção de gatilhos de revisão.

## 13. Ajustes na implementação

- **Estado da venda em endpoint próprio.** `GET /sales/:saleId/nfse/emissions` continua devolvendo a lista de emissões (agora com `kind`, `previousEmissionId` e o status/cancelamento/substituição de cada nota). O estado de trava e as ações possíveis saem em `GET /sales/:saleId/nfse/state`, para não mudar o formato que a tela já consome.
- **Desistir da substituição compara conteúdo, não versão.** A versão da venda só cresce; com a regra "versão igual", quem editasse e desfizesse a alteração nunca poderia desistir. A rota compara os grupos fiscais, o cliente, o emissor e o regime da nota emitida com os que a venda geraria hoje. Ids de itens ficam fora da comparação, porque cada edição recria os itens. A comparação usa JSON canônico, porque o `jsonb` do PostgreSQL não preserva a ordem das chaves.
- **Substituição exige que a nota cubra a venda inteira.** Além de "uma única nota ativa", a nota precisa cobrir todos os serviços da venda (`SUBSTITUTION_PARTIAL`); caso contrário a substituta incluiria serviços que a original nunca teve.
- **Conferência de assinatura.** `signXml` passou a verificar a assinatura filha direta da raiz, e não a primeira do documento. Em `evento` e `NFSe` a primeira é uma assinatura aninhada.
- **Testes.** `backend/tests/nfse-lifecycle.test.ts` usa o `SalesService`, a prévia, a emissão, o processador de DPS e o de cancelamento reais sobre um banco isolado. Só o certificado e o ambiente nacional são simulados; o simulador devolve XML de NFS-e e de evento válidos no XSD oficial.
- **Campos imutáveis na substituição (E0061/E0063), descoberto na leitura do Anexo I em 06/11/2026.** Para MEI e ME/EPP que continuam no regime, a competência, o tomador e o valor do serviço não podem mudar na nota substituta. A prévia em modo substituição bloqueia a emissão e orienta a cancelar e emitir outra nota; a janela de substituição avisa isso antes de abrir. O desenho original permitia editar tudo.
- **Respostas do governo (seção 10.2 da homologação).** Erros em formatos alternativos, 4xx de negócio sempre como rejeição, 401/403/404 como "não processada" (a DPS volta a `READY` e é retomada sem consulta), margem de 1 minuto em `dhEmi`/`dhEvento` e aviso em vez de erro quando o XML autorizado difere do XSD local.
- **Prontidão e teste de conexão (seção 10.3).** Endpoints e painel em Fiscal → Séries e numeração.
