# Relatórios

Os oito relatórios estão disponíveis em `/relatorios`, com uma rota de detalhe para cada relatório. As consultas são somente leitura e usam as tabelas existentes. A migração `0023_reports_read_indexes` adiciona quatro índices e é aplicada pelo contêiner da API na inicialização.

## API

Todas as rotas exigem sessão ou Bearer e `X-Company-Id` de uma empresa autorizada.

| GET | Filtros específicos, além de período e busca |
| --- | --- |
| `/reports/closed-services` | `customerId`, `serviceId`, `assignedUserId` (autor da venda) |
| `/reports/service-receipts` | `customerId`, `assignedUserId` (autor do movimento), `paymentMethod` |
| `/reports/lead-entries` | `serviceId`, `assignedUserId`, `captureKind`, `utmSource`, `utmCampaign`, `sourceFormReference` |
| `/reports/customers` | `status=ALL/ACTIVE/INACTIVE` |
| `/reports/service-catalog` | `status=ALL/ACTIVE/INACTIVE` |
| `/reports/meetings` | `assignedUserId`, `status=ALL/SCHEDULED/COMPLETED/CANCELED/NO_SHOW` |
| `/reports/disqualification-rate` | Mesmos filtros da entrada de leads |
| `/reports/loss-rate` | Mesmos filtros da entrada de leads |
| `/reports/customers.csv` | Mesmos filtros de clientes; todas as linhas, até 50 mil |
| `/reports/service-catalog.csv` | Mesmos filtros do catálogo; todas as linhas, até 50 mil |
| `/reports/options` | `field=customerId/serviceId/assignedUserId`, `search`, `limit` até 100 |

`from` e `to` usam `YYYY-MM-DD`, são inclusivos e limitados a 366 dias. São opcionais nos dois catálogos; se utilizados, ambos devem ser informados. Nos outros relatórios são obrigatórios. A API rejeita filtros desconhecidos ou incompatíveis com o relatório.

JSON retorna `{ summary, items, nextCursor, filters, generatedAt, timezone, visibility }`. `limit` vale de 1 a 100, padrão 25. Para avançar, repetir os filtros e enviar `cursor=nextCursor`. O cursor fica vinculado ao usuário, empresa, tipo e filtros. Totais são calculados sobre toda a seleção e não mudam ao avançar de página. Quantias financeiras são strings decimais.

## Regras implementadas

- Serviços fechados: vendas confirmadas; total inclui recebimentos e pendências. Dois itens não duplicam o total do pedido. Filtro por serviço soma somente seus itens e omite métricas financeiras por item, pois as baixas pertencem à venda.
- Recebimentos: soma de movimentos por data efetiva, com estornos negativos. Cancelar uma venda não apaga seu histórico financeiro. O resumo mostra valor bruto, estornado e líquido.
- Entrada de leads: uma linha por captação, com contagem adicional de contatos distintos. Uma pessoa pode ter várias entradas e negociações. Não cria cadastro de cliente.
- Reuniões: seleção pelo início agendado; concluídas são as realizadas. Reagendamento e status refletem os dados atuais.
- Taxas: última transição real de status até o fim do período. A decisão deve estar dentro do período e ser ganha, perdida ou desqualificada. Mudanças só no motivo não contam como outra decisão. A taxa divide o numerador pelo total de decisões terminais. Base zero retorna `null`. Reabertura posterior preserva o relatório anterior; reabertura dentro do período retira a negociação da base enquanto ela continuar aberta.
- As taxas preservam o motivo registrado na transição, quando disponível. Nome, responsável e origem mostram os dados atuais. Históricos dos dois formatos de status existentes são suportados.
- Proprietários e gestores consultam todo o CRM da empresa. Colaboradores consultam suas oportunidades/reuniões e entradas correspondentes. Resumo e detalhes compartilham o mesmo escopo. Vendas, recebimentos e catálogos seguem o acesso por empresa vigente nesses módulos.
- CSV usa filtros aplicados, UTF-8/BOM, `;`, aspas escapadas e proteção contra fórmulas de planilha. Campos de identificação recebem prefixo de texto para preservar zeros. Os registros são lidos em lotes de 500 dentro de uma transação consistente; desconexão interrompe a exportação.

## Verificação

`corepack pnpm --filter @gestaonf/api exec vitest run tests/reports.test.ts` cria um banco temporário, aplica as migrações, testa SQL e HTTP e remove esse banco ao terminar. Abrange as oito consultas, baixas parciais, estornos após cancelamento, reaberturas, fuso local, escopo CRM, cursor e CSV com 520 clientes.

`corepack pnpm --filter @gestaonf/web exec playwright test e2e/reports.spec.ts` verifica cartões, rotas, indicadores, período aplicado, paginação, troca de empresa, download CSV e layout no celular. Esses testes de interface utilizam respostas controladas; os cálculos reais são verificados pelos testes PostgreSQL.
