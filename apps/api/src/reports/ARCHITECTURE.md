# Relatórios do GestãoNF — arquitetura proposta

Status: implementado em 13/10/2026. Contratos e instruções de verificação em `README.md`.

## Escopo e linguagem

O catálogo `services` representa os serviços/produtos cadastrados. Uma venda de serviço é um pedido em `sales` com itens em `sale_items`. São dois relatórios diferentes: **Serviços fechados** (vendas) e **Catálogo de serviços** (cadastros).

Oito relatórios independentes compõem a primeira entrega:

| Relatório | Grão da linha | Data do filtro | Fonte | Indicador principal |
| --- | --- | --- | --- | --- |
| Serviços fechados | Venda confirmada, expansível em itens | `sales.sold_on` | `sales`, `sale_items` | Soma de `sales.total_amount`, incluindo valor recebido e pendente |
| Recebimento de serviços | Movimento de recebimento/estorno | `receivable_movements.effective_on` | `receivable_movements`, `receivables`, `sales` | `RECEIPT` positivo, `REVERSAL` negativo; total líquido |
| Entrada de leads | Entrada/captação | `crm_lead_entries.received_at` | `crm_lead_entries`, `crm_contacts`, `crm_opportunities` | Entradas e contatos distintos |
| Clientes | Cliente cadastrado | Data de cadastro opcional (`customers.created_at`) | `customers` | Quantidade; CSV individual |
| Catálogo de serviços | Serviço cadastrado | Data de cadastro opcional (`services.created_at`) | `services` | Quantidade; CSV individual |
| Reuniões | Reunião | `crm_meetings.starts_at` | `crm_meetings`, `crm_contacts` | Total agendado e quantidade concluída |
| Taxa de desqualificação | Decisão comercial por oportunidade | Data da decisão em `crm_activities.occurred_at` | `crm_activities`, `crm_opportunities`, `crm_contacts` | Desqualificadas / decisões terminais |
| Taxa de perda | Decisão comercial por oportunidade | Data da decisão em `crm_activities.occurred_at` | Mesmas tabelas acima | Perdidas / decisões terminais |

## Regras de cálculo

1. **Serviços fechados:** incluir somente `sales.status = 'CONFIRMED'`. Rascunhos e cancelados ficam fora. `totalContratado = SUM(sales.total_amount)`; o valor não depende de baixa financeira. Somar `sale_items.total_amount` apenas no detalhamento por serviço ou quando houver filtro de serviço. Não somar `sales.total_amount` após fazer join direto com os itens, pois uma venda com dois itens seria duplicada. Mostrar quantidade de pedidos, total contratado e, se desejado, totais de itens por serviço. A venda pode ser editada após a confirmação; o relatório reflete o valor atual da venda para aquela data, não uma fotografia imutável do fechamento.
2. **Recebimento:** o período usa a data efetiva, não a data da venda, do vencimento ou do registro. Cada `RECEIPT` soma, cada `REVERSAL` subtrai. `totalLiquido = SUM(CASE WHEN kind='RECEIPT' THEN amount ELSE -amount END)`. Exibir também bruto recebido e estornado. Incluir movimentos de uma venda posteriormente cancelada para não apagar o histórico do mês em que houve entrada/estorno; não há movimentos de rascunho. Trata-se de recebimentos *registrados* no GestãoNF, sem conciliação bancária. Um estorno no mês seguinte reduz o mês do estorno, não altera a linha do mês de entrada. Um recebimento lançado retroativamente poderá alterar um relatório antigo quando ele for consultado de novo.
3. **Entrada de leads:** a linha é `crm_lead_entries.id`; cada nova captação gera uma oportunidade, inclusive quando o contato já existe. `entradas = COUNT(entry.id)` e `leadsUnicos = COUNT(DISTINCT entry.contact_id)`. Mostrar fonte/canal, UTMs, campanha, formulário, serviço de interesse e oportunidade vinculada. O relatório não cria cadastro em `customers` e não confunde contato CRM com cliente cadastrado. Entradas arquivadas continuam no histórico, sujeitas ao escopo de acesso CRM.
4. **Clientes e catálogo de serviços:** listar ativos e inativos, com filtro de situação. Ambos são inventários atuais; os valores e nomes exportados são os valores atuais. No catálogo, o preço sugerido é referência, não receita. Um serviço pode ter vários códigos municipais; para manter uma linha por serviço, exportá-los em uma coluna agregada ou arquivo separado, sem multiplicar linhas.
5. **Reuniões:** o período seleciona reuniões pelo início agendado, uma vez por `crm_meetings.id`. Mostrar `totalAgendadas`, `concluidas`, `canceladas`, `naoCompareceu` e `aRealizar` (status `SCHEDULED`). O destaque “reuniões realizadas” é `COMPLETED`; canceladas não contam como realizadas. Reagendamento move a reunião para outro período; status e horário refletidos são os atuais. Não usar a consulta da agenda por sobreposição de intervalos para esta apuração.
6. **Taxas comerciais:** a unidade é a **oportunidade**, pois um contato pode ter várias negociações. Para cada oportunidade, obter a última mudança de status até o fim do período a partir de `crm_activities` (`kind='STATUS_CHANGED'`, com `changes.commercialStatus.after` ou `changes.after`). Contar a oportunidade no período somente se essa última mudança ocorreu dentro dele e seu destino é `WON`, `LOST` ou `DISQUALIFIED`. Assim, uma oportunidade decidida, reaberta e decidida novamente no mesmo período entra uma vez, pela última decisão; reabertura futura não reescreve o resultado do período anterior. `decisoes = ganhas + perdidas + desqualificadas`; `taxaDesqualificacao = desqualificadas / decisoes * 100`; `taxaPerda = perdidas / decisoes * 100`. Se `decisoes=0`, devolver taxa `null` e exibir “Sem base para cálculo”. Cada página mostra lista das oportunidades que compõem seu numerador, com contato, título, data da decisão, responsável, origem e motivo, se houver. A razão fica explícita na interface para que “taxa de perda” não seja confundida com perda sobre todos os leads captados.

**Observação sobre eventos CRM:** `OpportunitiesService` registra a mudança em `changes.commercialStatus.after`; a conversão de proposta registra `changes.after`. A leitura precisa normalizar os dois formatos. `closed_at` e `commercial_status` atuais não servem para apuração histórica confiável: ao reabrir, `closed_at` é limpo, e uma mudança direta entre status terminais pode preservá-lo. Como os eventos já existem, não é necessária uma tabela nova para a primeira versão.

## Período, filtros e acesso

- Um `companyId` ativo é sempre obrigatório no cabeçalho `X-Company-Id`. Nunca aceitar a empresa apenas de um parâmetro do browser. Todas as consultas e joins usam `company_id` dos dois lados.
- Filtros comuns: `from`, `to`, busca, e filtros próprios (`customerId`, `serviceId`, origem/UTM, responsável, status). Datas de calendário são inclusivas na interface. Para colunas `date`, usar `BETWEEN from AND to`; para `timestamptz`, usar intervalo semiaberto `[meia-noite local de from, meia-noite local do dia seguinte a to)`, convertido pelo fuso IANA de `companies.timezone`. Não cortar timestamp com `::date` em UTC.
- Período inicial sugerido: mês corrente no fuso da empresa. Limite inicial sugerido para consultas interativas: 366 dias, configurável após medir desempenho. Nos inventários, período é opcional; quando preenchido, filtra data de cadastro.
- `AccessGuard` + `CompanyGuard` protegem todos os endpoints. Para CRM, manter o escopo atual de `CrmPolicyService`: proprietário/gestor vê a empresa, colaborador vê oportunidades/reuniões atribuídas e respectivas entradas. Nos relatórios de vendas, recebimentos e cadastros, seguir o acesso atual por empresa até o módulo de permissões específico existir. Aplicar o mesmo escopo aos totais, linhas e CSV; um total global com lista restrita vazaria informação.
- Períodos e decisões são apurados no servidor. Não baixar páginas da API e somar no React. Valores monetários ficam em `numeric(15,2)`/centavos; não usar `float` para somas e devolver quantias como string decimal.

## API proposta

Novo `ReportsModule` com `ReportsController`, `ReportsReadService`, `ReportsCsvService` e `reports.schemas.ts`; importar em `app.module.ts`. Consultas somente leitura. Reutilizar `DatabaseService`, guardas e `CrmPolicyService`, mas não duplicar as consultas paginadas de vendas/finanças/agenda, que possuem granularidade e filtros diferentes dos relatórios.

| Endpoint | Resultado |
| --- | --- |
| `GET /reports/closed-services` | `summary`, vendas paginadas, itens opcionais |
| `GET /reports/service-receipts` | `summary`, movimentos paginados |
| `GET /reports/lead-entries` | `summary`, entradas paginadas |
| `GET /reports/customers` | `summary`, clientes paginados |
| `GET /reports/service-catalog` | `summary`, serviços paginados |
| `GET /reports/meetings` | `summary`, reuniões paginadas |
| `GET /reports/disqualification-rate` | `summary` com numerador/denominador/taxa, oportunidades paginadas |
| `GET /reports/loss-rate` | Mesmo contrato, para perdas |
| `GET /reports/customers.csv` | CSV completo dos clientes filtrados |
| `GET /reports/service-catalog.csv` | CSV completo dos serviços filtrados |

Contrato comum JSON: `{ summary, items, nextCursor, filters, generatedAt }`. Filtros validados por Zod; ordenação determinística (`data DESC, id DESC`) e paginação por cursor para listas grandes. Resumo e página usam a mesma função de filtros. Nos dois relatórios de taxa, calcular `WON`, `LOST` e `DISQUALIFIED` numa única consulta/base comum para assegurar mesmo denominador. Realizar leitura de resumo+lista na mesma transação `REPEATABLE READ` quando consistência entre ambos for necessária.

CSV: gerar no backend com os mesmos filtros e autorização do JSON, sem o limite de 100 linhas da listagem. Cabeçalho `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment`, UTF-8 com BOM e separador `;` para Excel brasileiro. Escapar aspas, separadores, CR/LF e neutralizar células iniciadas por `=`, `+`, `-` ou `@` (inclusive após espaços) para evitar execução de fórmulas. CPF/CNPJ, CEP e códigos devem permanecer texto. Usar streaming/cursor do banco e limite operacional configurável para não carregar toda a empresa em memória; registrar apenas metadados de exportação, sem conteúdo pessoal no log.

## Banco de dados e desempenho

Nenhuma tabela nova é necessária. Índices existentes já cobrem `sales(company_id,status,sold_on)`, `crm_lead_entries(company_id,received_at)`, `crm_meetings(company_id,starts_at)` e `services(company_id,status,name)`. Na implementação, medir com `EXPLAIN (ANALYZE, BUFFERS)` e considerar estes índices adicionais antes de liberar relatórios grandes:

- A migração `0023_reports_read_indexes` adicionou `receivable_movements(company_id,effective_on,id)`, para recebimentos e estornos.
- Foi adicionado `crm_activities(company_id,opportunity_id,occurred_at DESC,recorded_at DESC,id DESC)`, parcial para `STATUS_CHANGED`, para a consulta da última transição por oportunidade.
- Foram adicionados `customers(company_id,created_at DESC,id DESC)` e `services(company_id,created_at DESC,id DESC)` para períodos de cadastro e exportação por cursor.
- Ordenação e cursor usam as colunas de data originais; a formatação textual ocorre somente na resposta, preservando uso dos índices.

Não criar cache, tabela agregada ou rotina de atualização agora. Consultas diretas são mais simples e refletem edições imediatamente. Reavaliar com volume real, tempo de resposta e planos de execução. Se surgir exigência de fotografia contábil imutável, criar snapshots/versionamento específicos; o esquema atual não garante valor da venda “como era” num fechamento antigo.

## Frontend proposto

`/relatorios` vira índice com oito cartões separados; `/relatorios/:tipo` abre detalhe com seletor de período, filtros, indicadores, tabela e paginação. Os relatórios de clientes e catálogo terão botão `Exportar CSV`; o período nesses dois é opcional. Separar visualmente “Serviços fechados” de “Catálogo de serviços” para não misturar faturamento com cadastro. Mostrar a empresa selecionada, período e hora de apuração; nas taxas, mostrar numerador e denominador ao lado do percentual. Manter a seleção de empresa do `WorkspaceLayout` e invalidar todas as consultas ao trocar de empresa.

## Verificações de aceitação

1. Venda com dois serviços e pagamento parcial: total contratado conta a venda uma vez; pendência não reduz o total. Filtro por serviço soma apenas seus itens.
2. Recibo, recibo parcial e estorno em meses distintos: total de cada mês corresponde à soma assinada dos movimentos de sua data efetiva, inclusive após cancelamento da venda.
3. Mesmo contato com duas entradas/oportunidades: entrada mostra duas linhas e um contato distinto; perdas/desqualificações são contadas por oportunidade.
4. Oportunidade perdida, reaberta, depois ganha: cada período mantém seu estado no fechamento respectivo; última decisão dentro do mesmo período prevalece.
5. Reunião remarcada, concluída ou cancelada: uma linha no período do início atual; somente concluídas contam como realizadas.
6. Colaborador não obtém dados CRM de outros responsáveis via resumo, lista, cursor ou CSV; empresa A não lê dados da empresa B.
7. CSV de clientes/serviços inclui todos os registros filtrados, mantém códigos com zeros à esquerda e não permite fórmulas executáveis.

## Decisões e limites

| Decisão | Motivo | Limite aceito |
| --- | --- | --- |
| Ler as tabelas atuais, sem materialização | Volume inicial desconhecido; dados atualizados imediatamente | Consultas pesadas podem exigir índices/agregados depois |
| Apurar fechamento comercial por eventos | Reabertura e troca de status tornam `closed_at` insuficiente | Normalizar dois formatos de `changes` já gravados |
| Recebimento no nível da venda/parcela | O banco não associa cada baixa a um item de serviço | Não oferecer “recebimento por serviço” até definir regra de rateio |
| CSV gerado no servidor | Mesmo filtro/permissão; exporta além da página visível | Requer limite/streaming para grandes volumes |

Critério de período confirmado: desqualificação e perda usam a data em que a negociação foi encerrada. O denominador proposto é o total de decisões terminais nesse período; uma taxa por coorte de leads que entraram no período seria outro indicador, com outro significado.
