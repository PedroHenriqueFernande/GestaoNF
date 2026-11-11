# Nero como agente secretário — design

**Data:** 10/11/2026
**Status:** aprovado em brainstorming, aguardando revisão do spec
**Base:** `ArquivosMD/arquitetura-006-whatsapp-meta-nilo.md` (princípios de transporte, vínculo, segurança e Meta continuam válidos) e diagnóstico das conversas de 10/11/2026.

## 1. Objetivo

Transformar o Nero de um consultor de vendas em um **secretário que opera o GestãoNF pelo WhatsApp**: consultar, cadastrar clientes e serviços, lançar vendas, baixar recebimentos, enviar relatórios e PDFs, anexar arquivos e emitir NFS-e — sempre dentro das permissões do usuário, entendendo texto e áudio, mantendo o contexto da conversa e perguntando o que falta.

Cada pessoa tem seu "Nero pessoal" pelo vínculo (`whatsapp_links`). O número oficial do Nero é único.

## 2. Diagnóstico que motivou o design (10/11/2026)

| Problema observado | Causa |
| --- | --- |
| "Lance para mim" respondido com "O que você gostaria que eu lançasse?" | Memória existe só dentro de um pedido `AWAITING_REPLY`; resposta sem `ask_clarification` zera a conversa (`nilo.service.ts:108`). Execuções receberam 436–451 tokens de entrada: só instruções + frase atual. |
| Nero recusa lançar venda | Únicas ferramentas: `get_sales_report` e `ask_clarification`; o prompt manda recusar escritas (`nilo.service.ts:96`). |
| Mensagens com "61193C26", "94A2D1A0" | Rodapé fixo do código com o código do pedido (`nilo.service.ts:236-237`), remendo da falta de memória. Nome da empresa sempre no topo. |
| Respostas não chegaram | Meta 131037: número 555 fornecido pela Meta, nome "PHVBuss" com `name_status=AVAILABLE_WITHOUT_REVIEW`; após 5 envios por janela, bloqueio. Resolvido operacionalmente com número próprio (fora do código). |
| Outbox re-publicado infinitamente | Dispatcher re-reivindica `PUBLISHED` sem `completedAt` a cada 5 min; `FAILED` só no `catch` do `queue.add`. Registros de outubro com 2.472 tentativas. |
| Falha de envio invisível | Mensagem fica `QUEUED` para sempre após 6 tentativas; execução e pedido já marcados `COMPLETED` antes do envio. |
| "Confirmado" virou pedido do Nero | Texto livre após a mensagem de vínculo é tratado como solicitação. |

## 3. Decisões de produto

| Tema | Decisão |
| --- | --- |
| Fases | 0 Fundação → 1 Áudio → 2 Leituras → 3 Cadastros → 4 Vendas → 5 Documentos → 6 NFS-e. Cada fase tem plano e execução próprios. |
| Confirmação | **Toda escrita** passa por resumo + botões Confirmar / Corrigir / Cancelar. |
| Lote | Várias operações (ex.: alterar 1 cadastro + criar 2) cabem em **uma proposta com uma única confirmação**, executada de forma atômica. |
| Falhas | Nunca silenciosas. Sempre explicar o motivo em linguagem simples e sugerir correção; correção que altera dados gera novo resumo. |
| Permissões | **As mesmas do site.** Sem matriz nova. |
| Memória | **Conversa contínua** por vínculo, guardada no nosso banco, expira após 60 min sem mensagem. |
| Empresas | Escolhida **uma vez por conversa**; vale até expirar ou o usuário pedir troca. Quem tem uma empresa nunca é perguntado. |
| Linguagem | Tom de secretário, simples, sem jargão nem identificadores internos. |
| Áudio | Transcrição por **API paga da OpenAI**, modelo configurável. Respostas sempre em texto. |
| Testes | Temporários, conforme `ArquivosMD/procedimento-padrao-testes.md`: criar, executar, conferir e apagar arquivos e resultados. |
| Git | Nenhum commit pelos agentes; tudo fica no working tree. |

## 4. Arquitetura

```text
WhatsApp → webhook → inbox → [agrupador de rajada ~2s] → worker inbound
  → ConversationService   (conversa ativa: histórico, empresa, proposta pendente)
  → AgentOrchestrator     (OpenAI + catálogo filtrado pela NeroPolicy)
       ├─ ferramenta READ  → executa e devolve resultado à IA
       └─ ferramenta WRITE → ActionService.propose() valida em ensaio e grava proposta
             → resumo determinístico + botões
             → Confirmar → ActionService.execute() revalida e executa o lote em uma transação
  → resposta → outbox → worker outbound → Meta (estado FAILED real + aviso na web)
```

A IA nunca acessa o banco nem recebe SQL, URL ou função genérica. Toda ferramenta chama os serviços de aplicação usados pela web.

### 4.1 Unidades

| Unidade (backend/src/assistant/…) | Responsabilidade | Depende de |
| --- | --- | --- |
| `execution-context.ts` | Tipo `ExecutionContext` (userId, companyId, companyLinkId, linkId, conversationId, role, channel). Sempre montado pelo sistema. | — |
| `conversation.service.ts` | Abrir/retomar/encerrar conversa; anexar mensagens; montar histórico para o modelo; aplicar expiração e troca de empresa. | DB |
| `burst-collector.ts` | Junta mensagens do mesmo remetente recebidas na janela de rajada em um único turno. | DB |
| `company-selection.service.ts` | Substitui o `CompanyRequestService`: só pergunta a empresa no início da conversa (ou na troca) e interpreta a resposta (número da opção, nome ou botão). | `WhatsAppLinkService` |
| `tools/registry.ts` | Catálogo: nome, descrição, schema estrito, nível `READ`/`WRITE`, regra de permissão, handler. Fases acrescentam arquivos em `tools/` sem alterar o orquestrador. | — |
| `nero-policy.service.ts` | Replica as regras do site por ferramenta (ex.: NFS-e só OWNER/ADMIN) para **filtrar o catálogo** enviado à IA. A autoridade final continua nos serviços. | `company_users` |
| `agent-orchestrator.service.ts` | Loop com a OpenAI (Responses API, `store:false`), prompt versionado, limite de turnos, uso de tokens. | registry, policy, conversation |
| `prompt.ts` | Instruções do Nero, versionadas (`NERO_PROMPT_VERSION`). | — |
| `action.service.ts` | `propose` (ensaio de validação + persistência da proposta congelada), `confirm`, `correct`, `cancel`, `execute` (lote atômico e idempotente), expiração. | handlers das ferramentas |
| `action-summary.ts` | Gera o texto do resumo a partir do payload congelado (determinístico, não pela IA). | — |
| `error-translator.ts` | Converte erros de validação/serviço (Zod, `BadRequestException`, `ConflictException`) em causa estruturada `{operação, campo, regra, valor}` que a IA explica e corrige. | — |
| `nilo.service.ts` | Passa a apenas coordenar: inbox → seleção de empresa → orquestrador → outbox. | todos acima |
| `transcription/` (Fase 1) | `TranscriptionService` com cliente OpenAI e conversão de áudio. | Meta media, ffmpeg |

Os serviços de domínio que precisarem participar de um lote ganham variantes que recebem o executor de transação (`…InTx`), seguindo o padrão já existente de `SalesService.createDraftInTx`. Regras que hoje existam só em controllers devem ser movidas para o serviço antes de a ferramenta correspondente ser liberada.

## 5. Dados

Migrations Drizzle novas; nenhuma tabela copia dados de domínio.

| Tabela | Campos principais |
| --- | --- |
| `nero_conversations` (nova) | `id`, `link_id`, `user_id`, `company_id` nullable até a escolha, `company_link_id`, `status` (`AWAITING_COMPANY`/`ACTIVE`/`CLOSED`), `last_activity_at`, `expires_at`, `closed_reason` (`IDLE`/`NEW_TOPIC`/`COMPANY_SWITCH`/`LINK_REVOKED`), timestamps. Unique parcial: uma conversa não `CLOSED` por `link_id`. |
| `nero_messages` (nova) | `id`, `conversation_id`, `role` (`USER`/`ASSISTANT`/`TOOL`), `content` (texto; para TOOL um resumo curto), `source` (`TEXT`/`AUDIO`/`BUTTON`), `inbox_event_id`/`outbound_message_id` nullable, `created_at`. Retenção de conteúdo: 30 dias. |
| `assistant_actions` (existente, ampliada) | Passa a representar a **proposta** (`risk_level=WRITE`, `tool_name=propor_operacoes`): `conversation_id`, `operations` (jsonb: lista ordenada de `{tool, args}` congelada), `summary_text`, `summary_hash`, `confirmation_expires_at` (10 min), `result`, `failure` (causa estruturada), `last_error`. Status reaproveitados: `AWAITING_CONFIRMATION` (proposta), `EXECUTED`, `REJECTED` (cancelada), `FAILED`; novos: `EXPIRED`, `SUPERSEDED`. Versões esperadas são verificadas pelos próprios serviços na execução. Leituras continuam com `risk_level=READ` e `status=EXECUTED`. |
| `whatsapp_outbound_messages` (existente) | Status final `FAILED` passa a ser usado de fato, com o motivo `Meta #código: mensagem` em `failure_reason` (o código também fica em `whatsapp_send_attempts.provider_error_code`); novas colunas `conversation_id` e `interactive`; novo tipo `INTERACTIVE` (botões). |
| `whatsapp_requests` (existente) | Deixa de ser usada pelo fluxo novo; mantida para histórico. Remoção avaliada depois da Fase 0. |

Referências entre ações em um lote: uma operação pode referenciar o resultado de outra anterior por `$ref` (ex.: venda usa `customerId: {$ref: 0}` do cliente criado na operação 0). O executor resolve em ordem dentro da transação.

## 6. Fluxos

### 6.1 Turno de conversa

1. Evento chega; job inbound é agendado com atraso da janela de rajada (`NERO_BURST_MS`, padrão 2000).
2. Worker obtém lock do remetente, coleta todos os eventos de texto (e transcrições prontas) ainda não processados dele e os trata como **um turno**; os demais jobs desses eventos viram no-op.
3. Mensagens de controle são resolvidas antes da IA: vínculo (já existente), opt-out, cliques de botão de proposta, resposta à escolha de empresa.
4. `ConversationService` retoma a conversa ativa ou abre nova. Se o vínculo tiver várias empresas e a conversa não tiver empresa, pergunta qual (botões se ≤ 3, senão lista numerada) e para.
5. Orquestrador envia: prompt, empresa, data local, proposta pendente (resumo) e até as últimas 30 mensagens da conversa; ferramentas filtradas pela política.
6. Resposta final e mensagens de ferramenta são gravadas em `nero_messages`; resposta vai para o outbox na mesma transação.

### 6.2 Escrita

1. A IA coleta dados conversando (sem ferramenta de esclarecimento). Ferramentas de busca devolvem candidatos; com vários, a IA pergunta; sem nenhum, oferece cadastrar.
2. A IA chama `propor_operacoes` com a lista de operações (cada uma com sua ferramenta WRITE e argumentos).
3. `ActionService.propose` valida cada operação em **ensaio** (schema + regras do serviço, sem gravar; executado em transação revertida quando a regra depender do banco). Falha → devolve causa estruturada à IA, que explica e sugere correção; nenhum botão é mostrado.
4. Sucesso → grava proposta `AWAITING_CONFIRMATION` (substituindo como `SUPERSEDED` qualquer proposta pendente da conversa), gera resumo determinístico e envia com botões **Confirmar / Corrigir / Cancelar** (IDs opacos da ação, invisíveis ao usuário).
5. **Confirmar** (botão, ou "sim/confirma" digitado/falado; a conversa tem no máximo uma proposta `AWAITING_CONFIRMATION`, as anteriores ficam `SUPERSEDED`): revalida vínculo, membership, permissão e versões; executa todas as operações em **uma transação**, usando o ID da ação como chave de idempotência. Clique repetido não executa de novo.
6. **Corrigir**: Nero pergunta o que mudar; nova proposta substitui a anterior. **Cancelar**: `REJECTED`.
7. Proposta expira em 10 minutos (`EXPIRED`); Nero informa se o usuário tentar confirmá-la.

### 6.3 Falhas

| Momento | Comportamento |
| --- | --- |
| Ensaio (antes do resumo) | Nero explica causa e sugere correção. Ex.: "O nome tem um caractere que o sistema não aceita. Posso cadastrar como 'Robert Almeida'?" |
| Execução | Transação desfeita; "⚠️ Nada foi gravado" + operação, causa e proposta de correção. Ação `FAILED` com causa. |
| Erro inesperado (banco/serviço indisponível) | "Não consegui gravar agora, nada foi alterado. Tento de novo?" Proposta continua válida até expirar. |
| Correção sugerida pelo Nero | Sempre gera novo resumo; nunca grava algo diferente do que a pessoa viu. |
| Envio WhatsApp | Ver 6.4. Nunca desfaz nem repete a ação de negócio. |

### 6.4 Entrega

- Worker outbound classifica erros Meta: não-retentáveis (`131037`, `190`, `131042`, `131048`, `131026`, `132001`) vão direto para `FAILED`; retentáveis seguem backoff.
- Ao esgotar tentativas (evento `failed` final do BullMQ) → mensagem `FAILED` e outbox `FAILED`.
- Dispatcher: registro `PUBLISHED` vencido só é republicado se o job não existir no Redis; com job em estado `failed` → `FAILED`; teto de republicações → `FAILED`. Fim do loop infinito.
- Execução do Nero registra `COMPLETED` independentemente da entrega; o estado de entrega fica na mensagem.
- Tela `/nero`: aviso "N respostas não foram entregues" com o conteúdo de cada uma.
- Saneamento único (migration ou script): registros de outbox presos em `PUBLISHED` com mensagem `QUEUED` e tentativas esgotadas → `FAILED`.

## 7. Linguagem do Nero

- Tom de secretário, frases curtas, português simples, sem jargão técnico.
- Nunca mostrar UUIDs, códigos de pedido internos, nomes de ferramentas ou mensagens de erro cruas.
- Só aparecem números de uso humano: número do pedido (#52671), número da nota, valores e datas.
- Remover o rodapé "Responda a esta mensagem… {código}" e o cabeçalho fixo com o nome da empresa.
- Nome da empresa em **negrito** (`*Empresa*` no WhatsApp) quando relevante: usuário com várias empresas e em todo resumo de confirmação.
- Valores em `R$ 1.234,56`, datas `dd/mm/aaaa`.
- Mensagem livre após o pedido de vínculo ("Confirmado", "ok") recebe resposta determinística orientando concluir no GestãoNF, sem virar conversa com a IA.

## 8. Memória

- Conversa ativa por vínculo; encerra por 60 min sem mensagem (`NERO_CONVERSATION_IDLE_MIN`), "novo assunto" (ferramenta `encerrar_assunto`), troca de empresa (`trocar_empresa`, que encerra e abre nova para não misturar dados) ou revogação do vínculo.
- Histórico ao modelo: até 30 mensagens (`NERO_HISTORY_LIMIT`); resultados de ferramentas entram como resumos curtos, não dados brutos.
- Proposta pendente sempre informada ao modelo, mesmo se a conversa mudar de assunto; Nero lembra o usuário dela.

## 9. Áudio (Fase 1)

1. Evento `audio` de remetente vinculado → job de mídia. Remetente não vinculado: mídia nunca baixada.
2. Obtém URL pelo media ID, baixa com token apenas de host Meta validado, limite de tamanho; descarta acima de `NERO_AUDIO_MAX_SECONDS` (padrão 300).
3. Converte para formato aceito pela API quando necessário (ffmpeg no worker, argumentos fixos). A implementação confirma na documentação vigente da OpenAI se OGG/Opus é aceito diretamente.
4. Transcreve com a OpenAI (`OPENAI_TRANSCRIBE_MODEL`).
5. Apaga temporários em `finally`.
6. Transcrição entra no turno como mensagem `USER` com `source=AUDIO` e segue o fluxo normal (inclusive agrupamento de rajada).
7. Transcrição vazia/ininteligível → "Não consegui entender bem o áudio, pode repetir ou escrever?"
8. Teto diário de minutos por usuário (`NERO_AUDIO_DAILY_MINUTES`); ao exceder, Nero pede texto.

## 10. Catálogo de ferramentas por fase

| Fase | READ | WRITE (sempre via proposta) |
| --- | --- | --- |
| 0 | `trocar_empresa`, `encerrar_assunto`, `get_sales_report` (mantida até ser substituída por `consultar_vendas` na Fase 2) | `propor_operacoes` (infraestrutura do lote; sem operações de negócio ainda) |
| 1 | — | — |
| 2 | `buscar_clientes`, `buscar_servicos`, `consultar_vendas`, `consultar_venda`, `contas_a_receber`, `relatorio` (8 relatórios, resposta em texto) | — |
| 3 | — | `criar_cliente`, `alterar_cliente`, `criar_servico`, `alterar_servico` |
| 4 | — | `criar_venda` (rascunho + confirmação no mesmo lote), `baixar_recebimento` |
| 5 | `enviar_relatorio_pdf`, `enviar_pdf_nota` | `anexar_arquivo` (mídia recebida → venda/cliente, via módulo de arquivos/R2) |
| 6 | `status_nota` | `emitir_nfse` (OWNER/ADMIN; emissão assíncrona; Nero avisa autorização/rejeição) |

Envio de documentos (Fase 5) exige `sendDocument` no `MetaCloudClient` (upload de mídia + mensagem `document`).

## 11. Critérios de aceite por fase

**Fase 0 — Fundação**
- Conversa "Fiz uma venda de um site de 5k pro Roberto" seguida de "Lance para mim" (IA simulada) mantém o contexto no segundo turno.
- Duas mensagens em menos de 2 s geram uma resposta.
- Usuário com duas empresas é perguntado uma vez por conversa; troca explícita reinicia a conversa; expiração após 60 min.
- Proposta com 3 operações de uma ferramenta WRITE fictícia registrada apenas no teste (a Fase 0 ainda não expõe operações de negócio): resumo único, Confirmar executa todas em uma transação, falha em uma desfaz todas e gera explicação, clique duplo não duplica, expiração em 10 min.
- Respostas sem código de pedido nem cabeçalho fixo; nome da empresa em negrito quando exibido.
- Erro 131037 simulado: mensagem `FAILED` sem retries, outbox `FAILED`, aviso visível em `/nero`; nenhum registro republicado em loop.
- Catálogo filtrado pela política conforme o papel do usuário.

**Fase 1 — Áudio:** nota de voz real transcrita e respondida; temporários removidos; limite de duração e teto diário respeitados; áudio de remetente desconhecido não baixado.

**Fase 2 — Leituras:** cada ferramenta respeita empresa e escopo do usuário (inclusive escopo CRM de colaborador nos relatórios); resultados paginados e resumidos.

**Fase 3 — Cadastros:** lote "alterar 1 + criar 2" com uma confirmação; caractere inválido detectado no ensaio com sugestão; conflito de versão na execução explicado.

**Fase 4 — Vendas:** caso Roberto completo (cliente novo + serviço novo + venda com parcela recebida e parcela a vencer) em uma confirmação; parcelas que não somam o total detectadas no ensaio; baixa idempotente.

**Fase 5 — Documentos:** PDF de relatório e de nota entregues como documento; arquivo recebido anexado à venda certa; nenhum documento de outra empresa.

**Fase 6 — NFS-e:** COLLABORATOR/MANAGER não veem a ferramenta; emissão idempotente; Nero informa resultado assíncrono.

## 12. Testes

Três camadas, todas **temporárias** (criar, rodar, conferir, apagar arquivos e resultados; manter configurações de teste):

1. Unidade/integração com Vitest e banco temporário (padrão dos testes atuais).
2. Roteiros de conversa com cliente OpenAI simulado e respostas determinísticas.
3. Avaliação com modelo real: ~15 conversas típicas rodadas manualmente antes de liberar cada fase, medindo ferramenta escolhida, perguntas pelo que falta e ausência de jargão.

## 13. Configuração nova

```dotenv
NERO_BURST_MS=2000
NERO_CONVERSATION_IDLE_MIN=60
NERO_HISTORY_LIMIT=30
NERO_ACTION_TTL_MIN=10
OPENAI_TRANSCRIBE_MODEL=gpt-transcribe   # confirmar o nome vigente na documentação OpenAI ao implementar
NERO_AUDIO_MAX_SECONDS=300
NERO_AUDIO_DAILY_MINUTES=30
```

## 14. Fora de escopo

- Respostas em voz.
- Matriz nova de permissões ou chave "só leitura" por usuário.
- Templates fora da janela de 24 h (continua o previsto na arquitetura-006).
- Números próprios por empresa (Embedded Signup).
- Atendimento a clientes finais das empresas.
- Troca do número da Meta (ação operacional do usuário).

## 15. Execução

Cada fase vira um plano em `docs/superpowers/plans/` com tarefas pequenas, executadas pelo agente `implementador` e revisadas pelo `revisor` (conformidade com este spec + qualidade). Sem commits automáticos. A Fase 0 é planejada primeiro; as demais são planejadas ao término da anterior, revisitando este spec se algo mudar.
