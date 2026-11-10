# Meu perfil — revisão independente do frontend e integração

Data: 10/11/2026. Revisor: GPT-6.1 Sol. Implementador: GPT-6.0 Sol.

**Parecer de código: APROVADO após quatro correções. A pendência inicial de CORS foi resolvida posteriormente e o upload real foi validado, conforme [relatório complementar](2026-11-10-meu-perfil-r2-real.md).** Aderência à arquitetura foi conferida antes da revisão de correção, segurança e execução. Nenhum achado de código conhecido permanece aberto no escopo. As ressalvas históricas abaixo descrevem a primeira rodada; o complemento registra a verificação real posterior.

## Método e evidências

Aplicada a skill `C:/Users/pedro/.codex/skills/code-review/SKILL.md`. Fontes: arquitetura, plano, procedimento de testes, diff e arquivos completos de integração. O revisor escreveu somente testes temporários e relatórios; correções de produção foram encaminhadas ao implementador. Nenhum commit, staging ou mudança de branch.

Chrome via Playwright, frontend HTTPS `https://127.0.0.1:3001`, API simulada na porta 4030 e origem CORS pelo helper existente. Certificado local validado, sem `ignoreHTTPSErrors`; comandos Node usaram `NODE_EXTRA_CA_CERTS=.certs/root-ca.pem`. Mocks independentes representam os contratos HTTP e estados persistidos, sem consultar internals dos componentes. PUT de foto usa uma origem externa simulada com cookie deliberadamente instalado: request não enviou cookie nem autorização.

Os 20 cenários pessoais cobriram: empresas vazias/pendentes/com falha; trim/versão/nome no cabeçalho; cancelar; prévia sem upload; nome e foto no mesmo PATCH; READY reutilizado após falha do PATCH; falha de upload sem salvar nome; timeout; resposta de PATCH perdida com recuperação por `/auth/me`; conflito com draft preservado e recarga explícita; expiração normal e URL perto do vencimento; menu por teclado e histórico voltar; refetch real da sessão por reconexão preservando draft; invalidação da listagem administrativa previamente consultada; remoção com `avatarId:null`; mismatch da identidade da foto; falha de imagem com repetição limitada; formulário/teclado e ausência de overflow em 320/375 px.

O timeout foi testado mantendo o PUT pendente e reduzindo apenas o setter nativo de `XMLHttpRequest.timeout` para 100 ms no navegador do teste. O teste confirmou configuração positiva de até 120.000 ms, disparo nativo de timeout, mensagem acessível, manutenção do draft, ausência de PATCH e liberação de Salvar/Cancelar. Não se aguardaram 120 segundos reais.

## Achados corrigidos

| Severidade | Local original e evidência | Correção e revalidação |
| --- | --- | --- |
| WARNING | `frontend/src/components/UserAvatar.tsx:15`: resposta com validade dentro da margem de 5 segundos agendava invalidação em zero ms. URL válida por 1 segundo produziu **167 GETs em aproximadamente 1 segundo**. Relógio cliente adiantado também pode provocar o caso. | Não agenda timer quando a margem já venceu. Caso de URL curta e renovação normal passaram; erro de imagem mantém repetição limitada e iniciais. |
| WARNING | `frontend/src/features/profile/upload-avatar.ts:7`: XHR sem timeout (default nativo 0), sem ação de cancelamento habilitada durante envio. PUT que não termina podia manter formulário preso. | Timeout de 120 segundos e handler de erro/limpeza. Teste acelerado descrito acima passou. |
| WARNING | `frontend/src/components/UserAvatar.tsx:12`: `access.data?.avatarId === user.avatarId` era verdadeiro quando ambos eram undefined, e `access.data.url` lançava TypeError. Regressões preexistentes com DTO anterior produziram tela branca; pertinente a cache/rollout do cabeçalho compartilhado. | Guard explícito de existência de `access.data`, preservando DTO TypeScript obrigatório. **3/3 testes originais de usuários passaram sem adaptação.** |
| WARNING | `frontend/src/features/profile/ProfilePage.tsx:169`: saída iniciada por promise descartada e `loggingOut=false`. Mock de POST `/auth/logout` com 503 gerou pageerror não tratado `Saída indisponível`, sem alerta. | Mutation controla pendência e erro acessível. Teste focalizado **1/1** confirmou Sair desabilitado enquanto resposta permanece pendente, uma única chamada, erro exibido e nenhum pageerror após 503. |

Falhas intermediárias no harness pessoal por selecionar texto de um input e supor tabela `tbody` foram corrigidas no teste, sem mudança de produção. Não foram classificadas como bugs da aplicação.

## Comandos e resultados

Executados no diretório `frontend`, com `NODE_EXTRA_CA_CERTS` apontando para a CA local:

| Comando | Resultado |
| --- | --- |
| `npx playwright test e2e/profile-review.spec.ts e2e/users.spec.ts e2e/profile-regression-review.spec.ts --output C:\Users\pedro\AppData\Local\Temp\gestaonf-profile-final2-20261110 --trace off` | **25/25**, rodada final: **20/20 perfil**, **3/3 usuários originais**, **2/2 anexos com ajuste isolado de fixture fiscal**. |
| `npx playwright test e2e/profile-review.spec.ts --output C:\Users\pedro\AppData\Local\Temp\gestaonf-profile-logout-20261110 --trace off` | **1/1**, teste focalizado recriado após rodada principal para falha/pêndencia de logout. Total: **21 cenários pessoais** aprovados, além das cinco regressões descritas acima. |
| `npm --prefix frontend run typecheck` (raiz) | PASS independente. |
| `npm --prefix frontend run build` (raiz) | PASS independente; build inclui TypeScript e Vite. |
| `npm --prefix backend run r2:check` (raiz) | PASS: escrita, leitura, download assinado e exclusão reais no R2. |
| `npm --prefix backend run r2:cors` (raiz, sem `--apply`) | **AccessDenied** na consulta remota de CORS. Nenhuma configuração alterada. |

### Ressalva explícita da regressão de anexos

`frontend/e2e/sale-attachments.spec.ts` original **não passou**: seu fallback devolve `{items:[],total:0}` a `/fiscal/tax-profiles`, mas o contrato atual devolve array e `frontend/src/features/sales/SaleEditor.tsx:89` chama `taxRules.data?.filter`. O erro `taxRules.data?.filter is not a function` foi observado no navegador. `SaleEditor`, API fiscal e esses testes preexistentes não têm diff nesta entrega.

Para verificar os dois fluxos de anexos sem alterar os arquivos preexistentes, o wrapper temporário `profile-regression-review.spec.ts` importou os cenários e substituiu **apenas a resposta desse endpoint fiscal por `[]`**. Não adaptou User, não silenciou exceções e manteve assertions e protocolo dos anexos. Ambos passaram. Esse resultado diagnóstico não é anunciado como aprovação da suíte original sem alterações. Os três cenários de usuários rodaram diretamente de `users.spec.ts` após a correção do guard.

## R2 e CORS: pendência ambiental da primeira rodada, resolvida posteriormente

Probe isolado, sem banco ou usuário: gerou PNG via Sharp, assinou PUT usando `R2StorageService`, abriu Chrome na origem HTTPS real e executou fetch com `credentials:omit`, sem gravar trace ou imprimir URLs. O PUT terminou com `net::ERR_FAILED`. Preflight OPTIONS real respondeu **403 sem `Access-Control-Allow-Origin`**. A consulta administrativa GetBucketCors respondeu **AccessDenied**. O GET no navegador não foi alcançado.

Isso comprova que o ambiente atual não aprovou upload direto do navegador; não identifica sozinho qual regra remota falta. O probe de serviço R2 passou, portanto acesso de objetos via servidor e CORS do navegador são resultados distintos. Nenhuma credencial foi alterada e nenhum proxy/upload por servidor foi introduzido. Os três objetos `checks/` das tentativas foram removidos em `finally`, e o script temporário foi removido após registrar os resultados.

Conferência adicional somente leitura com URL PUT assinada para chave nova `checks/`: ambas as origens **`https://localhost:3001` e `https://127.0.0.1:3001` responderam 403, sem allow-origin**, usando preflight com método PUT e headers `content-type,cache-control`. Nenhum PUT foi feito nesse complemento, portanto nenhum objeto foi criado. Script complementar removido após o registro.

Para concluir a operação local, alguém com permissão de configuração do bucket deve adicionar às regras CORS existentes a regra de `infra/r2/cors.local.json`, preservando as anteriores e mantendo o bucket privado:

- Origens: `https://localhost:3001` e `https://127.0.0.1:3001`.
- Métodos: PUT, GET e HEAD.
- Headers permitidos: Content-Type, Cache-Control e Content-Length.
- Headers expostos: ETag, Content-Length e Content-Disposition; MaxAgeSeconds 3600.

O script `npm --prefix backend run r2:cors` consulta sem modificar; com credencial autorizada, `npm --prefix backend run r2:cors -- --apply` adiciona origens locais pendentes preservando regras existentes. Com a credencial atual retorna AccessDenied. Após o ajuste deve-se repetir o probe Chrome PUT/GET da origem real e o fluxo completo de foto. Não tornar objetos públicos para contornar a falha.

## Matriz dos 14 critérios da arquitetura

Backend/banco remetem às evidências independentes já aprovadas em [relatório do backend](2026-11-10-meu-perfil-backend.md), com 29/29 cenários e 44/44 regressões. A matriz distingue essa evidência de teste pessoal no navegador com mocks.

| Critério | Estado e evidência |
| --- | --- |
| 1. Acesso com/sem empresa e falha empresarial | PASS: três E2E pessoais, inclusive consulta empresarial pendente. |
| 2. Nome global, cabeçalho e consultas administrativas | PASS em contratos/UI: trim, PATCH com versão, cache me e listagem previamente consultada invalidada; persistência global validada em T1. |
| 3. Foto após salvar, seleção/cancelamento locais | PASS com armazenamento simulado: prévia e cancelamento sem upload; PATCH atualiza avatar do cabeçalho. **Fluxo completo real pendente de CORS.** |
| 4. Uma foto ativa e remoção/limpeza durável | PASS T1 para banco/worker; frontend envia null na remoção. R2 real de ponta a ponta não aprovado. |
| 5. Atomicidade de nome/foto e falhas | PASS: upload falho não faz PATCH; READY preservado em falha; rollback real T1. |
| 6. Ownership e autorização pessoal | PASS T1 HTTP/DB; frontend não envia empresa nas operações pessoais, PUT sem credenciais da aplicação. |
| 7. Conteúdo real validado/normalizado | PASS T1 com Sharp real; frontend limita tipos/tamanho declarados, não substitui validação do servidor. |
| 8. Edição concorrente sem perda silenciosa | PASS: backend concorrente T1; 409 na UI preserva draft e exige carregar estado atual. |
| 9. Idempotência, expiração e resposta perdida | PASS T1 para estados/limpeza; frontend READY retry e recuperação de PATCH sem reenvio cego passaram. |
| 10. Limpeza concorrente preserva ACTIVE | PASS T1, incluindo falhas/retry e banco isolado. |
| 11. R2 indisponível e imagem sem loop | PASS T1 para operações lógicas; E2E falha de imagem/curta validade e falha upload passaram após correção. |
| 12. Expiração/cache/logout/teclado/mobile | PASS nas verificações executadas: renovação normal, mismatch, cache compartilhado, 320/375 e teclado. Logout limpa QueryClient conforme revisão direta de código; não houve inspeção instrumental do cache após logout. |
| 13. Convite existente/histórico | PASS regressões T1 e convite existente na UI; nenhum diff de reescrita de histórico. |
| 14. Anexos empresariais preservados | PASS backend T1; 2/2 cenários browser com ajuste de fixture fiscal explícito. Suíte original de anexos continua incompatível com contrato fiscal preexistente. |

## Limites e limpeza

Não foram realizados carga, medição de SLA, sincronização em tempo real ou teste visual manual por screenshot. Responsividade foi conferida por DOM, visibilidade, teclado e largura real no Chrome. Não foram editados registros reais de usuário. E2E pessoais usam mocks, logo não demonstram integração completa API/DB/R2.

Após registrar o resultado, foram removidos `frontend/e2e/profile-review.spec.ts`, `frontend/e2e/profile-regression-review.spec.ts` e as cinco pastas exclusivas desta execução sob `C:\Users\pedro\AppData\Local\Temp`: `gestaonf-profile-review-20261110`, `gestaonf-profile-review-focused-20261110`, `gestaonf-profile-regression-20261110`, `gestaonf-profile-final-20261110` e `gestaonf-profile-final2-20261110`. Caminhos absolutos foram conferidos antes da exclusão; nenhum diretório preexistente foi removido. O script de probe isolado e os três testes temporários do backend também foram removidos com autorização do coordenador. Testes preexistentes e configurações permanecem.

O caso pessoal foi recriado somente para a verificação final do logout, executado e removido novamente, juntamente com sua pasta exclusiva `gestaonf-profile-logout-20261110`, após registrar o resultado.
