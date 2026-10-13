# Resend — configuração e uso

## Preparado nesta entrega

- Módulo `EmailsModule`, serviço reutilizável e outbox transacional por empresa.
- Envios de texto com HTML do GestãoNF, teste, histórico e estados de entrega.
- Worker, retentativas, idempotência, timeout e recuperação de processos interrompidos.
- Webhook autenticado com assinatura Svix, deduplicação e conciliação fora de ordem.
- Configuração no `.env` e Docker, migration e teste de conexão por terminal.

Arquitetura e decisões: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Sem domínio próprio

O remetente de testes é `GestãoNF <onboarding@resend.dev>`. O Resend permite enviar e-mail real com esse remetente ao e-mail da sua própria conta. O GestãoNF valida essa restrição antes de enfileirar. Os endereços `delivered@resend.dev`, `bounced@resend.dev`, `complained@resend.dev` e `suppressed@resend.dev` servem para simulações, não caixas de entrada reais. [Domínio de testes](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [destinatários de simulação](https://resend.com/docs/dashboard/emails/send-test-emails).

O `.env` local foi preparado com `RESEND_TEST_RECIPIENT=pedrovasconcellos2003@gmail.com`. Envio permanece desativado até a API key ser configurada.

## Credenciais necessárias

1. Em [API Keys](https://resend.com/api-keys), crie uma chave com permissão **Sending access**. O envio não precisa de Full access.
2. No `.env` da raiz:

```dotenv
RESEND_ENABLED=true
RESEND_API_KEY=re_SUA_CHAVE
RESEND_TEST_MODE=true
RESEND_FROM="GestãoNF <onboarding@resend.dev>"
RESEND_TEST_RECIPIENT=pedrovasconcellos2003@gmail.com
RESEND_REPLY_TO=
RESEND_WEBHOOK_SECRET=
EMAIL_COMPANY_DAILY_LIMIT=100
```

`RESEND_REPLY_TO` é opcional e deve ser um endereço real para receber respostas. A API key e secret de webhook só são fornecidos ao API e worker. O frontend não recebe nenhum segredo. Sem webhook configurado, o envio funciona e o histórico mostra ACCEPTED/PENDING; a entrega ainda pode ser consultada no painel Resend.

3. Atualize o ambiente local:

```powershell
docker compose up -d --build api worker
```

O API aplica a migration ao iniciar e o worker aguarda a saúde do API. Para processos no terminal, após migrar o banco, execute `npm run api:dev` e `npm run worker:dev` em terminais diferentes.

## Teste real pelo terminal

```powershell
# Simulador Resend: confirma o aceite da requisição, sem enviar à sua caixa
corepack pnpm --filter @gestaonf/api email:check

# Envia um teste real para RESEND_TEST_RECIPIENT
corepack pnpm --filter @gestaonf/api email:check --own
```

Esses comandos verificam a conexão diretamente com o provedor, sem criar registros comerciais. Para validar também a fila e o histórico, use o endpoint autenticado `POST /emails/test` no Swagger local `http://localhost:3000/docs` e acompanhe `GET /emails/{id}`.

## Webhook de entrega

Em [Webhooks](https://resend.com/webhooks), adicione:

```text
https://SEU-TUNEL-HTTPS/integrations/email/resend/webhook
```

Use o túnel público que aponta para o API local de porta 3000. `localhost` pode enviar para a API Resend pela internet, mas não recebe callbacks externos. Se a URL temporária mudar, atualize o destino no painel.

Assine: `email.sent`, `email.delivered`, `email.delivery_delayed`, `email.failed`, `email.bounced`, `email.complained`, `email.suppressed`.

Copie o **Signing secret** (`whsec_...`) para `RESEND_WEBHOOK_SECRET` e recrie API/worker. Esse secret é diferente da API key. O servidor verifica `svix-id`, `svix-timestamp` e `svix-signature` usando o corpo original capturado pelo Fastify. [Documentação de assinatura](https://resend.com/docs/webhooks/verify-webhooks-requests).

## Contrato HTTP

Todas as rotas de envio/histórico exigem autenticação e `X-Company-Id`. Operações POST exigem `Idempotency-Key` estável por ação; gerar uma chave nova apenas para uma ação realmente nova.

| Método | Rota | Resultado |
| --- | --- | --- |
| GET | `/emails/capabilities` | Ativação, teste, remetente, permissão e disponibilidade do webhook |
| POST | `/emails/test` | 202: teste enfileirado para o destinatário configurado ou simulador |
| POST | `/emails` | 202: e-mail enfileirado; somente gestores |
| GET | `/emails` | Histórico paginado da empresa; colaborador vê apenas os seus |
| GET | `/emails/:id` | Metadados e cronologia de eventos; corpos não expostos |
| POST | `/integrations/email/resend/webhook` | 200 após assinatura e processamento durável; dispensa login e header de empresa |

Teste:

```json
{ "scenario": "OWN" }
```

Outros cenários: `DELIVERED`, `BOUNCED`, `COMPLAINED`, `SUPPRESSED`. Envio de mensagem:

```json
{
  "to": "pedrovasconcellos2003@gmail.com",
  "subject": "Teste GestãoNF",
  "message": "O envio de e-mails está pronto para as próximas funcionalidades."
}
```

Uma resposta 202 confirma gravação na fila. `ACCEPTED` significa aceite do provedor; `DELIVERED` depende do webhook e significa recebimento pelo servidor destinatário. Não há criação automática de clientes, leads ou contatos do Resend.

## Uso por módulos futuros

Importe `EmailsModule` no módulo chamador e injete `EmailsService`:

```typescript
await database.db.transaction(async tx => {
  // Salvar a ação comercial e autorizar a operação neste módulo.
  await emails.enqueueInTx(tx, { companyId, userId }, {
    to: recipient,
    subject: 'Sua proposta está disponível',
    message: 'Texto preparado pela função comercial.',
  }, `proposal/${proposalEventId}`, 'PROPOSAL');
});
```

Finalidade: 1–64 caracteres ASCII em maiúsculas, números ou `_`. A chave precisa ser estável e incluir o evento de negócio; não apenas o destinatário. Serviços externos não devem chamar o método sem contexto autorizado.

## Operação

O orçamento local padrão é 100 mensagens admitidas por empresa por dia UTC, incluindo testes e falhas; configurável por `EMAIL_COMPANY_DAILY_LIMIT`. A cota da conta Resend é compartilhada entre as empresas e continua sendo imposta pelo provedor. Worker limita reservas globais a uma por segundo e respeita `Retry-After`.

Mensagens UNKNOWN requerem conferir o painel Resend antes de criar um novo envio. Falhas definitivas não são reenviadas automaticamente. Após uma rejeição, supressão ou reclamação, novos envios para o destinatário na mesma empresa são bloqueados em produção; na simulação esses bloqueios não impedem repetir testes.

Quando tiver domínio, verifique-o no painel, configure os registros DNS, ajuste `RESEND_FROM`, mude `RESEND_TEST_MODE=false` e recrie os contêineres. Mensagens antigas pendentes não trocam de remetente silenciosamente; são encerradas para preservar a segurança da retentativa.

Histórico e conteúdo ficam no PostgreSQL. A política de retenção de mensagens deverá ser definida antes de usar conteúdo sensível em notificações de produção. Nesta entrega não há anexos, campanhas de marketing ou recebimento de respostas por webhook; essas funções terão contratos próprios.
