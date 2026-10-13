# Uploads privados — configuração Cloudflare R2

O fluxo já é reutilizável, e o primeiro ponto integrado é o editor de venda: input de arquivo ao lado de **Total da venda**, sem modal, lista de anexos com download e remoção ao salvar. PNG/JPEG até 10 MiB; PDF até 25 MiB; até 10 arquivos por venda. PDFs preservam os bytes originais. Sem credenciais, o envio fica desabilitado e o restante do sistema inicia normalmente.

## 1. Criar bucket

No painel Cloudflare, abrir **Storage & databases → R2 → Create bucket**. Sugestão: `gestaonf-private-dev` para desenvolvimento e outro bucket para produção. Usar classe **Standard**. Deixar **Public Development URL (r2.dev) desabilitada** e não conectar domínio público ao bucket. Domínio próprio não é necessário para usar a API S3 privada.

## 2. Gerar credenciais de objetos

Em **R2 → Overview → API Tokens → Manage**, criar **Account API token** (ou User API token, conforme sua conta). Selecionar **Object Read & Write**, aplicar **somente ao bucket escolhido**. Copiar:

- Account ID da Cloudflare.
- Nome exato do bucket.
- **Access Key ID** gerado para R2.
- **Secret Access Key** gerado para R2, exibido na criação.
- Endpoint S3 exibido no painel: normalmente `https://ACCOUNT_ID.r2.cloudflarestorage.com`; buckets EU/FedRAMP usam o endpoint correspondente à jurisdição.

O backend usa Access Key ID + Secret Access Key. Não é necessário enviar Global API Key ou o token genérico de gerenciamento Cloudflare. O token é criado uma vez para o GestãoNF; o usuário que anexa contrato não precisa ter conta Cloudflare.

## 3. `.env` da raiz

```dotenv
R2_ENABLED=true
R2_ACCOUNT_ID=SEU_ACCOUNT_ID
R2_BUCKET=gestaonf-private-dev
R2_ACCESS_KEY_ID=SUA_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY=SUA_SECRET_ACCESS_KEY
R2_ENDPOINT=https://SEU_ACCOUNT_ID.r2.cloudflarestorage.com
R2_COMPANY_QUOTA_BYTES=1073741824
```

`R2_ENDPOINT` pode ficar vazio quando for o endpoint padrão. API e worker recebem as credenciais pelo Compose. Frontend recebe apenas URLs temporárias; nenhuma chave `VITE_R2_*` deve ser criada.

## 4. CORS do bucket

Em **bucket → Settings → CORS Policy**, colar o JSON de [cors.local.json](../../../../infra/r2/cors.local.json). Ele permite `http://localhost:5173` e `http://127.0.0.1:5173` para os testes locais. Em produção, copiar [cors.production.example.json](../../../../infra/r2/cors.production.example.json), substituir a origem pelo domínio real do frontend e aplicar ao bucket de produção. Não incluir barra final nem caminho na origem.

Essa é a configuração S3 usada pelo painel. O formato do arquivo de `wrangler r2 bucket cors set` é diferente (`rules/allowed`); não passar este JSON diretamente a esse comando. CORS não torna o bucket público: PUT e GET continuam exigindo assinatura.

## 5. Limpeza complementar no R2

Em **bucket → Settings → Object lifecycle rules**, adicionar uma regra com prefixo **`uploads/`** e exclusão após **1 dia**. Não aplicar expiração global nem ao prefixo `files/`, onde estão os contratos vinculados às vendas. A aplicação faz sua própria limpeza; essa regra remove temporários restantes se a infraestrutura ficar desligada.

## 6. Teste e atualização dos contêineres

Após preencher as credenciais, rodar da raiz:

```powershell
corepack pnpm --filter @gestaonf/api r2:check
docker compose up -d --build api worker web
```

O teste grava um objeto temporário em `checks/`, lê, testa GET assinado e remove; não publica o bucket nem exibe credenciais/URLs. A inicialização da API aplica a migration automaticamente. Abrir `/portal-de-servicos`, criar ou editar uma venda, selecionar PNG/JPEG/PDF, esperar a validação e salvar. Ao reabrir, o anexo deve continuar associado. Baixar deve devolver o arquivo original para PDF. Remover um anexo e salvar agenda a exclusão física.

Se o PUT falhar no navegador, conferir CORS e se os headers assinados enviados são os retornados pela API. Se as credenciais/endpoint falharem, a API retorna 503 sem expor o erro bruto R2. Se um upload expirar ou for rejeitado, selecionar o arquivo novamente. Exclusões precisam do worker ativo.

## Contratos HTTP

Todos exigem sessão/Bearer e `X-Company-Id`. POST por sessão exige Origin permitido. URLs retornadas têm `Cache-Control: no-store`.

| Método e rota | Comportamento |
| --- | --- |
| `GET /files/capabilities` | Disponibilidade, tipos, limites |
| `POST /files/uploads` | Corpo `{fileName,mimeType,sizeBytes}` e `Idempotency-Key`; retorna arquivo e PUT assinado |
| `POST /files/:id/complete` | Verifica e aceita o arquivo; idempotente para READY |
| `GET /files` | Arquivos READY autorizados; `kind`, `search`, `limit`, `offset` |
| `GET /files/:id` | Metadados autorizados sem chaves internas |
| `GET /files/:id/access?disposition=attachment` | GET assinado por 120 segundos; PDF sempre attachment |
| `DELETE /files/:id` | Cancela/remove arquivo não vinculado; não aceita apagar anexo da venda por fora do editor |

Criação/edição da venda aceita `attachmentIds`. Ausente preserva; `[]` remove todos. `GET /sales/:id` inclui `attachments`. Rascunho/confirmada preservam códigos e financeiro existentes; cancelamento preserva anexos. Upload sem venda expira em 24 horas.

Arquitetura e decisões: [ARCHITECTURE.md](./ARCHITECTURE.md). Referência de credenciais: [Cloudflare R2 S3](https://developers.cloudflare.com/r2/get-started/s3/).

## Verificação da entrega

TypeScript da API/banco e build web passaram; migration passou em `db:check`. A suíte da API passou com 98 testes, sendo 21 novos para arquivos/assinaturas. Os testes usam PostgreSQL isolado e substituem o acesso R2; a geração de assinatura usa o SDK real sem chamadas externas. A suíte de navegador selecionada passou com 6 testes (2 de anexos): seletor nativo sem modal, PUT sem cookies/credenciais do GestãoNF, gravação/reabertura, download, bloqueio de formato inválido, estado desabilitado e layout móvel.

Banco real local recebeu a migration pela inicialização do Docker. API, worker e web foram reconstruídos. A conexão com um bucket Cloudflare real permanece pendente de credenciais; executar `r2:check` e o upload pelo navegador após a ativação para validar também permissões, endpoint e CORS reais.
