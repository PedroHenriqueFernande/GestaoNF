# ADR: foto da empresa em tabela própria, com variantes e renovação pela duração

## Status

Aceita em 16/11/2026 e implementada. Especificação completa no Obsidian: **GestãoNF - Foto da Empresa - Spec** (`Ferramentas de desenvolvimento/Specs e Planos/`).

## Contexto

A empresa passou a ter foto, exibida no header (seletor de empresa) e na lista de `/empresa`. Já existia um ciclo de vida de imagem validado para o avatar (`user_avatar_files`, ver [meu-perfil.md](meu-perfil.md)) e outro para anexos de venda (`stored_files`), ambos no bucket R2 privado, com envio direto do navegador por PUT assinado e finalização no servidor.

## Decisão

- **Tabela própria:** `company_logo_files` mais a coluna `companies.logo_id`, com FK composta `companies(id, logo_id) → company_logo_files(company_id, id)`. O banco impede que uma empresa aponte para a foto de outra. Um índice único parcial garante no máximo uma foto `ACTIVE` por empresa, e um CHECK impede linha `READY`/`ACTIVE` incompleta.
- **Ciclo de vida duplicado conscientemente:** os estados e o SQL ficam em `CompanyLogoService`. Com o avatar, só são compartilhados a normalização (`backend/src/files/image-normalize.ts`) e o envio por PUT no frontend. Generalizar agora, na 2ª ocorrência, seria prematuro.
- **Duas variantes num registro (D03):** principal WebP até 1080 (`inside`, sem ampliar, até 2 MiB) e miniatura WebP 128 × 128 (`cover`, recorte central, até 128 KiB). A entrada mínima é de 128 px.
- **Sem leitura da principal (D07):** só a miniatura é servida, por `GET /companies/logos/access`, com links em lote válidos por 120 s. O temporário enviado nunca é servido. A chave da principal fica registrada, então expô-la depois é aditivo e não exige migração.
- **412 vira conteúdo inválido (D12):** `R2StorageService.read` traduz o 412 do GET com `IfMatch` (temporário regravado entre o HEAD e a leitura) em `InvalidStoredContent`: 400 e `REJECTED`. Vale também para o **avatar** e os **anexos de venda**, que antes respondiam 503 nesse caso.
- **Renovação pela duração (D13):** cada item de `logos/access` traz `expiresInSeconds`. O cliente agenda a renovação no próprio relógio, a partir do recebimento, e nunca compara `expiresAt` com `Date.now()`. Depois de uma falha, espera 60 s.

## Alternativas e trade-offs

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Generalizar `user_avatar_files` (dono polimórfico) | Um só ciclo de vida | Enfraquece a FK e mexe numa funcionalidade validada | Rejeitada |
| Reutilizar `stored_files` | Menos tabelas | Semântica de anexo de venda (quota, download) | Rejeitada |
| Só a variante principal | Menos objetos | 1080 baixado a cada renovação, multiplicado pelo número de empresas | Rejeitada |
| Expor a principal já | Pronto para uso futuro | Contrato e superfície de ataque sem consumidor | Adiada |
| Comparar `expiresAt` com o relógio do cliente | Sem campo novo | Relógio adiantado gerava renovação a cada segundo | Substituída por D13 |

## Regras de operação

- **Não** aplicar expiração automática ao prefixo `company-logos/`, onde ficam as fotos definitivas.
- **Manter** a regra de expiração de 1 dia no prefixo `uploads/` (ver [backend/src/files/README.md](../../backend/src/files/README.md)). Os temporários da foto ficam em `uploads/company-logos/`.
- O CORS do bucket de produção precisa liberar `PUT` da origem do frontend com os cabeçalhos assinados (`Content-Type`, `Content-Length`, `Cache-Control`). Modelo em `infra/r2/cors.production.example.json`.
- **O worker é obrigatório.** Sem ele, não há limpeza de temporários, de fotos substituídas e de reservas abandonadas. Depois de 3 pendências por empresa, a reserva passa a responder **429**.
- **Ordem de deploy:** migration `0040`, depois a API e o worker, por último o frontend.

## Riscos

- **Bucket compartilhado entre ambientes:** hoje, o mesmo bucket `gestaonf` atende desenvolvimento e produção. Uma limpeza, regra de ciclo de vida ou teste em desenvolvimento pode apagar ou sobrescrever objetos de produção, e as credenciais de desenvolvimento dão acesso a dados reais. **Recomendação:** separar os buckets por ambiente, cada um com credenciais e CORS próprios, antes de ampliar o uso em produção.
- Um link já emitido continua válido por até 120 s depois de remover a foto ou fazer logout. É um limite aceito, igual ao do avatar.

## Consequências

A integridade fica garantida no banco, e o avatar não corre risco, ao custo de cerca de 120 linhas de ciclo de vida duplicadas. Um 3º tipo de imagem é o gatilho para unificar, o que exigirá migração. A limpeza depende do worker, e a segurança dos envios depende do CORS e da regra de `uploads/` no bucket.
