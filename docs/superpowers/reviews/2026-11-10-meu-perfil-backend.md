# Meu perfil — revisão independente do backend e banco

Data: 10/11/2026. Revisor: GPT-6.1 Sol. Implementador: GPT-6.0 Sol.

**Resultado: APROVADO para a tarefa 1.** Revisão de aderência concluída antes do parecer de qualidade. Nenhum achado conhecido permanece aberto. A aprovação é restrita ao backend, banco e projeções públicas de identidade; interface e integração visual pertencem às próximas tarefas.

## Método e limites

Aplicada a skill `C:/Users/pedro/.codex/skills/code-review/SKILL.md`, com evidências contra `docs/architecture/meu-perfil.md`, plano da entrega e procedimento de testes. O revisor não alterou produção, não fez staging/commits e encaminhou correções ao implementador.

Testes independentes usaram PostgreSQL 17 em bancos novos de nomes aleatórios, todas as migrations aplicadas desde o início e remoção segura dos bancos ao finalizar. R2 foi simulado em memória, incluindo falhas e sobrescrita do staging; Sharp foi executado de verdade. Nenhum teste usou registros reais do banco principal. Os três testes temporários foram removidos após autorização do coordenador, com caminhos absolutos conferidos dentro de `backend/tests`.

## Achados corrigidos e revalidados

| Severidade | Evidência original e cenário | Correção confirmada |
| --- | --- | --- |
| BLOCKER | `backend/database/src/schema.ts:341`, constraint `user_avatar_files_ready_chk`: PostgreSQL aceitava READY com tipo/tamanho/dimensões NULL porque CHECK aceita resultado NULL. INSERT inválido foi aceito no banco isolado. | Exigência explícita de campos não nulos em schema, SQL 0030 e snapshot. Mesmo INSERT agora falha com SQLSTATE 23514; suíte da migration 5/5. |
| WARNING | `backend/src/profile/profile.controller.ts`: finalização ignorava corpo desconhecido e rotas ignoravam query desconhecida, contrariando o contrato estrito. Requisição com campo extra seguia até retornar 409 por upload ausente. | Schema vazio estrito para corpo da finalização e query de todas as rotas pessoais; regressão HTTP retorna 400. |
| WARNING | `backend/src/auth/auth.controller.ts:61`: `/auth/me` ampliado não enviava o no-store requerido; não havia hook global correspondente. | Header `Cache-Control: private, no-store` comprovado por HTTP. |
| BLOCKER | `backend/src/profile/profile.service.ts:119`: predicado raw SQL com OR externo sem agrupamento, combinado com condição de ID; seleção podia processar arquivo diferente do candidato. Além disso, READY ainda válido era elegível pelo vencimento do upload e podia ocupar lotes sem trabalho. | Predicado agrupado e prazos separados por estado. Testes de lote limitado, ACTIVE, retry e competição com associação passam. |

Uma falha intermediária de teste após a correção de cleanup foi causada por resíduos de outros cenários no próprio banco isolado. O harness passou a limpar referências/arquivos entre cenários; a rodada final completa passou. Esse episódio não foi classificado como novo bug da aplicação.

## Evidência de aderência

- Schema e migration aditivos: `users.avatar_id`, versão positiva com default 1, tabela técnica, FK composta de propriedade, chave idempotente, índice de uma ACTIVE e checks de entrada/saída. Constraints verificadas diretamente no PostgreSQL.
- DTOs de cadastro, login, `/auth/me` e criação por convite contêm os novos campos; autenticação consulta o banco sem acessar R2. Fluxo de convite existente preserva identidade; regressões de usuários passaram.
- Endpoints pessoais usam AccessGuard, identidade da sessão, corpos estritos e dispensam empresa. HTTP sem vínculo empresarial, ausência de autenticação, origem inválida de cookie e ownership foram exercitados.
- Reserva serializada por usuário; idempotência concorrente conserva ID e prazo; limites de três temporários e cinco novas reservas/minuto foram exercitados.
- Finalização bloqueia o arquivo, confere HEAD/ETag/leitura limitada e persiste rejeição antes da resposta. Repetições concorrentes produzem uma única saída; alterações posteriores no staging não mudam o arquivo aceito.
- PATCH bloqueia usuário e arquivos ordenados, verifica versão, salva nome e referência juntos, mantém noop e controla ACTIVE/DELETING. Concorrência e rollback real por trigger PostgreSQL foram exercitados.
- Imagens JPEG, PNG e WebP reais são normalizadas, orientadas e privadas; animação WebP real, corrupção, MIME falso, truncamento e excesso de pixels foram recusados. Saída WebP até 512×512, sem EXIF/ICC e dentro do teto.
- Worker registrado, sem sobreposição no processo, com estado durável e SKIP LOCKED. Testes verificaram expiração, grace do staging, retry após falha, preservação ACTIVE, lote limitado e competição controlada entre limpeza e associação.
- Falha no banco após PUT definitivo deixa a reserva PENDING e o objeto conhecido; nova tentativa completa corretamente. R2 indisponível não participa da edição de nome/remoção lógica nem da leitura de identidade.

## Comandos e resultados

| Comando | Resultado |
| --- | --- |
| `npm --prefix backend run test -- tests/profile-review.test.ts tests/profile-migration-review.test.ts tests/profile-content-review.test.ts` | **29/29**, três arquivos, rodada final completa. |
| `npm --prefix backend run test -- tests/files.test.ts tests/files-content.test.ts tests/users.test.ts` | **44/44**, três arquivos de regressão preexistentes. |
| `npm run backend:typecheck` | PASS, API e database sem erros. |
| `npm run db:typecheck` | PASS antes da migration principal. |
| `npm run db:check` | PASS antes da migration principal. |
| `npm run db:migrate` | PASS no banco local principal, após autorização expressa do coordenador e 5/5 testes isolados. |
| `npm --prefix backend run r2:check` | PASS: R2 real confirmou gravação, leitura, download assinado e exclusão do objeto de probe. Executado pelo revisor frontend a pedido do coordenador, sem alterar configuração ou credenciais. |

O primeiro comando de migration-test com `-w backend` também selecionou o workspace aninhado database, que não continha aquele teste. Execuções posteriores usaram `--prefix backend`; os resultados finais da tabela são inequívocos e verdes.

Após aplicar a migration, consulta exclusiva ao catálogo confirmou `users.avatar_id UUID NULL`, `users.profile_version INTEGER NOT NULL DEFAULT 1` e `public.user_avatar_files`. Não houve seed nem atualização direta de usuários reais.

O coordenador relatou smoke de infraestrutura HTTPS com `/health` e Vite retornando 200; isso não substitui E2E de perfil e não foi contado nos testes independentes deste relatório.

## Limites restantes da validação

O probe de R2 real passou, mas não valida CORS de PUT no navegador nem o fluxo completo de perfil. Falhas efetivas de rede não foram exercitadas; o transporte nas suites foi simulado para verificar o protocolo da aplicação. Não houve teste de carga nem validação do frontend nesta tarefa. A simulação de indisponibilidade de R2 demonstrou a independência das operações lógicas; não constitui medição de disponibilidade. A suite não pretende enumerar cada combinação possível de falha ou escalonamento de processos.

Probe complementar independente em Chrome, na origem `https://127.0.0.1:3001`, com PNG Sharp, URL PUT assinada por `R2StorageService`, `credentials: omit` e TLS validado: **bloqueado no PUT** (`net::ERR_FAILED`). Preflight OPTIONS real respondeu **403**, sem `Access-Control-Allow-Origin`; GET no navegador não pôde ser exercitado. O comando somente leitura `npm --prefix backend run r2:cors` respondeu **AccessDenied** ao consultar CORS. Isso documenta limitação ambiental real para uploads no navegador; não é evidência de fluxo completo aprovado nem demonstra isoladamente qual regra remota falta. Nenhuma credencial ou configuração foi alterada. O objeto isolado `checks/` foi removido em `finally` nas três tentativas; URLs assinadas não foram impressas, traces ficaram desligados e o script temporário foi removido após o registro.

Complemento somente leitura: preflight para **ambas** as origens `https://localhost:3001` e `https://127.0.0.1:3001` confirmou **403 sem allow-origin**. URL PUT assinada para chave isolada `checks/`; nenhum objeto criado porque nenhum PUT foi executado. Script temporário removido após o registro.

## Artefatos temporários

- `backend/tests/profile-review.test.ts` — 19 cenários HTTP/DB/armazenamento e concorrência.
- `backend/tests/profile-migration-review.test.ts` — 5 cenários de migration/constraints.
- `backend/tests/profile-content-review.test.ts` — 5 cenários de conteúdo com Sharp real.

Os três arquivos acima foram removidos após sinal do coordenador em 10/11/2026; testes preexistentes foram preservados. Este relatório permanece como registro da validação.
