# Implantação das permissões de usuário

Migração de expansão `0041_account_member_permissions`, conforme as seções 6.1 a 6.4 da Spec de Permissões de Usuário.

## Expansão

1. Identifique e preserve as imagens atuais. Confirme que a candidata inclui a gestão unificada de acesso e o aceite da Tarefa 9.5. Construa as imagens com `docker compose build api worker web`.
2. Abra a janela de manutenção e execute `docker compose stop web worker api`. Confira a parada com `docker compose --profile full ps --all`. Confirme também a ausência de instâncias antigas fora desse Compose e de transações da aplicação no banco.
3. Faça o backup do PostgreSQL. Com web, worker e API parados, execute `docker compose run --rm --no-deps api sh -c "npm run db:migrate --prefix database"`. Se a migração falhar, mantenha a aplicação parada e investigue.
4. Confira os conjuntos e eventos migrados.

   ```sql
   SELECT role_label, cardinality(permissions) AS chaves, count(*)
   FROM account_members GROUP BY 1, 2 ORDER BY 1, 2;

   SELECT count(*) FROM account_members;
   SELECT count(*) FROM user_management_events WHERE event_type = 'PERMISSIONS_MIGRATED';

   SELECT count(*) FROM user_invitations
   WHERE status = 'PENDING' AND cardinality(permissions) > 0;
   ```

   Espere 34 chaves para Colaborador, 38 para Gerente legado e 45 para Administrador legado ou Proprietário sem titularidade. O Administrador legado recebe o rótulo Gerente. Os totais de linhas e eventos devem coincidir. O último resultado deve ser zero antes de abrir a API.
5. Suba apenas a API candidata com `docker compose up -d --no-deps api`. Confira a imagem e aguarde o healthcheck. Mantenha worker e web parados enquanto a API estiver indisponível.
6. Suba o worker e o web com `docker compose up -d worker web`. Confira os logs da API e do worker para falhas de importação do pacote ou `permission_policy_missing`.
7. Confira o acesso do titular, de um colaborador migrado e de um membro sem permissões. O membro com acesso vazio deve chegar a `/sem-acesso`. Se uma aba aberta antes do corte tentar salvar pelas rotas antigas e receber 404, recarregue a página.
8. Registre a janela, as imagens, os resultados das consultas e a retomada de cada serviço.

## Rollback

- Antes da 0041, confirme que o schema da expansão ainda está ausente. Restaure as imagens anteriores e reabra o serviço.
- Depois da 0041, mantenha web, API e worker parados e preserve o schema, os dados e a auditoria. Preserve os tokens e o prazo original dos convites. Retome pela API compatível com a 0041 e aguarde sua saúde antes de subir worker e web. Se houver indício de aceite pela API legada após a migração, investigue os acessos afetados antes de reabrir.

## Ensaio local em 23/11/2026

Usei o projeto Compose descartável `gestaonf-perm-check` com banco, volumes e portas próprios. A API legada iniciou no schema 0040. Parei web, worker e API, confirmei zero conexões da aplicação, fiz backup com `pg_dump -Fc` e apliquei a 0041 pela imagem candidata. A migração gerou três eventos para três linhas, com conjuntos de 34 e 38 chaves. Os três convites migrados ficaram vazios e com os prazos originais. Uma tentativa de aceite durante a pausa recebeu conexão recusada.

| Cenário após a retomada da API | Resultado |
| --- | --- |
| Ex-membro com convite válido | HTTP 200. Vínculo ativo, zero permissões, versão 2 e um evento de aceite. |
| Ex-membro com convite expirado | HTTP 410. Vínculo inativo, versão 1 e prazo original. |
| Membro ativo com convite pendente para a filial | HTTP 200. Sede e filial ativas, rótulo Gerente, 38 permissões e versão 1. O evento registrou a filial e nenhuma remoção de permissão. |

As três imagens foram construídas e o pacote retornou 45 chaves quando importado via `tsx`. O ensaio subiu worker e web após a API candidata ficar saudável. A verificação das imagens deve ser repetida com a versão que será implantada.

O ensaio de 24/11/2026 confirmou os mesmos resultados no projeto descartável `gestaonf-perm-verify`. O `pg_dump -Fc` foi feito antes da 0041, com zero conexões da aplicação. A API nova ficou saudável antes de iniciar worker e web. Nas três imagens, a importação via `tsx` retornou 45 chaves. O Node executado diretamente na imagem da API não resolveu as extensões dos imports TypeScript. Para repetir a verificação da API, execute `docker compose run --rm --no-deps api npx --no-install tsx -e "import { ALL_PERMISSIONS } from '@gestaonf/permissions'; console.log(ALL_PERMISSIONS.length)"`. Use o mesmo comando para `worker` e `web`.

## Contração

A contração depende da expansão em produção e de um pedido explícito. As duas rotas de vínculo substituídas já saíram na expansão.

- **C1.** Tornar `company_users.role` anulável, parar de ler e gravar a coluna e retirar o campo legado `role` de `/companies`. Aplicar na mesma ordem da expansão.
- **C2.** Após a C1 estar em produção, remover a coluna e a restrição `company_users_role_chk`. Aplicar na mesma ordem da expansão.
