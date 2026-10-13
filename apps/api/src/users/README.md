# Usuários e convites — backend implementado

Cinco usuários adicionais por empresa, titular excluído da cota. Convites reservam vagas por 24 horas; aceite converte reservas em acesso e não limita a duração do vínculo aceito. Permissões detalhadas ficam para a próxima fase; convidados recebem COLLABORATOR no modelo existente.

## O que funciona

- Contratação do titular e benefício de cinco usuários por empresa.
- Capacidade individual por empresa: ocupadas, reservadas, disponíveis e excesso legado.
- Convite com nome, e-mail e múltiplas empresas, sem cadastrar usuário na emissão.
- Criação de convite/e-mail/comando/auditoria em uma única transação.
- Reenvio e edição de empresas giram token e validade; cancelamento libera reservas.
- Aceite novo com senha/confirmacão e sessão; aceite existente após login com o e-mail convidado.
- Unicidade da identidade por e-mail, sem redefinir a senha ou nome global de conta existente.
- Gestão de empresas do convidado, desativação de vínculos e proteção do titular.
- Auditoria e idempotência; resposta/histórico não expõem token.
- Fila Resend com botão de aceite e conteúdo sensível protegido por AES-256-GCM.
- Job de expiração e cancelamento de envios antigos; reservas expiram mesmo antes do job.
- Isolamento HTTP/CRM/arquivos/e-mails/lembretes/Nero por empresa e contratação.

Detalhes de modelo e decisões: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Configuração local

O `.env` local conserva o destinatário Resend `pedrovasconcellos2003@gmail.com` e a conta atual do GestãoNF usa `dircelefernandes1979@gmail.com`. Assim será possível testar o convite para o e-mail do Pedro como identidade nova, quando a interface de aceite estiver pronta.

```dotenv
NODE_ENV=development
ACCOUNTS_ALLOW_LOCAL_ACTIVATION=true
EMAIL_PAYLOAD_ENCRYPTION_KEY=BASE64_DE_32_BYTES_ALEATORIOS
EMAIL_PAYLOAD_ENCRYPTION_KEY_ID=v1
EMAIL_PAYLOAD_PREVIOUS_KEYS=
```

A chave real foi gerada no `.env` local, sem ser gravada no código ou impressa. Preserve-a entre reinícios para que a fila seja legível por API e worker. Em uma rotação, mantenha as chaves anteriores em `EMAIL_PAYLOAD_PREVIOUS_KEYS`, um mapa JSON de ID para chave Base64, até os respectivos envios terminarem. O histórico público não recebe esses valores.

`ACCOUNTS_ALLOW_LOCAL_ACTIVATION=true` é um recurso explícito de desenvolvimento e é ignorado quando NODE_ENV=production. Em produção, a criação de contratação começa PENDING e não oferece endpoint público para marcar pagamento ou plano como ativo.

Sem domínio próprio, o Resend só envia e-mail real ao endereço da sua conta Resend. Destinatários externos são recusados e não consomem reserva. [Restrição do Resend](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain). Não há dependência de webhook para o aceite de convites.

## Migração

```powershell
corepack pnpm --filter @gestaonf/api users:preflight
docker compose up -d --build api worker
```

Migration `0021_famous_siren.sql` agrupa empresas existentes pelo único OWNER, cria contratações LEGACY_DEV, preserva identidades, sessões, FKs e vínculos e torna account_id obrigatório. Falha antes de alterar o mapeamento quando uma empresa não tem titular inequívoco. Auditamos as três empresas locais e nenhuma teve mapeamento ambíguo. `0022_slimy_maverick.sql` adiciona o limite de chamadas públicas de convites.

O excesso de usuários legado permanece visível sem excluir contas automaticamente. Novos acréscimos ficam bloqueados onde não há vaga. LEGACY_DEV é a compatibilidade do ambiente atual; antes de disponibilizar contratações reais, a cobrança deve fornecer status e prazo confiáveis.

## Rotas principais

Todas as rotas administrativas exigem login e titular da contratação indicada. POST/PATCH de gestão exigem Idempotency-Key estável para a mesma ação.

| Método | Rota |
| --- | --- |
| GET/POST | `/accounts` |
| GET | `/accounts/:accountId/users` |
| GET | `/accounts/:accountId/users/capacity` |
| GET | `/accounts/:accountId/users/companies` |
| POST | `/accounts/:accountId/user-invitations` |
| POST | `/accounts/:accountId/user-invitations/:id/resend` |
| POST | `/accounts/:accountId/user-invitations/:id/revoke` |
| PATCH | `/accounts/:accountId/user-invitations/:id/companies` |
| PATCH | `/accounts/:accountId/users/:userId/companies` |
| POST | `/accounts/:accountId/users/:userId/deactivate` |
| POST | `/user-invitations/preview` |
| POST | `/user-invitations/accept-new` |
| POST | `/user-invitations/accept-existing` |

Exemplo de convite:

```json
{
  "name": "Pedro",
  "email": "pedrovasconcellos2003@gmail.com",
  "companyIds": ["UUID_DA_EMPRESA"]
}
```

Resposta 202 representa convite/e-mail gravados, não entrega. Payload: id, status, empresas, expiração, versão e estado de envio. O token não é devolvido ao titular; está no link enviado ao destinatário.

Reenvio/cancelamento usam `{ "version": 1 }`. Edição de destinos usa versão e companyIds. Edição de acesso de usuário usa a versão SHA-256 dos vínculos presente na listagem; versão antiga retorna 409. Remover todos os vínculos não exclui identidade nem afeta outras contratações.

`GET /companies` e `GET /companies/current` disponibilizam accountId para conectar a tela de usuários à contratação da empresa selecionada. Convidados veem apenas suas empresas, e não administram o cadastro de usuários.

## Aceite e frontend

A URL preparada no e-mail é `${WEB_ORIGIN}/aceitar-convite#token=...`. O frontend implementa a tela administrativa em `/usuarios` e a página de aceite em `/aceitar-convite`. A tela administrativa permite convidar, consultar vagas, editar empresas, reenviar e cancelar convites; a página de aceite cria a senha de um usuário novo ou autentica uma conta existente.

O frontend deve ler o fragmento e enviar `{ token }` para `/user-invitations/preview`. Não colocar o token na URL de API nem em analytics. O preview informa DEFINE_PASSWORD ou LOGIN, e-mail mascarado, empresas e prazo.

Nova conta:

```json
{
  "token": "TOKEN_RECEBIDO_NO_EMAIL",
  "password": "SENHA_COM_PELO_MENOS_12_CARACTERES",
  "passwordConfirmation": "SENHA_COM_PELO_MENOS_12_CARACTERES",
  "client": "web"
}
```

O backend devolve cookies de autenticação para web; `client=mobile` usa o contrato atual de tokens. Conta existente deve fazer login e chamar accept-existing com o token. Token já consumido não gera uma nova sessão pública.

Rate limit no PostgreSQL: até 100 previews e 20 tentativas de aceite por IP em 15 minutos, compartilhado entre instâncias. Usa o IP observado pelo Fastify, sem confiar livremente em X-Forwarded-For. Configurar proxies confiáveis será necessário ao mudar a topologia de produção. Tokens inválidos não bloqueiam a conta do destinatário.

## Fronteira para futura cobrança

`AccountsService.applySubscription` é um método interno, sem rota pública, com evento idempotente e versão esperada. Permite ao futuro adaptador de cobrança aplicar status, validade e cota após verificar o evento do provedor. Status ACTIVE fora de LEGACY_DEV exige validade. Uma assinatura suspensa não impede login global, mas bloqueia operações da contratação.

## Validação

Tests `apps/api/tests/users.test.ts` usam banco PostgreSQL isolado, criptografia real, scrypt real e transporte Resend substituído. Cobrem isolamento, concorrência de última vaga/duplo aceite, rollback, contas existentes, política de senha, reenvio, expiração, edição, payload protegido/expurgado, limite público e ativação interna. Os testes existentes de CRM, agenda, propostas, arquivos, e-mail e Nero usam contratações isoladas compatíveis com o novo esquema.
