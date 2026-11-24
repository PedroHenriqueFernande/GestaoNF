# Desempenho das listas do CRM (por empresa e combinadas)

Medições das listas de leads, negociações, reuniões e propostas (Spec 9A.2, Tarefas 14.3 e 14.10). Sem dump de plano: só o nó principal e o tempo.

## Como reproduzir

Pré-requisito: `npm run infra:up`.

- Git Bash: `CRM_EXPLAIN=1 npm run test -w backend -- tests/crm-overview.test.ts -t "EXPLAIN"`
- PowerShell: `$env:CRM_EXPLAIN='1'; npm run test -w backend -- tests/crm-overview.test.ts -t "EXPLAIN"; Remove-Item Env:CRM_EXPLAIN`

O teste é opt-in (variável `CRM_EXPLAIN`) e imprime os planos no console. Dois casos:

| Caso | Volume |
|---|---|
| `EXPLAIN ANALYZE das quatro listas com 50 empresas` | 50 empresas, 40 registros por tabela cada, visão combinada (`companies=all`) |
| `EXPLAIN: período de 7 dias usa o índice de data...` | 1 empresa (fuso America/Sao_Paulo), 50 mil contatos, entradas, negociações e propostas em 700 dias |

## Visão combinada, 50 empresas (Tarefa 14.3)

Itens e total/resumo, em ms de execução: leads 12,6 e 12,0; negociações 14,9 e 13,6; reuniões 2,3 e 1,1; propostas 5,6 e 7,4. A consulta de escopo (empresas do usuário) leva cerca de 0,3 ms. O planejador escolhe varredura sequencial, porque as tabelas são pequenas; isso é esperado.

## Período de 7 dias, uma empresa com 50 mil registros (Tarefa 14.10)

Consulta de total/resumo, filtro `from=2026-03-01&to=2026-03-07`.

| Lista | Nó da data antes | Tempo antes | Nó da data depois | Tempo depois |
|---|---|---|---|---|
| Negociações (`received_at`) | `Filter` com `SubPlan` | 132 ms | `Index Cond` | 16 ms |
| Leads (`created_at`) | `Filter` com `SubPlan` (mesmo `period`) | não medido | `Index Cond` | 0,2 ms |
| Propostas (`created_at`) | `Filter` com `SubPlan` (mesmo `period`) | não medido | `Index Cond` | 13,6 ms |

O "antes" das negociações vem da primeira execução do caso de volume, que falhou nessa lista e interrompeu o laço. As outras duas passam pela mesma função `period`. Os 16 e 13,6 ms de "depois" incluem a varredura sequencial de tabelas ligadas por junção (contatos e negociações), que as listas precisam; a data deixou de ser o gargalo.

## Decisão: EXISTS, JOIN ou subconsulta escalar

O fuso vem da empresa de cada registro, e as duas versões usam a mesma expressão com uma ou várias empresas.

- Subconsulta escalar (`companyZone`) dentro da comparação: o planejador não a trata como constante, e a data vai para `Filter`. Medição do Arquiteto no count de uma empresa: 330 ms. Medição na 14.10: 132 ms nas negociações.
- `EXISTS` sobre a PK de `companies`: vira junção, e a data fica no `Index Cond`. Protótipo do Arquiteto: 0,6 ms.
- JOIN explícito: 2,0 ms no protótipo, mas altera a forma das consultas (duplicação e agregações). O `EXISTS` deixa os chamadores (`contactFilters`, `negotiationFilters`, `ProposalReadService.listConditions`) intocados.

Regra: nenhuma subconsulta escalar de fuso por linha (`companyZone` foi removida). Filtros usam `inCompanyZone` (EXISTS sobre a PK), e expressões por linha, como a situação efetiva das propostas, usam `companies` juntada uma vez na consulta (`ProposalReadService.page`).

## Situação efetiva das propostas (Tarefa 14.11)

O custo que a 14.10 atribuía ao `effectiveStatus` tinha outra causa. Os 92,8 ms medidos sem período eram cerca de 65 ms de hash joins mais cerca de 28 ms de JIT. O JIT foi disparado pela estimativa inflada pelos SubPlans (cerca de 217 mil linhas, contra cerca de 6.400). Os SubPlans não chegaram a executar ("never executed"), porque aquele seed não tinha propostas SENT.

Pior caso, 50 mil propostas SENT (1 empresa), antes da 14.11:

| Consulta | Antes | Depois |
|---|---|---|
| 4 contagens do resumo | 206 ms sem JIT, 230 ms com JIT (script do Revisor) | 73 ms (`status=ALL`, total/resumo) |
| `count` do filtro EXPIRED | 134 ms (protótipo do Arquiteto; 21,6 ms com junção) | 41 ms (itens e total/resumo) |
| `status=ALL`, itens | 83,5 ms, com SubPlan | 68 ms, sem SubPlan nem JIT |

Seed do caso opt-in: `valid_until = current_date + ((g % 100) - 10)`, cerca de 10% vencidas, todas `SENT`.

### Custo conhecido: estimativa do filtro de situação

Com `status=SENT` num volume dominante (cerca de 90% das linhas), o planejador usa a seletividade padrão do `CASE` (cerca de 250 linhas estimadas, contra cerca de 45 mil reais) e escolhe junções em laço aninhado. Medido: 192 ms (itens e total/resumo), sem SubPlan nem JIT. Esse custo vem do `CASE` opaco, existia antes da Etapa 14 e não é corrigido agora; o caso opt-in só registra o tempo e confere a estrutura. Revisitar se esse filtro passar a ser usado em listas muito grandes. Alternativas: expressar o filtro como condições sobre `status` e `valid_until` (por exemplo `status = 'SENT' and valid_until >= data local`), ou criar estatísticas. Não se justifica índice sem evidência.

## Custos conhecidos e quando revisitar

- **50 empresas na visão combinada.** O planejador usa varredura sequencial. Revisitar se uma conta passar da escala informada.
- **Estimativa do filtro de situação.** Veja a seção anterior.
- **Limites do teste.** 100 ms para o período e 150 ms para `ALL` e `EXPIRED`. Dependem da máquina. A trava principal é o `Index Cond` da data e a ausência de SubPlan e JIT.
