# Núcleo de leads do CRM

Este módulo cadastra contatos comerciais separados de Clientes. Cada entrada confirmada gera uma captação, um card `NEW` na primeira coluna do funil e histórico na mesma transação. Novas manifestações podem aproveitar um contato selecionado; reenvios com a mesma chave não duplicam registros.

## Acesso e contratos

As rotas usam a autenticação existente e `X-Company-Id`. A política também é verificada pelos serviços. OWNER, ADMIN e MANAGER acessam os registros da empresa; COLLABORATOR acessa contatos sob sua responsabilidade ou com uma negociação atribuída a ele, com detalhes de negociações e captações limitados à sua carteira.

POSTs de captação e notas exigem `Idempotency-Key` de até 128 caracteres. Alterações de registros versionados exigem `expectedVersion`. Conflitos retornam 409. Todos os corpos são estritos; IDs de empresa, ator e conector não são aceitos pelo corpo HTTP.

Exemplo de `POST /crm/leads`:

```json
{
  "lead": { "name": "João Silva", "phone": "(61) 99999-0000" },
  "interest": { "description": "Consultoria", "estimatedAmount": "5000.00" },
  "capture": { "utmSource": "instagram", "utmMedium": "paid_social", "utmCampaign": "feira_outubro" }
}
```

Resposta 201 com `leadId`, `entryId` e `opportunityId`. Somente nome é obrigatório para um novo contato. Telefone incompleto é permitido; CPF/CNPJ informado exige tipo e validação. Dinheiro é enviado e retornado como string decimal.

O responsável indicado no contato é usado no primeiro card quando o responsável da negociação não for informado separadamente. Na ausência de ambos, o cadastro manual usa o usuário autenticado.

## Rotas

| Rotas | Operações |
| --- | --- |
| `/crm/leads` | Criar e listar contatos |
| `/crm/leads/duplicate-candidates` | Sugerir correspondências por documento, e-mail ou telefone, sem mesclagem automática |
| `/crm/leads/:id` | Consultar e atualizar perfil |
| `/crm/leads/:id/entries` | Consultar entradas e registrar novo interesse com novo card |
| `/crm/leads/:id/history` e `/notes` | Consultar histórico e adicionar nota geral ou da negociação |
| `/crm/leads/:id/customer-link` | Vincular ou desvincular explicitamente um Cliente existente |
| `/crm/leads/:id/archive` e `/restore` | Arquivar/restaurar contato |
| `/crm/opportunities` e `/:id` | Listar, consultar e atualizar cards |
| `/crm/opportunities/:id/status` e `/stage` | Alterar situação ou coluna |
| `/crm/opportunities/:id/archive` e `/restore` | Arquivar/restaurar card preservando status |
| `/crm/pipelines` | Consultar funis e colunas |
| `/crm/capture-options` | Consultar valores distintos de origem/UTMs visíveis |

Métodos, corpos e parâmetros estão publicados em `/docs` e `/docs-json`.

Listagens usam `limit` (padrão 20, máximo 100) e `offset`. Filtros incluem pesquisa, responsável da negociação, funil, etapa, status, serviço, origem, UTMs, campos não informados e período. `from`/`to` são datas no fuso da empresa; `periodBy` aceita `ENTRY_RECEIVED` ou `CONTACT_CREATED`. `includeArchived=true` inclui registros arquivados dentro do mesmo escopo autorizado.

Filtros comerciais e de campanha correspondem à mesma negociação e entrada de origem. Um contato não aparece em Ganho + campanha B por possuir um ganho da campanha A e outro interesse na B.

## Regras operacionais

- Status comerciais: NEW, CONTACTING, QUALIFIED, DISQUALIFIED, LOST e WON, independentes por card.
- Coluna e status são independentes; mover card não deduz status pelo nome da coluna.
- Mudar para WON não cria Cliente, venda, recebimento ou nota fiscal.
- Notas específicas e entradas respeitam a visibilidade da negociação.
- Arquivar contato exige tratar ou arquivar todas as negociações abertas; os cards encerrados restantes são arquivados na mesma transação.
- Restaurar contato não restaura os cards automaticamente.
- Não há exclusão física nem edição de captações/histórico pelas rotas.
- Redis e serviços externos não participam da transação de captação.

## Banco e verificação

Migration `packages/database/drizzle/0016_crm_leads.sql`, com seis tabelas, FKs compostas por empresa, índices de consulta e unicidade de comandos/eventos.

Verificações:

```text
corepack pnpm --filter @gestaonf/api test
corepack pnpm --filter @gestaonf/api typecheck
corepack pnpm --filter @gestaonf/database typecheck
corepack pnpm --filter @gestaonf/database db:check
```

`tests/crm-leads.test.ts` cria um PostgreSQL isolado e aplica as migrations existentes. Use `CRM_TEST_DATABASE_URL` ou `DATABASE_URL` com permissão para criar esse banco de teste. Os testes não enviam WhatsApp nem chamam OpenAI.

A tela do banco de leads, a agenda e as propostas comerciais estão implementadas. Consulte [MEETINGS-IMPLEMENTATION.md](./MEETINGS-IMPLEMENTATION.md) para a agenda e [PROPOSALS-IMPLEMENTATION.md](./PROPOSALS-IMPLEMENTATION.md) para propostas, cadastro automático de cliente, documentos e conversão em pedido. Gestão completa de funis, formulários públicos, importações, anúncios e ferramentas CRM do Nero são etapas posteriores. O ponto interno de captação prepara a composição com adaptadores autenticados; não constitui um endpoint público de recebimento desses canais.
