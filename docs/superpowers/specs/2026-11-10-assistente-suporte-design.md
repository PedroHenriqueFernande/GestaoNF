# Assistente de suporte (widget no sistema)

Data: 10/11/2026. Estado: **desenho aprovado**, aguardando o plano de implementação.

## 1. Objetivo

Criar um widget de chat fixo no canto inferior direito de todas as telas autenticadas. Ele ajuda o usuário a usar o GestãoNF: explica funcionalidades, leva até a tela certa, gera relatórios em PDF na hora, cadastra clientes e serviços (sempre com confirmação) e localiza a venda para emitir NFS-e.

Este assistente **não é o Nero**:

| | Nero | Assistente de suporte |
|---|---|---|
| Canal | WhatsApp | Widget dentro do sistema |
| Papel | Secretário, com personalidade, executa ações | Suporte das funcionalidades, impessoal |
| Código | `backend/src/assistant/` (identificador legado `nilo`) | `backend/src/support/`, `frontend/src/features/support/` |
| Tabelas | `assistant_runs`, `assistant_actions` | `support_conversations`, `support_messages`, `support_actions` |

Os dois usam a mesma chave da OpenAI, mas não compartilham prompt, tools, histórico nem tabelas. A API não treina modelos com as chamadas e ambos usam `store: false`. Compartilham apenas saldo e rate limit.

## 2. Decisões do produto

| Decisão | Escolha |
|---|---|
| Alcance das ações | Orienta, consulta, gera PDF e cadastra **cliente e serviço** com cartão de confirmação. **Não emite NFS-e**: localiza a venda e abre a tela de emissão |
| Fonte do "como fazer" | Base de ajuda em Markdown no repositório (`backend/src/support/help/`), consultada pela tool `buscar_ajuda` |
| Relatórios em PDF | Os 8 relatórios existentes, por um gerador genérico. Gerados na hora, sem armazenar no R2 |
| Conversa | Guardada no servidor, uma ativa por usuário + empresa, expira após 24 h sem uso, botão "Nova conversa". Sem lista de conversas antigas |
| Provedor de IA | OpenAI, mesma chave do Nero por padrão, modelo próprio (`SUPPORT_AI_MODEL`, padrão `gpt-6-luna`), atrás da interface `SupportLlmClient` |
| Arquitetura | Orquestrador no backend com tools. Escritas viram ações pendentes, confirmadas por um endpoint que não usa IA |
| Testes | Mantidos no repositório (exceção explícita ao `ArquivosMD/procedimento-padrao-testes.md` para esta feature) |

## 3. Custo

Preços de referência pesquisados em 10/11/2026 (as fontes divergem nos modelos mais novos, então confirmar na página oficial): `gpt-6-luna` em torno de US$ 0,10–0,20 por 1M tokens de entrada e US$ 0,50 de saída. Trocar de provedor (Gemini Flash-Lite, DeepSeek) não traz economia relevante e acrescenta outra integração.

A economia vem da arquitetura:

1. **Atalhos sem IA:** o mini formulário de PDF e os artigos de ajuda abertos direto não chamam o modelo.
2. **Contexto curto:** instruções enxutas, ajuda só sob demanda, histórico limitado a 10 mensagens, `max_output_tokens` de 500.
3. **Prefixo estável** (instruções + lista de tópicos) no início, para aproveitar o cache automático de prompt.
4. **Limite diário por empresa** (`SUPPORT_DAILY_MESSAGE_LIMIT`, padrão 100).

Estimativa: cerca de 2.500 tokens de entrada e 300 de saída por mensagem, ou seja, menos de US$ 0,001 por mensagem.

## 4. Configuração

| Variável | Padrão | Uso |
|---|---|---|
| `SUPPORT_AI_ENABLED` | `false` | Liga o chat com IA. Desligado, o widget mostra só os atalhos |
| `SUPPORT_AI_MODEL` | `gpt-6-luna` | Modelo do suporte, independente de `OPENAI_MODEL` |
| `SUPPORT_OPENAI_API_KEY` | vazio | Chave própria opcional (outro Project da OpenAI, para separar custos). Vazia, usa `OPENAI_API_KEY` |
| `SUPPORT_AI_BASE_URL` | vazio | `baseURL` opcional para provedor compatível com a API da OpenAI |
| `SUPPORT_DAILY_MESSAGE_LIMIT` | `100` | Mensagens do usuário por empresa por dia (no fuso da empresa) |
| `SUPPORT_PDF_MAX_ROWS` | `5000` | Teto de linhas do PDF |
| `SUPPORT_AI_FAKE` | `false` | Usa o `FakeSupportLlmClient` (testes e Playwright). Ignorado com `NODE_ENV=production` |

Atualizar o `.env.example`.

## 5. Arquitetura do backend

Novo módulo `backend/src/support/`, importado em `app.module.ts`.

| Unidade | Responsabilidade |
|---|---|
| `support.module.ts` | Importa os módulos de clientes, serviços, vendas e relatórios para usar os services deles |
| `support.controller.ts` | Endpoints da seção 7, com `AccessGuard` + `CompanyGuard` |
| `support-chat.service.ts` | Orquestra uma mensagem (seção 8.1) |
| `support-conversations.service.ts` | Busca, cria, expira e encerra a conversa ativa. Lê e grava mensagens |
| `support-actions.service.ts` | Cria, confirma, cancela e expira ações pendentes |
| `llm/support-llm.client.ts` | Interface `SupportLlmClient` e o token de injeção |
| `llm/openai-support-llm.client.ts` | Adapter da Responses API (`store: false`, `parallel_tool_calls: false`, timeout de 15 s, uma nova tentativa em 5xx). Traduz erros em `SupportLlmError` com `code` (seção 10) |
| `tools/*.ts` | Um arquivo por tool: definição (JSON schema `strict`), schema Zod dos argumentos e handler |
| `tools/tool-registry.ts` | Junta as tools, valida os argumentos e despacha para o handler |
| `help/*.md` | Base de ajuda, um arquivo por tópico |
| `help-catalog.ts` | Lê os `.md` na inicialização, faz o parse do frontmatter, expõe `list()`, `get(id)` e `search(termo)` |
| `support.schemas.ts` | Zod das entradas HTTP e dos blocos |

### 5.1 Interface do LLM

```ts
interface SupportLlmClient {
  respond(input: {
    instructions: string;
    items: unknown[];            // histórico no formato da Responses API
    tools: SupportToolDefinition[];
  }): Promise<{ outputItems: unknown[]; text: string; toolCalls: { callId: string; name: string; arguments: string }[];
               usage: { inputTokens: number; outputTokens: number } | null }>;
}
```

Um `FakeSupportLlmClient` com respostas roteirizadas é usado nos testes e no Playwright (`SUPPORT_AI_FAKE=true`, aceito só fora de produção).

### 5.2 Tools

| Tool | Tipo | Argumentos | Resultado ao modelo | Bloco gerado pelo servidor |
|---|---|---|---|---|
| `buscar_ajuda` | leitura | `topico` (enum dos ids do catálogo) | conteúdo do `.md` | nenhum |
| `abrir_tela` | leitura | `destino` (enum: `clientes`, `servicos`, `portal_servicos`, `financeiro`, `relatorios`, `fiscal_series`, `fiscal_tributacao`, `empresa`, `crm`, `agenda`, `propostas`, `nero`, `usuarios`, `meu_perfil`) | `{ ok: true }` | `navigate` |
| `gerar_relatorio_pdf` | leitura | `tipo` (enum dos 8), `de`, `ate` (YYYY-MM-DD ou null nos inventários) | resumo do relatório (`summary`) | `download` |
| `localizar_venda_para_emissao` | leitura | `busca` (código do pedido ou nome do cliente) | até 5 vendas: código, cliente, data, total, situação fiscal | `navigate` por venda (`/portal-de-servicos?abrir=<id>&empresa=<id>`) |
| `preparar_cadastro_cliente` | escrita | campos de `createCustomerSchema` (obrigatórios `kind`, `name`) | ação criada, ou erros de validação/duplicidade | `action` |
| `preparar_cadastro_servico` | escrita | campos de `createServiceSchema` (obrigatório `name`) | ação criada, ou erros de validação | `action` |

Regras:

- Os argumentos passam por Zod. Um erro volta ao modelo como `function_call_output` com a mensagem, e o usuário não vê nada.
- `gerar_relatorio_pdf` executa a mesma leitura do relatório antes de devolver o link: falha de período ou teto aparece já no chat.
- `preparar_cadastro_cliente` verifica CPF/CNPJ duplicado na empresa com a mesma regra do `CustomersService`.
- Uma nova ação pendente cancela a anterior da mesma conversa (`CANCELED`). Só existe uma pendente por conversa.

### 5.3 Base de ajuda

Formato de cada arquivo:

```md
---
id: emitir-nfse
titulo: Como emitir uma NFS-e
rota: portal_servicos
palavras-chave: [nota, nfse, emitir, emissão]
---
Passo a passo, pré-requisitos (certificado, série, tributação) e erros comuns.
```

Tópicos iniciais: `clientes`, `servicos`, `portal-servicos`, `emitir-nfse`, `cancelar-substituir-nfse`, `certificado-digital`, `series-nfse`, `tributacao`, `financeiro`, `relatorios`, `crm`, `agenda`, `propostas`, `usuarios`, `empresa`, `meu-perfil`, `nero-whatsapp`. A primeira versão é escrita a partir do código e das docs atuais e revisada por Pedro. O teste de catálogo exige que todo `id` seja único, todo `rota` exista no enum de destinos e todo arquivo tenha conteúdo.

### 5.4 PDF dos relatórios

- `ReportsPdfService` no `ReportsModule` existente, usando `pdfkit`.
- Endpoint `GET /reports/:type.pdf` com os mesmos filtros e guardas do JSON. Usa o `ReportsReadService`, com o mesmo escopo de CRM, percorrendo as páginas até o fim ou até `SUPPORT_PDF_MAX_ROWS`. Acima do teto, responde `422` com "Reduza o período".
- `report-pdf-columns.ts` declara, por tipo, título, colunas (rótulo, campo, largura, formato: texto, data, moeda, percentual) e os indicadores do `summary`.
- Layout: cabeçalho com empresa, título, período e data/hora de geração no fuso da empresa; bloco de indicadores; tabela com cabeçalho repetido a cada página; rodapé "Página X de Y".
- `Content-Type: application/pdf`, `Content-Disposition: attachment; filename="<tipo>-<de>-<ate>.pdf"`.
- A tela de Relatórios ganha o botão **Exportar PDF** ao lado do CSV, nos 8 relatórios.

## 6. Arquitetura do frontend

Pasta `frontend/src/features/support/`:

| Unidade | Responsabilidade |
|---|---|
| `SupportWidget.tsx` | Botão flutuante e abertura do painel. Montado no `WorkspaceLayout`, exceto com `onboarding`. Recebe o `companyId` do layout; ao trocar de empresa, carrega a conversa daquela empresa |
| `SupportPanel.tsx` | Cabeçalho ("Ajuda do GestãoNF", Nova conversa, fechar), lista de mensagens, campo de texto, estado "digitando" enquanto aguarda |
| `QuickActions.tsx` | Atalhos sem IA, mostrados com a conversa vazia e acessíveis por um botão fixo |
| `ReportPdfForm.tsx` | Mini formulário: tipo, período (mês atual por padrão), Baixar. Chama `GET /reports/:type.pdf` direto |
| `HelpArticle.tsx` | Mostra um artigo de `GET /support/help/:id` |
| `blocks/TextBlock.tsx` | Markdown simples (negrito, listas, links internos), sem `dangerouslySetInnerHTML` |
| `blocks/NavigateBlock.tsx` | Botão que usa `navigate()` do react-router |
| `blocks/DownloadBlock.tsx` | Baixa o PDF com o token e o `X-Company-Id` (fetch + blob), como no CSV atual |
| `blocks/ConfirmActionCard.tsx` | Lista de campos, botões Confirmar e Cancelar, estados (pendente, criado com link, cancelado, expirado, falhou) |
| `blocks/NoticeBlock.tsx` | Avisos de indisponibilidade e de limite |
| `support.css` | Estilos no padrão visual do sistema; no celular, o painel ocupa a tela inteira |

Funções novas no `api/client.ts`: `supportConversation`, `supportSend`, `supportReset`, `supportConfirm`, `supportCancel`, `supportHelpList`, `supportHelp`, `reportPdf`.

O `SalesPage` passa a aceitar `?abrir=<id>&empresa=<id>`, que abre o painel de detalhe da venda, onde fica a emissão. Segue a mesma validação do `?editar=` (UUID, empresa acessível, limpa os parâmetros depois).

## 7. Endpoints

Todos com `AccessGuard` + `CompanyGuard`. A empresa vem do `X-Company-Id` e o usuário do token. A conversa ativa é sempre a do par usuário + empresa: o cliente nunca informa `conversationId`.

| Método | Rota | IA | Resposta |
|---|---|---|---|
| `GET` | `/support/conversation` | não | `{ conversation: { id, messages: SupportMessage[] } \| null, aiEnabled: boolean }` |
| `POST` | `/support/conversation/messages` | sim | corpo `{ text }` (1–1000 caracteres). Resposta `{ messages: SupportMessage[] }` com a mensagem do usuário e a do assistente |
| `POST` | `/support/conversation/reset` | não | `204` |
| `POST` | `/support/actions/:id/confirm` | não | `{ block: ActionBlock }` atualizado |
| `POST` | `/support/actions/:id/cancel` | não | `{ block: ActionBlock }` atualizado |
| `GET` | `/support/help` | não | `[{ id, titulo }]` |
| `GET` | `/support/help/:id` | não | `{ id, titulo, rota, conteudo }` |
| `GET` | `/reports/:type.pdf` | não | arquivo PDF |

## 8. Fluxos

### 8.1 Mensagem

1. Validar `text`. Buscar a conversa ativa e fechá-la se `last_message_at` tiver mais de 24 h; criar outra se não houver.
2. Contar as mensagens de usuário da empresa no dia (fuso da empresa). No limite, responder `429` com bloco `notice`, sem gravar.
3. Gravar a mensagem do usuário.
4. Se a IA estiver desligada ou sem chave, gravar e devolver o `notice` "Chat com IA desativado".
5. Montar a entrada: instruções (seção 9) + `llm_items` das últimas 10 mensagens + a nova.
6. Loop com até 4 chamadas: executar cada `function_call` pelo registry, guardar o `function_call_output` e acumular os blocos gerados pelo servidor. Terminar quando a resposta não tiver tool calls.
7. Gravar a mensagem do assistente: blocos = `text` (se houver) + blocos das tools, mais `llm_items`, modelo, tokens, `tool_call_count`. Atualizar `last_message_at`.
8. Devolver as duas mensagens.

Se as 4 voltas se esgotarem, a resposta fixa é "Não consegui concluir. Tente reformular ou use os atalhos." Em erro do LLM, ver a seção 10.

### 8.2 Confirmação de cadastro

1. `support_actions` com `PENDING`, `payload` já validado e `expires_at` = agora + 15 min.
2. `confirm`: buscar pelo `id` **e** pelo `company_id`/`user_id` da requisição (outro dono responde `404`). Se `expires_at` passou, marcar `EXPIRED` e responder `409`.
3. Em transação: `UPDATE support_actions SET status='CONFIRMED' WHERE id=$1 AND status='PENDING' RETURNING *`. Sem linha retornada, `409`. Revalidar o `payload` com o schema do domínio e chamar `CustomersService.create(companyId, userId, payload)` ou `ServicesService.create(...)`. Gravar `result_entity_id` e `confirmed_at`.
4. Se o service falhar (ex.: duplicidade por corrida), marcar `FAILED` com a mensagem do domínio. A ação não é reaproveitada.
5. Atualizar o bloco `action` na mensagem de origem (`support_messages.blocks`), para o histórico mostrar o estado final, e devolver o bloco com `resultTo` (`/Clientes` ou `/servicos`).

`cancel` funciona do mesmo jeito para `PENDING`, resultando em `CANCELED`.

## 9. Instruções do modelo

> Você é o assistente de suporte do GestãoNF, sistema de gestão e emissão de NFS-e para MEI e empresas do Simples Nacional. Responda em português do Brasil, de forma objetiva, sem personalidade e sem emojis.
> Explique funcionalidades somente com base em `buscar_ajuda`. Se o assunto não estiver na ajuda, diga que não sabe e ofereça `abrir_tela` para a tela mais próxima.
> Para cadastrar cliente ou serviço, use `preparar_cadastro_*` e diga que o usuário deve conferir e confirmar no cartão. Nunca afirme que algo foi criado.
> Você não emite notas: use `localizar_venda_para_emissao` e ofereça abrir a venda.
> Nunca peça nem use identificadores de empresa ou de usuário. Não responda sobre assuntos fora do GestãoNF.
> Tópicos de ajuda: <lista id — título>. Empresa: <nome>. Data: <YYYY-MM-DD>.

As partes fixas vêm antes das variáveis (empresa e data), para preservar o cache de prompt.

## 10. Erros

| Situação | `error_code` | O que o usuário vê |
|---|---|---|
| OpenAI 429 `insufficient_quota` | `AI_QUOTA` | `notice`: "O assistente está indisponível no momento. Os atalhos continuam funcionando." |
| OpenAI 429 de rate limit | `AI_RATE_LIMIT` | mesmo aviso |
| OpenAI 400 | `AI_BAD_REQUEST` | mesmo aviso |
| OpenAI 401/403 | `AI_AUTH` | mesmo aviso |
| Timeout ou 5xx após uma nova tentativa | `AI_UNAVAILABLE` | mesmo aviso |
| IA desligada ou sem chave | `AI_DISABLED` | "Chat com IA desativado" e atalhos |
| Limite diário | — | `429` com `notice` de limite |
| Ação expirada ou já usada | — | `409`, cartão atualizado |
| Ação de outro usuário ou empresa | — | `404` |
| Falha no `create` | — | cartão `FAILED` com a mensagem do domínio |
| PDF acima do teto | — | `422` "Reduza o período" |

Em erro do LLM, a mensagem do usuário fica gravada, a do assistente é gravada com o `notice` e o `error_code`, e o endpoint responde `200`. O log registra `error_code`, status HTTP e `request_id` da OpenAI, sem o texto do usuário.

## 11. Banco de dados

Migração Drizzle nova em `backend/database` (próxima após `0030`).

**`support_conversations`**: `id` uuid PK; `company_id`, `user_id` (FKs e FK composta para `company_users`, como em `assistant_runs`); `status` varchar (`ACTIVE` | `CLOSED`, check); `last_message_at`, `created_at`, `closed_at`. Índice único parcial `(company_id, user_id) WHERE status = 'ACTIVE'`.

**`support_messages`**: `id` uuid PK; `conversation_id` FK; `company_id` FK; `role` (`user` | `assistant`, check); `blocks` jsonb not null; `llm_items` jsonb (nunca exposto); `model`; `input_tokens`, `output_tokens`, `tool_call_count` (check >= 0); `error_code`; `created_at`. Índices `(conversation_id, created_at)` e `(company_id, role, created_at)`, este para o limite diário.

**`support_actions`**: `id` uuid PK; `conversation_id`, `message_id` FKs; `company_id`, `user_id` (FK composta); `kind` (`CREATE_CUSTOMER` | `CREATE_SERVICE`, check); `status` (`PENDING` | `CONFIRMED` | `CANCELED` | `EXPIRED` | `FAILED`, check); `payload` jsonb not null; `result_entity_id` uuid; `error_message`; `expires_at`, `confirmed_at`; timestamps. Índice único parcial `(conversation_id) WHERE status = 'PENDING'`.

FKs com `onDelete: 'restrict'`, como no restante do schema.

## 12. Segurança

- Empresa e usuário vêm sempre dos guards. O modelo não recebe nem devolve IDs de empresa ou de usuário.
- Os handlers chamam os services de domínio com o contexto da requisição, então permissões e escopo de CRM valem igual às telas.
- `navigate` só aceita destinos do enum ou o deep link de venda montado pelo servidor. `download` só aponta para `/reports/<tipo>.pdf` com tipo do enum.
- O texto do modelo é renderizado como texto, sem HTML.
- Escrita só pelo endpoint de confirmação, com mudança de estado atômica e revalidação.
- `llm_items` nunca sai do backend. O histórico enviado ao modelo vem só do banco.

## 13. Testes (mantidos no repositório)

**Backend (Vitest, Postgres local, `backend/tests/support-*.test.ts`)**, com `FakeSupportLlmClient`:

1. Mensagem grava usuário e assistente; o histórico enviado ao LLM tem no máximo 10 mensagens.
2. Isolamento: conversa da empresa A não aparece na B; usuário X não vê a do Y.
3. Expiração por 24 h fecha a conversa e abre outra; `reset` encerra a ativa.
4. `preparar_cadastro_cliente` com CPF inválido não cria ação e devolve erro ao modelo; válido cria `PENDING`; nova ação cancela a anterior.
5. Confirmação cria o cliente exatamente uma vez com dois confirms em paralelo; expirada responde `409`; de outro usuário responde `404`; falha do domínio vira `FAILED`.
6. Erros do LLM (429 quota, 429 rate limit, 400, 401, timeout): bloco `notice`, `error_code` gravado, HTTP 200.
7. A mensagem 101 do dia responde `429`.
8. `abrir_tela` com destino fora do enum é rejeitado; blocos `download` só com `/reports/*.pdf`.
9. Catálogo de ajuda: ids únicos, rotas válidas, conteúdo não vazio.
10. `GET /reports/:type.pdf` nos 8 tipos devolve `application/pdf` começando com `%PDF`; respeita o escopo de CRM do colaborador; acima do teto responde `422`.

**Verificação real da API:** `backend/scripts/check-support-ai.ts` (`npm run support:check`) faz uma chamada com a configuração atual e imprime status HTTP e `error_code`. Com a billing zerada, o resultado esperado é `AI_QUOTA`, o que prova que a chamada sai.

**Frontend (Playwright, `frontend/tests/support-widget.spec.ts`, backend com `SUPPORT_AI_FAKE=true`):** abrir o widget, enviar mensagem e confirmar o cartão de cadastro; baixar PDF pelo atalho sem IA; trocar de empresa e ver a conversa trocar.

## 14. Fora do escopo

- Emitir NFS-e, criar venda, editar ou excluir qualquer registro pelo chat.
- Streaming (SSE). O contrato de blocos permite acrescentar depois.
- Lista de conversas antigas, dashboard de custo, busca semântica.
- Anexos, voz e imagens.
- Qualquer integração com o Nero.
