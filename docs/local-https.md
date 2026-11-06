# HTTPS local

Na raiz do projeto, execute uma vez:

```powershell
npm run https:setup
```

O comando cria uma autoridade de desenvolvimento do usuário e um certificado de servidor para `localhost`, `127.0.0.1` e `::1`. No Windows, instala a autoridade no repositório de confiança do usuário atual, sem exigir alteração da máquina inteira. Também configura os endereços locais HTTPS no `.env`. Se o navegador estava aberto durante a instalação, reinicie-o para recarregar a confiança.

Inicie o projeto em dois terminais:

```powershell
npm run api:dev
npm run web:dev
```

Frontend: **https://localhost:5173**. API/Swagger: **https://localhost:3000/docs**. Use o mesmo hostname nos dois acessos; o frontend deriva automaticamente o endereço da API. Os cookies de login passam a ter `Secure` em HTTPS.

Com Docker:

```powershell
docker compose up -d --build api worker web
```

API e frontend montam `.certs` em modo somente leitura; o healthcheck da API verifica a cadeia de confiança. A pasta é ignorada pelo Git e pelo contexto de build Docker. A chave da autoridade fica no perfil local do usuário, fora do projeto. Esses certificados pertencem ao servidor de desenvolvimento e são independentes do certificado A1 cadastrado para emissão fiscal.

Em outro computador, rode novamente `https:setup`; não distribua as chaves privadas. Para clientes Node que precisem confiar no servidor local, configure `NODE_EXTRA_CA_CERTS` com o caminho absoluto de `.certs/root-ca.pem` antes de iniciar o processo. Em sistemas diferentes do Windows, importe esse certificado público no repositório de confiança do navegador/sistema.

Ao usar Cloudflare Tunnel, a origem local passa a ser `https://localhost:3000`; configure o túnel para confiar em `.certs/root-ca.pem`. Origens CORS do bucket R2 precisam incluir `https://localhost:5173` e `https://127.0.0.1:5173` para uploads diretos do navegador.

Para adicionar as origens automaticamente, se a credencial tiver permissão de configuração do bucket:

```powershell
npm exec -w backend -- tsx scripts/update-r2-local-cors.ts --apply
```

Se retornar `AccessDenied`, acrescente esta regra ao array CORS existente no painel R2, preservando as outras regras:

```json
{
  "AllowedOrigins": ["https://localhost:5173", "https://127.0.0.1:5173"],
  "AllowedMethods": ["GET", "HEAD", "PUT"],
  "AllowedHeaders": ["content-type", "cache-control"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 3600
}
```

Para implantação com TLS terminado em proxy, `LOCAL_HTTPS_ENABLED=false` permite que o proxy faça a terminação HTTPS, mantendo `API_ORIGIN` e `WEB_ORIGIN` com os endereços públicos corretos. A verificação de certificados dos clientes permanece habilitada.
