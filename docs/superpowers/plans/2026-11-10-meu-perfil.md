# Meu perfil — plano e execução

Arquitetura: [meu-perfil.md](../../architecture/meu-perfil.md).

## Organização escolhida

- Implementador: **GPT-6.0 Sol** (`gpt-6-sol`).
- Revisor e responsável pelos testes independentes: **GPT-6.1 Sol** (`gpt-6.1-sol`).
- Fluxo: tarefas delimitadas, revisão de aderência à especificação primeiro, revisão de correção/segurança e testes depois, correções pelo implementador e nova revisão.
- Do GSD: revisão por evidências, severidade dos achados e verificação do resultado contra os critérios de aceite; sem inicializar um projeto/fases GSD para esta entrega já arquitetada.
- Sem commits, staging, mudanças de branch, publicação ou alteração de outro projeto. As referências do PrimeShow são somente contexto para a organização dos agentes.
- Testes novos são temporários, conforme `ArquivosMD/procedimento-padrao-testes.md`. Preservar testes preexistentes; registrar os resultados antes de remover somente os casos/artefatos desta execução.

### Comparativo usado na escolha

| Aspecto | Base do usuário/PrimeShow | Agentes GSD disponíveis | Aplicação nesta entrega |
| --- | --- | --- | --- |
| Implementador | GPT-6.0 Sol com tarefa delimitada e autorrevisão. | `gsd-executor` exige projeto GSD inicializado, planos de fase, commits por tarefa, SUMMARY e STATE. | Manter GPT-6.0 Sol e tarefas explícitas, sem inicializar fases ou exigir commits. |
| Revisor | GPT-6.1 Sol lê o código e executa testes independentes. | `gsd-code-reviewer` classifica bugs/segurança com evidências, mas seu escopo não substitui testes de execução. | Revisor GPT-6.1 Sol com as duas responsabilidades e achados classificados. |
| Verificação | Coordenador confirma integração e resultados. | `gsd-verifier` confronta objetivos com implementação real, sem confiar apenas no resumo do executor. | Conferir os 14 critérios de aceite com evidência; documentar o que foi e o que não foi testado. |
| Custo operacional | Coordenação direta, adequada à funcionalidade já desenhada. | Mantém ciclo de planejamento e estado para projetos/fases maiores. | Plano local e relatório rastreável, com revisão antes de avançar. |

A escolha compara responsabilidades e exigências dos fluxos, não desempenho medido dos modelos. A base de modelos foi fixada expressamente pelo usuário. Referência histórica consultada: plano `2026-11-09-perfil.md` do PrimeShow, que registra implementadores GPT-6.0 Sol e revisão/testes independentes do coordenador. Regras específicas daquele produto (CSS, portas e Compose) não se aplicam ao GestãoNF.

## Tarefa 1 — banco, identidade e backend pessoal

Responsável: implementador GPT-6.0 Sol. Revisor: GPT-6.1 Sol.

- [x] Acrescentar `users.avatarId` e `users.profileVersion`, tabela `userAvatarFiles`, constraints e índices da arquitetura; gerar migration e snapshot pelo Drizzle.
- [x] Atualizar DTOs públicos de cadastro, login, `/auth/me` e aceite de convite, sem depender do R2 para autenticar.
- [x] Criar `backend/src/profile/` com schemas, limites, validador de imagem, controller, service e módulo.
- [x] Implementar reserva idempotente, PUT assinado e finalização de imagens, sem empresa, com limites por usuário e estado persistido.
- [x] Implementar PATCH transacional com controle de versão e associação/remoção da foto; expor acesso privado à foto atual.
- [x] Integrar módulo e worker de limpeza; recuperar rejeições, expirações, exclusões e falhas entre R2 e banco sem apagar foto ativa.
- [x] Revisor conferir aderência à especificação; corrigir lacunas antes da revisão de qualidade.
- [x] Revisor executar typecheck, checks de migration e testes temporários de processamento, HTTP, autorização, transações, idempotência, concorrência e limpeza com PostgreSQL isolado/R2 simulado.
- [x] Implementador corrigir achados e revisor confirmar resolução.

Arquivos principais: `backend/database/src/schema.ts`, `backend/database/drizzle/`, `backend/src/auth/auth.service.ts`, `backend/src/users/users.service.ts`, `backend/src/profile/`, `backend/src/app.module.ts`, `backend/src/jobs/worker.module.ts`, `backend/src/jobs/profile-avatar-cleanup-worker.service.ts`.

## Tarefa 2 — página, avatar e navegação

Responsável: novo implementador GPT-6.0 Sol. Revisor: GPT-6.1 Sol.

- [x] Ampliar `User` e API em `frontend/src/api/client.ts` com os contratos pessoais aprovados.
- [x] Criar página de perfil, estilos seguindo o projeto e envio em etapas com reaproveitamento de imagem já validada em novas tentativas.
- [x] Criar `UserAvatar` com iniciais, URL privada temporária, renovação limitada e cache por pessoa/foto.
- [x] Acrescentar menu e rota `/meu-perfil`; permitir acesso sem empresa e durante falha da consulta empresarial.
- [x] Salvar nome/foto juntos, prévia apenas local, cancelamento, mensagens acessíveis, conflito sem sobrescrita e recuperação de resposta perdida.
- [x] Atualizar `['me']`, cabeçalho e invalidação das listagens administrativas.
- [x] Revisor conferir aderência; depois revisar qualidade e executar typecheck/build e E2E temporários de nome, foto, remoção, cancelamento, conflitos, falhas e layout móvel.
- [x] Implementador corrigir achados e revisor confirmar resolução.

Arquivos principais: `frontend/src/api/client.ts`, `frontend/src/features/profile/`, `frontend/src/components/UserAvatar.tsx`, `frontend/src/components/WorkspaceLayout.tsx`, `frontend/src/main.tsx`.

## Tarefa 3 — verificação final e entrega

- [x] Revisor conferir integração contra os 14 critérios e registrar o fluxo real de foto como pendente de CORS, sem declarar aprovação completa.
- [x] Executar regressões pertinentes de autenticação, convites e arquivos de vendas; distinguir falhas preexistentes das introduzidas.
- [x] Aplicar migration aditiva no ambiente local de desenvolvimento após aprovação dos testes isolados.
- [x] Registrar comandos, resultados, achados corrigidos e limites de validação.
- [x] Remover somente testes temporários e artefatos desta execução, com caminhos absolutos verificados.
- [x] Atualizar estado da arquitetura e preparar resumo com pendências reais.
- [x] Com acesso administrativo ao bucket, corrigir CORS local e repetir o fluxo real de foto. Resolvido posteriormente com sessão OAuth existente do Wrangler; regra antiga de 5173 preservada e regra HTTPS 3001 adicionada. Upload completo real confirmado no Chrome e pelo usuário.

## Registro de execução

**Código implementado e aprovado nas duas revisões. CORS corrigido e upload real de foto confirmado.** O bloqueio ambiental da primeira rodada foi resolvido na atualização registrada abaixo.

- Backend entregue pelo GPT-6.0 Sol; revisão de aderência aprovada pelo GPT-6.1 Sol após correções de CHECK com nulos, validação estrita, Cache-Control e predicado/prazos da limpeza.
- Migration `0030_keen_sugar_man.sql` validada em PostgreSQL isolado; `db:check`, `db:typecheck` e `db:migrate` aprovados. Catálogo local confirmou tabela e colunas novas; nenhum seed ou edição direta de usuário real.
- Primeira rodada independente: 24/24 cenários aprovados em três suites temporárias; rodada final ampliada registrada abaixo.
- Smoke de infraestrutura: API `/health` e frontend local retornaram HTTP 200 com certificado local validado.
- Tarefa 1 encerrada: revisão de aderência e de qualidade aprovadas, sem achados abertos; **29/29** testes independentes e **44/44** regressões. Relatório: [revisão backend](../reviews/2026-11-10-meu-perfil-backend.md).
- Complemento real de armazenamento: `npm --prefix backend run r2:check` aprovado (gravação, leitura, download assinado e exclusão). Não demonstra CORS de navegador por si só.
- Os três arquivos novos de testes do backend foram removidos após registrar os resultados, conforme procedimento local. Testes preexistentes preservados.
- Tarefa 2 aprovada com novo implementador GPT-6.0 Sol e novo revisor GPT-6.1 Sol: **21** cenários pessoais, **3/3** usuários originais e **2/2** anexos com ajuste temporário de fixture fiscal explicitamente documentado. Typecheck/build aprovados. Quatro achados corrigidos: renovação em loop, ausência de timeout no PUT, guard de dados de sessão antigos e tratamento de falha/duplicação no logout.
- Relatório final e matriz de aceite: [revisão frontend](../reviews/2026-11-10-meu-perfil-frontend.md). A suíte original de anexos falhou por mock fiscal preexistente, e não foi contabilizada como aprovada sem ressalva.
- API HTTPS continuou retornando `/health` 200; processos de API, frontend e worker foram encontrados ativos no ambiente local. Isso não substitui a validação pendente do upload real pelo navegador.
- Os novos testes/scripts e as seis pastas exclusivas de resultados foram removidos após registro. Testes e resultados preexistentes preservados. O código permanece no working tree, sem staging, commits ou publicação.
- Atualização após o usuário relatar falha de upload: localizada autenticação administrativa já existente no Wrangler, sem obter ou criar credenciais novas. Consulta oficial comprovou origens antigas na porta 5173; adicionadas apenas as origens HTTPS locais na porta 3001, preservando a regra anterior e a privacidade do bucket.
- Revalidação GPT-6.1 Sol com Chrome/API/PostgreSQL/R2 reais: reserva 201, PUT 200, finalização 200, PATCH 200, imagens carregadas na página/cabeçalho e estado ACTIVE/versionamento persistidos. Usuário também confirmou que salvou a foto. Evidências: [validação real](../reviews/2026-11-10-meu-perfil-r2-real.md).
