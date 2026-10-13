# Propostas comerciais: implementação

Backend NestJS e PostgreSQL implementados com a migration aditiva `0018_crm_proposals.sql`. A migration cria propostas, itens, contador por empresa, eventos imutáveis e comandos idempotentes; adiciona o vínculo único `sales.source_proposal_id`, as atividades e as configurações comerciais. Constraints diferidas exigem 1–100 itens e totais correspondentes no commit. Triggers impedem alterar o documento emitido e seus itens.

## Cadastro de cliente ao salvar a proposta

O lead continua separado de Clientes durante a captação. Ao salvar a primeira proposta, a API cria e vincula o cliente na **mesma transação** da proposta. Um bloqueio no contato impede duplicação de cadastro em propostas concorrentes. Se o documento já estiver cadastrado, a API responde `PROPOSAL_CUSTOMER_CONFLICT` e o usuário seleciona/confirma o cliente existente. Nome, tipo e dados complementares são reaproveitados do lead; `newCustomer` permite completar os dados antes da gravação. CPF/CNPJ conhecido permite inferir PF/PJ; caso contrário é necessário informar o tipo.

Exemplo: `POST /crm/proposals`, com autenticação, `X-Company-Id` e `Idempotency-Key`:

```json
{
  "opportunityId": "UUID-da-negociacao",
  "newCustomer": { "kind": "PF" },
  "title": "Implantação de CRM",
  "paymentTerms": "Entrada de 50% e saldo em 30 dias",
  "validUntil": "2026-10-31",
  "items": [{
    "serviceId": "UUID-do-servico",
    "quantity": "1.0000",
    "unitPrice": "5000.00",
    "discountType": "PERCENT",
    "discountInput": "10.00"
  }]
}
```

Para lead já vinculado, omitir `newCustomer`. Para selecionar um cadastro existente, informar `customerId`. Para proposta originada diretamente num Cliente, usar `customerId` e `createOpportunity: true`; o backend cria/reutiliza contato e grava entrada/card explicitamente junto da proposta. Caso haja vários contatos, indicar `contactId`. A abertura da tela ou prefill não grava esses registros.

## Rotas

| Rota | Operação |
| --- | --- |
| `GET /crm/proposals/prefill` | Pré-preenchimento por `opportunityId`, `contactId` ou `customerId`; serviço sugerido e candidatos a cliente |
| `POST /crm/proposals` | Nova proposta com cliente e pelo menos um serviço |
| `GET /crm/proposals` | Lista por número/título/contato, cliente, negociação, responsável, serviço, status, criação e validade |
| `GET /crm/opportunities/:id/proposals` | Lista da negociação autorizada |
| `GET/PATCH /crm/proposals/:id` | Consulta e edição de rascunho com `expectedVersion` |
| `POST /crm/proposals/:id/send` | Congela documento e registra envio feito pelo usuário |
| `POST /crm/proposals/:id/accept` e `/decline` | Registra decisão com versão; motivo opcional na recusa |
| `POST /crm/proposals/:id/duplicate` | Nova oferta com vínculo à anterior; validade nova ou sem validade |
| `POST /crm/proposals/:id/convert` | Pedido rascunho único com itens da oferta aceita |
| `GET /crm/proposals/:id/history` | Auditoria paginada |
| `GET /crm/proposals/:id/preview` e `/pdf` | JSON ou PDF autorizado da oferta; rascunho identificado |
| `GET/PATCH /crm/proposal-settings` | Automação de ganho na conversão e etapa após envio; gestor altera com versão |

Os POSTs exigem chave de idempotência; comandos de estado, duplicação e conversão recebem `expectedVersion`. Replays revalidam a permissão atual. Valores usam strings decimais (dinheiro com 2 casas e quantidade com 4); o backend arredonda por item em centavos, preservando desconto em valor ou percentual. O código legível é `P-000001`, por empresa.

Status persistidos: `DRAFT`, `SENT`, `ACCEPTED`, `DECLINED`, `CONVERTED`. `effectiveStatus` inclui `EXPIRED` para enviada com validade anterior ao dia local da empresa, calculado igualmente em consultas e filtros. Propostas aceitas não vencem depois do aceite. Para renegociar uma proposta enviada, duplicar preservando a oferta anterior. Aceitar/recusar não altera automaticamente o status comercial da negociação.

## Conversão e documentos

Conversão reutiliza `SalesService.createDraftInTx` e insere pedido, itens, status, eventos e vínculo numa transação. Clique repetido ou comandos concorrentes devolvem o mesmo pedido. Colisão de código do pedido repete a transação integral. Itens mantêm os nomes/descrições congelados; serviços e cliente precisam continuar ativos. O rascunho abre em `/portal-de-servicos?editar=UUID&empresa=UUID`, onde o usuário revisa data, OS e pagamentos. Apenas a confirmação do pedido cria os recebíveis.

O PDF usa PDFKit e o snapshot da oferta enviada, sem buscar recursos externos. Preview/PDF de rascunho são permitidos com identificação de rascunho. A ação `send` registra o envio realizado pelo usuário; o envio automático por WhatsApp/e-mail e links públicos não fazem parte desta entrega.

## Frontend

A rota `/propostas` mostra resumo, filtros, lista, criação a partir de negociação ou cliente, edição de rascunho, histórico, PDF, envio, aceite, recusa, duplicação e conversão. O botão na negociação do CRM abre uma proposta nova preenchida; a área Clientes também permite iniciar uma proposta para um cadastro existente. Serviço sugerido e interesse da negociação preenchem a oferta. O usuário sempre seleciona ao menos um serviço. O modal **Novo serviço** usa `POST /services` e seleciona o cadastro recém-criado na proposta e no formulário de novo lead. Ao salvar proposta de lead sem cadastro, o editor exige PF/PJ e usa o cadastro transacional do backend.

A conversão abre o editor do pedido no Portal de Serviços. O botão **Registrar envio** grava um envio feito pelo usuário e orienta a compartilhar o PDF. Não envia mensagens automaticamente.

O build web e quatro testes Playwright passaram: lead com serviço novo e envio, cliente existente com contato escolhido, serviço rápido no novo lead, e abertura do pedido convertido na empresa correta. O contêiner web foi reconstruído após a implementação.

## Verificação e instalação

`tests/crm-proposals.test.ts` cobre 19 cenários num banco PostgreSQL isolado: cadastro automático/rollback do cliente, concorrência, idempotência, cliente existente, serviço de formulário, edição versionada, snapshot, PDF, validade/fuso, filtros, automações, isolamento e conversão com confirmação posterior no financeiro. A suíte total da API passou com 77 testes. TypeScript da API, banco e web e build web também passaram. O teste Playwright `e2e/proposal-sale-review.spec.ts` confirmou que o link de conversão abre o editor do pedido na empresa indicada, mesmo com outra empresa selecionada anteriormente.

Aplicação local:

```text
corepack pnpm db:migrate
docker compose up -d --build api worker web
```

A API no Docker também aplica migrations pendentes na inicialização. Contratos publicados em `http://localhost:3000/docs`. Nenhum teste envia mensagens ou faz chamadas à OpenAI.

Migration aplicada no banco local e contêineres `api`, `worker` e `web` reconstruídos nesta entrega. API saudável e 13 caminhos de propostas/configurações confirmados no Swagger do contêiner em execução.
