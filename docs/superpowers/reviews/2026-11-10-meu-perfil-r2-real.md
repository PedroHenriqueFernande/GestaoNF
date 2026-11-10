# Meu perfil — validação independente com R2 real

Data: 10/11/2026. Revisor: GPT-6.1 Sol.

**PASS: upload, leitura e remoção da foto pela interface com API, PostgreSQL e R2 reais. A pendência de CORS registrada nas revisões anteriores foi encerrada nesta validação.** Nenhum código de produção foi alterado.

O coordenador informou ter acrescentado a regra HTTPS local de `infra/r2/cors.local.json` por sessão OAuth existente do Wrangler, preservando a regra anterior e o bucket privado. Esta revisão comprovou o resultado operacional independentemente pelo navegador, sem consultar ou imprimir credenciais.

## Execução real

Comando na pasta `backend`: `npx tsx scripts/profile-real-upload-review.ts`, com `NODE_EXTRA_CA_CERTS` apontando para `.certs/root-ca.pem`.

Chrome em contexto isolado abriu `https://localhost:3001/meu-perfil`, com TLS validado e sem ignorar erros de certificado. Foi criada uma identidade nova de teste no banco de desenvolvimento, identificada por UUID aleatório no e-mail `profile-real-review-<nonce>@example.test`. O token JWT temporário foi assinado em memória com a configuração local e instalado somente no contexto desse usuário. Não foram criadas empresas, contratações, credenciais persistidas ou sessões de refresh; nenhum e-mail foi enviado. Nenhuma sessão ou dado de usuário real foi utilizado.

Foi gerado um PNG verdadeiro com Sharp em memória. A interface editou o nome e selecionou esse arquivo; o botão Salvar executou o protocolo completo:

| Verificação | Resultado |
| --- | --- |
| `/auth/me` inicial | 200, usuário isolado, avatar null, versão 1; acesso sem empresa. |
| Reserva de upload | POST 201. |
| Envio direto ao R2 pelo navegador | PUT 200. |
| Finalização e processamento real | POST complete 200. |
| Salvamento de nome e referência da foto | PATCH 200. |
| Nome e imagem após salvar | Mensagem de sucesso, cabeçalho atualizado e duas imagens com `naturalWidth > 0`. |
| Leitura real da foto | GET access 200 e GET R2 200; imagem decodificada no Chrome. |
| Persistência | Mesmo usuário, nome esperado, versão 2, referência igual ao arquivo reservado, estado ACTIVE, saída WebP com dimensões dentro de 512×512. |
| Remoção pela interface | Botão Remover foto e Salvar: PATCH 200, sucesso e iniciais restauradas. |
| Persistência após remoção | `avatarId:null`, versão 3 e arquivo anterior DELETING/DELETED; `/auth/me` confirmou null/versão 3. |
| Exceções no navegador | Nenhum pageerror. |

Contagens de respostas observadas na página da execução final: `/auth/me` GET 200 ×1; `/companies` GET 200 ×1; reserva POST 201 ×1; PUT R2 200 ×1; complete POST 200 ×1; PATCH `/profile/me` 200 ×2; GET access 200 ×1; GET R2 200 ×1; GET access 404 ×1. O 404 ocorreu durante a remoção/invalidação da foto e terminou corretamente em iniciais. As duas consultas extras de `/auth/me` pelo contexto de request também retornaram 200.

## CORS das duas origens

Preflight real sobre a URL PUT assinada da própria reserva, com método PUT e headers `content-type,cache-control`:

| Origem | Status | Allow-Origin |
| --- | --- | --- |
| `https://localhost:3001` | **204** | Igual à origem solicitada. |
| `https://127.0.0.1:3001` | **204** | Igual à origem solicitada. |

204 é resposta válida de sucesso para preflight. O fluxo completo foi executado em localhost; para 127.0.0.1 foi verificado o preflight. Não foi necessário relaxar TLS, publicar objetos ou alterar o caminho de upload direto.

## Limpeza e limites

A primeira tentativa já havia aprovado upload/leitura/DB, mas o harness exigia incorretamente status exato 200 para preflight e seu guard de limpeza comparava timestamp PostgreSQL com Date JavaScript sem precisão de microssegundos. O guard conservador preservou a identidade de teste. A tentativa seguinte, já iniciada antes da orientação de não repetir o fluxo, recuperou somente essa identidade com nonce, nome correspondente, criação recente e ausência de vínculos; removeu suas duas chaves R2 e registros. O guard passou a comparar a representação textual exata do timestamp.

A execução final concluiu também a remoção pela interface. No finally, fechou o navegador, conferiu ID, e-mail com nonce, criação exata e ausência de vínculos; apagou exclusivamente as duas chaves R2 consultadas pelo `user_id` do teste, confirmou ausência por HEAD, removeu referência, arquivos pessoais, eventuais sessões/credenciais desse ID e a identidade. Resultado: **zero linhas desse usuário e zero arquivos pessoais dele**, duas chaves excluídas e HEAD ausente. O número de arquivos PENDING preexistentes permaneceu **1 antes e 1 depois**; não houve limpeza global de PENDING ou ACTIVE.

Consulta independente final confirmou **zero identidades com o prefixo nonce desta execução**. A foto ACTIVE que o usuário real havia acabado de salvar ficou fora de todas as seleções e exclusões do teste. Nenhum segredo, URL assinada ou dado pessoal real foi impresso; não foram gerados traces ou screenshots. Os dois scripts temporários foram removidos após registrar resultados e verificar seus caminhos absolutos.

Esta validação fecha especificamente a operação real de foto após o ajuste ambiental. Os testes de falhas, concorrência e regressões continuam documentados nos relatórios de [backend](2026-11-10-meu-perfil-backend.md) e [frontend](2026-11-10-meu-perfil-frontend.md); não foram repetidos sem necessidade.
