# Agenda comercial — banco e backend implementados

Entrega: migration `0017_crm_meetings.sql`, API CRM e worker de notificações internas.

## Funcionalidades

- Agendar reuniões com lead obrigatório, oportunidade opcional, título, responsável, horário com offset, fuso IANA, modalidade, local/link, notas e participantes.
- Reutilizar referências de leads e usuários; participantes externos recebem dados próprios.
- Agenda paginada por janela de tempo; filtros por responsável, contato, negociação, modalidade, situação e busca.
- Editar conteúdo, responsável e regras; reagendar, concluir, cancelar, registrar ausência e reabrir explicitamente.
- Qualificar somente a oportunidade escolhida em NEW/CONTACTING, quando a automação está ativa. Cancelar não encerra uma negociação.
- Guardar eventos completos com antes/depois, inclusive participantes e regras de lembrete.
- Notificar o responsável por meio de uma caixa interna persistida; marcar mensagens como lidas.

O documento `MEETINGS-ARCHITECTURE.md` registra a revisão anterior e a evolução proposta. Os blocos 1–3 de backend e a tela de agenda estão implementados. As tools de agendamento do Nero seguem como entrega posterior. O contexto interno de comando permite registrar NERO como ator, mas ainda não existe tool de agendamento registrada no assistente.

## Interface web

A rota `/agenda` apresenta a semana, filtros por título/lead, situação, responsável e modalidade, paginação, criação, edição, reagendamento, mudança de situação, histórico e lembretes internos. O card do CRM oferece acesso direto ao agendamento com lead e negociação preenchidos. A interface usa o fuso da empresa e preserva o fuso da reunião ao editá-la; horários inválidos na transição de horário de verão são rejeitados. Conflitos exigem confirmação explícita. Preferências da agenda ficam disponíveis a gestores.

## Contratos

Todas as rotas usam autenticação e `X-Company-Id`. Os contratos de entrada estão no Swagger em `/docs` e `/docs-json`.

| Método | Rota | Uso |
| --- | --- | --- |
| POST | `/crm/meetings` | Criar; exige Idempotency-Key |
| GET | `/crm/meetings` | Janela `from/to` ISO com offset, até 366 dias, limit/offset |
| GET | `/crm/meetings/responsibles` | Responsáveis ativos autorizados |
| POST | `/crm/meetings/conflicts` | Verificar conflitos; não reserva horário |
| GET/PATCH | `/crm/meetings/:id` | Consultar/editar; PATCH exige expectedVersion |
| POST | `/crm/meetings/:id/reschedule` | Reagendar; expectedVersion |
| PATCH | `/crm/meetings/:id/status` | COMPLETED, CANCELED ou NO_SHOW; expectedVersion |
| POST | `/crm/meetings/:id/reopen` | Retornar a SCHEDULED; expectedVersion e checagem de horário |
| GET | `/crm/meetings/:id/history` | Histórico paginado do compromisso |
| GET/PATCH | `/crm/meeting-settings` | Automação, antecedência padrão e política de conflito |
| GET | `/crm/notifications` | Caixa do usuário/empresa; filtro unreadOnly |
| PATCH | `/crm/notifications/:id/read` | Marcar lida; somente destinatário |

Exemplo de criação:

```json
{
  "contactId": "UUID_DO_LEAD",
  "opportunityId": "UUID_DA_NEGOCIACAO",
  "title": "Apresentação da proposta",
  "startsAt": "2030-01-15T14:00:00-03:00",
  "endsAt": "2030-01-15T15:00:00-03:00",
  "timezone": "America/Sao_Paulo",
  "modality": "ONLINE",
  "meetingUrl": "https://meet.example.com/sala",
  "reminderMinutes": [30, 1440]
}
```

Resposta: `meetingId`, `conflicts` e `opportunityQualified`. Replay devolve o resultado original, após verificar autorização atual. Chaves são específicas de empresa, usuário e tipo de ator. DTOs de leitura não expõem chave, hash ou resposta interna de idempotência.

Conflito retorna HTTP 409 com `code: MEETING_TIME_CONFLICT`. Confirmar a sobreposição exige novo envio com `allowConflict: true`. Erros de versão também retornam 409. Status e etapa comercial continuam independentes.

## Acesso

Gestores acessam agenda da empresa; colaborador acessa reuniões das quais é responsável. Participação não concede acesso comercial. Um responsável pode receber o contexto mínimo do contato necessário ao compromisso, mas a negociação privada não aparece no detalhe.

O histórico próprio da reunião continua acessível ao responsável mesmo sem acesso à ficha geral do contato. A timeline geral do lead mantém o escopo CRM existente e também filtra a permissão da reunião.

## Consistência e horário

Locks transacionais de agenda são por empresa/responsável. Ao transferir, responsáveis antigo e novo são bloqueados em ordem determinística. Depois: contato, oportunidade, reunião e ocorrências. Toda escrita revalida versão e autorização; nenhuma alteração real significa nenhuma nova versão/evento.

Intervalos são `[início, fim)`: horários adjacentes não conflitam. A disponibilidade considera o responsável dentro da empresa selecionada. Não inclui automaticamente outras empresas ou agendas de participantes.

Horários são `timestamptz`; a interface deve usar o fuso preservado. Links são restritos a HTTP/HTTPS. Não há recorrência ou conector Google Calendar nesta entrega.

## Lembretes e worker

Regras ativas são separadas das ocorrências de entrega. Reagendamento, reabertura, transferência ou mudança de antecedência cria uma nova revisão e cancela pendências antigas. Entregas anteriores são preservadas.

O worker verifica pendências a cada 15 segundos. Bloqueia reunião antes da ocorrência, valida estado/revisão/responsável/regra/acesso e insere notificação mais resultado de entrega na mesma transação. Unicidade por ocorrência impede duplicação entre workers ou após reinício.

Avisos futuros que perderam a janela tornam-se EXPIRED. Antecedência zero permite uma tolerância de 30 segundos no início para acomodar o ciclo do worker. Não há envio de WhatsApp/e-mail automático; IN_APP significa entrega persistida, ainda dependente de interface para exibição.

As estatísticas de lote e falhas são registradas no log do worker. Os registros de ocorrências mantêm estados PENDING, DELIVERED, CANCELED ou EXPIRED para inspeção operacional. O worker retoma pendências após reinício.

## Banco e operação

Sete novas tabelas: configurações, reuniões, participantes, eventos, regras, ocorrências e notificações. FKs compostas impedem cruzamento de empresa e vínculo de evento ao contato errado. O histórico CRM recebe `meeting_id` e tipos de atividade adicionais.

Ordem de instalação: migration primeiro; API/worker depois. A migration é aditiva e não apaga registros de negócio existentes.

```text
npm run db:migrate
docker compose up -d --build api worker
```

Os testes de integração criam e removem bancos PostgreSQL isolados. Validam concorrência, replay, autorização, rollback, snapshots, automação, configuração, entrega única, reagendamento, cancelamento e expiração. Os testes de contratos validam intervalos, offsets e hash de comando.
