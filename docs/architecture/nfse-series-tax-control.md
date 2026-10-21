# Fiscal: séries da DPS e controle de tributação — arquitetura de banco e API

Status em 21/10/2026: configurações de séries, numeração e regras tributárias implementadas no banco, API e frontend, com sugestão fiscal vinculada à venda. A regra padrão é escolhida por serviço e vigência; a venda também permite escolher outra regra ativa ou nenhuma. O histórico de avanço manual do contador pode ser consultado na tela de séries. A emissão da NFS-e, certificado, consulta municipal em tempo de emissão e reserva de número de DPS ainda não foram implementados. A proposta original abaixo continua como referência para a etapa de emissão; alguns campos e rotas ali descritos pertencem à etapa futura.

## 1. Escopo e vocabulário

Na seção **Fiscal** da sidebar, planejar **Séries e numeração** e **Controle de tributação**. O segundo nome significa guardar sugestões de impostos para preencher uma emissão, como o usuário descreveu ao comparar com o sistema que usa no trabalho. As sugestões não determinam sozinhas a tributação correta de toda venda. Certificados digitais e emissão de NFS-e serão etapas próprias da seção Fiscal.

**DPS** é a declaração que o GestãoNF preparará e transmitirá. Ela leva uma **série** e um **número da DPS**; o emissor atribui depois o **número da NFS-e**. A DPS deve ter numeração crescente. No Anexo VI da NT 009 v1.01, a série numérica de aplicativo próprio ocupa a faixa **00001–49999**, e o número da DPS vai de **1 a 999999999999999**. As faixas de emissor web, móvel e transcrição pertencem a outros fluxos. O identificador de consulta usa município emissor, inscrição federal, série e número da DPS. Esses limites e a formação exata do identificador devem ser revalidados no contrato ativo do ambiente antes da primeira transmissão, inclusive por causa da evolução do CNPJ alfanumérico.

O cadastro atual já tem dados básicos da empresa, do cliente e do serviço, inclusive classificação do serviço, série e sugestões tributárias. Ainda não há certificado nem documento fiscal emitido. A venda comercial em `sales` e a proposta em `crm_proposals` não são documentos fiscais.

## 2. Decisões de produto

| Decisão | Consequência |
| --- | --- |
| Uma empresa pode cadastrar série própria por ambiente e município emissor | Homologação e produção não compartilham contador; vários municípios ou séries continuam possíveis |
| A faixa inicial nacional é de aplicativo próprio | Não oferecer a faixa reservada ao portal web/móvel como se fosse uma série do GestãoNF |
| Quem contratou ou administra a empresa configura séries e perfis | Colaboradores podem usar configurações na emissão futura, sujeitos às permissões daquela funcionalidade |
| Número da DPS é reservado pelo backend somente no preparo da emissão | Abrir formulário ou criar venda não consome número |
| Número reservado não volta ao contador, inclusive se a tentativa falhar | Evita duplicidade depois de timeout e deixa uma trilha auditável; lacunas são visíveis |
| Controle de tributação guarda **valores sugeridos com vigência** | Ao emitir, conferir município, serviço, regime, competência, tomador, retenções e regras oficiais |
| Nenhum percentual de IBS/CBS é fixado como padrão da empresa agora | As regras e valores dependem da versão e do cálculo aplicável; o perfil inicial foca os tributos que o operador precisa informar ou revisar |

## 3. Banco de dados

### 3.1. `nfse_series`

Uma linha representa um contador do **emissor nacional**, de uma identidade fiscal, município, ambiente e série. Colunas:

| Campo | Tipo/uso |
| --- | --- |
| `id`, `company_id` | UUID; FK para `companies` |
| `provider` | `NATIONAL` nesta etapa; não misturar com RPS de prefeitura |
| `environment` | `HOMOLOGATION` ou `PRODUCTION` |
| `issuer_tax_id_snapshot`, `issuer_kind_snapshot` | CPF/CNPJ normalizado e PF/PJ no momento da ativação; imutáveis após a primeira reserva |
| `municipality_ibge_code` | Sete dígitos do município emissor |
| `series_number` | Inteiro entre 1 e 49999 para aplicativo próprio; apresentado com cinco posições quando formar a identidade |
| `initial_number`, `next_number` | `BIGINT`; número de DPS válido de 1 a 999999999999999; `next_number = 1000000000000000` indica série esgotada. API os expõe como **string decimal** para não perder precisão no JavaScript |
| `status`, `is_default`, `version` | `ACTIVE/INACTIVE`, escolha padrão e controle otimista de edição |
| `created_by_user_id`, `updated_by_user_id`, `created_at`, `updated_at` | Auditoria básica |

Índices/invariantes: unicidade global de `(provider, environment, issuer_tax_id_snapshot, municipality_ibge_code, series_number)`, mesmo que duas empresas do GestãoNF tenham o mesmo CPF/CNPJ; índice por `(company_id, environment, status)`; no máximo uma série padrão ativa por empresa/ambiente/município/identidade. Para série nacional, exigir empresa brasileira com CPF/CNPJ e município válidos **ao ativar**. Mudança de CPF/CNPJ ou município da empresa não reescreve uma série usada: a configuração anterior fica bloqueada para novas emissões e uma nova série deve ser cadastrada. No cadastro, checar faixa por **provedor e versão de leiaute**, sem transformar a faixa 00001–49999 em regra de qualquer provedor futuro.

Na primeira ativação o gestor informa o **próximo número**. O sistema não consegue descobrir com certeza a sequência usada em outro software por uma lista de DPS: a API oficial documenta consulta de uma DPS por identificador. Antes de ativar, avisar que a série deve ser exclusiva do GestãoNF para aquele emissor/município/ambiente e que o próximo número precisa considerar as DPS já criadas fora daqui. A homologação pode começar em 1 para série própria; produção requer confirmação explícita do número inicial. Após uso, só permitir avanço do `next_number`; nunca diminuir ou trocar a série na mesma linha. Cada avanço administrativo cria uma linha em `nfse_series_adjustments` com `company_id`, `series_id`, valor anterior, valor novo, motivo, usuário e data. Reservas normais ficam rastreadas em `nfse_dps`.

### 3.2. `nfse_dps` — livro mínimo de números reservados

Esta tabela é o registro durável que torna o contador verificável, mesmo antes de existir um emissor completo. Colunas: `id`, `company_id`, `series_id`, `provider`, `environment`, `issuer_tax_id_snapshot`, `municipality_ibge_code`, `series_number`, `dps_number BIGINT`, `source_sale_id NULL`, `status`, `request_key UUID`, `request_hash`, `created_by_user_id`, `reserved_at`, `updated_at`, `authorized_at NULL`, `nfse_access_key NULL`, `provider_nfse_number NULL`. Estados iniciais: `RESERVED`, `READY`, `SENDING`, `UNKNOWN`, `REJECTED`, `AUTHORIZED`; cancelamento da nota é evento posterior, sem apagar a DPS.

Unicidade **global** em `(provider, environment, issuer_tax_id_snapshot, municipality_ibge_code, series_number, dps_number)` e unicidade `(company_id, request_key)`. FK composta `(company_id, series_id)` evita série de outra empresa. `source_sale_id` é referência comercial opcional; a futura emissão pode juntar ou separar serviços de uma venda segundo as regras oficiais. O número autorizado e a chave retornada pelo emissor são armazenados separados do número da DPS. A linha da DPS e seus snapshots fiscais não são apagados para liberar número.

`nfse_dps_attempts` guarda tentativas de transmissão: DPS, tentativa, hash do XML, data, resultado/código público, `provider_request_id` quando houver e referência privada ao XML de envio e resposta. Nada de certificado, senha ou XML completo em logs. Na fase inicial de cadastro da série, a tabela pode ser criada junto ao serviço de emissão, mas a operação interna de reserva só entra em produção acompanhada do livro `nfse_dps`.

### 3.3. `nfse_tax_profiles` e `nfse_tax_profile_revisions`

Um **perfil fiscal** é um conjunto reutilizável de sugestões, com um nome que o usuário entende (por exemplo, “Consultoria em Brasília”). `nfse_tax_profiles`: `id`, `company_id`, `name`, `scope` (`COMPANY`, `SERVICE`, `SERVICE_MUNICIPALITY`), `service_id NULL`, `municipality_ibge_code NULL`, `is_default`, `disabled_from NULL`, `created_by_user_id`, timestamps. Relações compostas com `company_id` garantem que serviço e perfil pertençam à mesma empresa. Podem existir vários perfis para o mesmo serviço, pois operações diferentes poderão exigir escolhas distintas. Há no máximo **um padrão ativo por escopo**; a unicidade de padrão precisa tratar `NULL` como valor de escopo (índices parciais por tipo ou `NULLS NOT DISTINCT` no PostgreSQL 17).

`nfse_tax_profile_revisions`: `id`, `company_id`, `profile_id`, `revision`, `effective_from DATE`, `iss_rate_percent DECIMAL(7,4) NULL`, `pis_rate_percent`, `cofins_rate_percent`, `csll_rate_percent`, `ir_rate_percent`, `inss_rate_percent` (mesmo tipo e opcionais), `iss_withholding_suggestion NULL`, `notes NULL`, `created_by_user_id`, `created_at`. Uma revisão aprovada é **imutável**; alterar um percentual cria nova revisão com data de início. `UNIQUE(profile_id, revision)` e `UNIQUE(profile_id, effective_from)`. A revisão válida é a última com `effective_from <= competência`, desde que o perfil seja aplicável naquele período. Percentuais são armazenados como decimais, e não `float`; cálculo monetário usa centavos inteiros e arredondamento definido pelo leiaute aplicável.

ISS sugerido de 0% a 5% na validação inicial, porque o leiaute nacional rejeita valor acima de 5%; outros percentuais exigem validação técnica própria antes de serem expostos. Campo vazio significa “não sugerir”, não “alíquota zero”. A sugestão de retenção é uma **indicação para revisão**, nunca uma regra irrevogável atribuída ao cliente. Deduções, benefícios, isenções, local de incidência, CST e classificação IBS/CBS não recebem valores automáticos neste perfil inicial.

Ao preparar uma emissão: buscar perfil **padrão** exato serviço+município, depois serviço, depois empresa; escolher a revisão vigente na competência. Se não houver padrão, retornar campos em branco e pendências. O usuário pode escolher manualmente outro perfil compatível, com registro dessa escolha. Guardar na DPS `tax_profile_revision_id` e `tax_snapshot JSONB` com os valores efetivamente confirmados; alterações posteriores no perfil não alteram a nota. Uma revisão retroativa após emissão exige aviso explícito de que não altera notas já preparadas. Verificar os parâmetros municipais oficiais e o leiaute do ambiente antes de preencher XML: a API oficial informa alíquotas, regimes especiais, retenções e benefícios; em vários cenários o campo `pAliq` deve ser **omitido** porque o próprio sistema nacional fornece a alíquota, enquanto em outros deve ser informado. Portanto, “salvo como sugestão” nunca significa “enviar sempre”.

## 4. Backend e contratos HTTP

Criar módulo NestJS `apps/api/src/fiscal/` (`FiscalModule`) com controller, schemas Zod, serviços de séries e perfis, repositório de transação, e integrar ao `AppModule`. Todas as rotas exigem `AccessGuard`, `CompanyGuard` e `X-Company-Id`. Buscar/mutar sempre por `company_id` autenticado. Alterações: somente `OWNER` e `ADMIN`; leitura: membro ativo. Um futuro papel fiscal pode ser concedido pela camada de permissões quando ela existir. Reutilizar as regras de suspensão da empresa/assinatura já presentes em `CompanyGuard`.

| Rota | Efeito |
| --- | --- |
| `GET /fiscal/series?environment=...` | Listar séries e próximo número, sem segredos |
| `POST /fiscal/series` | Criar série, ambiente, município e número inicial |
| `PATCH /fiscal/series/:id` | Mudar padrão/status; avançar próximo número só em comando próprio |
| `POST /fiscal/series/:id/advance` | Avançar contador com `expectedVersion`, novo valor e justificativa, mantendo trilha de auditoria |
| `GET /fiscal/tax-profiles` e `GET /fiscal/tax-profiles/:id` | Listar perfis e revisões |
| `POST /fiscal/tax-profiles` | Criar escopo e primeira revisão |
| `POST /fiscal/tax-profiles/:id/revisions` | Criar nova revisão vigente a partir da data informada; requer `expectedVersion` |
| `PATCH /fiscal/tax-profiles/:id` | Renomear/desativar, sem editar revisões usadas |
| `POST /fiscal/tax-profiles/preview` | Mostrar qual perfil seria sugerido para serviço, município e competência, com origem e pendências; não reservar número |

`POST /fiscal/series/:id/reserve` **não** deve ser público. O futuro `EmissionService.prepare` fará, numa única transação: validar dados locais, selecionar série ativa, bloquear a linha `nfse_series FOR UPDATE`, conferir chave idempotente e hash, criar `nfse_dps`, incrementar `next_number`, gravar snapshot, confirmar. Duas requisições simultâneas recebem números diferentes; repetir a mesma chave devolve a mesma DPS; mesma chave com outro corpo retorna HTTP 409. Se a operação externa expirar sem resposta, marcar `UNKNOWN`, consultar **o mesmo identificador** pela API DPS e impedir reutilização; transmissão posterior usa a mesma DPS e número após reconciliação. Não abrir transação de banco durante chamada ao governo.

Validação Zod: UUIDs e datas, códigos de município, taxa decimal em string, faixa da série conforme provedor, número inicial de até 15 dígitos, nome não vazio. O estado esgotado do contador é calculado pelo backend e não informado pelo usuário. API de leitura devolve taxa e número como strings decimais. Erros previsíveis: 400 formato, 403 sem autorização, 404 recurso fora da empresa, 409 colisão/versão/duplicidade, 422 configuração incompatível com a emissão, 503 indisponibilidade do provedor na etapa posterior. Alterações administrativas registram autor, antes/depois sem segredos, data e justificativa quando contador muda.

## 5. Ordem de entrega e testes

1. Migração aditiva e `FiscalModule` com CRUD de séries, perfis e revisões; sem alterar vendas ou cadastros existentes.
2. Sidebar Fiscal com “Séries e numeração” e “Controle de tributação” quando houver frontend dessa etapa. A tela mostra claramente homologação/produção e informa que perfil é uma sugestão.
3. Certificado digital da empresa, seleção do ambiente/provedor e validação de habilitação.
4. Preparo da DPS, reserva idempotente, snapshots e validação fiscal por contexto.
5. Assinatura, transmissão em produção restrita, consulta de resultado, auditoria e só depois habilitação de produção.

Testes essenciais: isolamento entre empresas; colaborador sem mutação; identidade duplicada em empresas distintas; sequência concorrente e idempotência; avançar contador sem retrocesso; série fora da faixa; números de 15 dígitos sem perda de precisão; perfil vigente por competência e prioridade de escopo; revisão antiga preservada em DPS; ausência de sugestão ou alíquota municipal fornecida pela API não vira `pAliq` enviado; timeout de transmissão mantém número em `UNKNOWN` e consulta pelo mesmo identificador.

## 6. Alternativas e limites

| Alternativa | Motivo da escolha |
| --- | --- |
| Contador em memória ou `MAX(número)+1` | Pode gerar colisão com requisições simultâneas ou reinício; usar linha bloqueada no PostgreSQL e livro durável |
| Consumir número ao abrir o formulário | Gera lacunas desnecessárias; reservar somente quando a DPS estiver pronta para envio |
| Reaproveitar número rejeitado/timeout | Resposta tardia do emissor poderia autorizar uma DPS com a mesma identidade; reenvio e reconciliação conservam o número original |
| Uma alíquota fixa no serviço/empresa | Município, data, regime, retenção e serviço podem mudar a regra; usar perfis com escopo e vigência, revisar na emissão |
| Gravar apenas o perfil atual na nota | Mudanças futuras alterariam a interpretação do passado; manter revisão escolhida e snapshot confirmado |

Essa arquitetura não promete emissão automática ao concluir os dois cadastros: certificado, compatibilidade do município, regras da operação, assinatura e transmissor continuam necessários.

## 7. Fontes oficiais

- [Manual de Contribuintes da API do Emissor Público Nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf): parâmetros municipais, POST de DPS, consulta por identificador e certificado.
- [Anexo VI da NT 009 v1.01](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexovi-leiautesrn_rtc_ibscbs-v1-04-01-nt009.xlsx): série, número e regras de ISS/tributos no leiaute atualizado.
- [Portal oficial: o que é DPS](https://www.gov.br/nfse/pt-br/saiba-mais/como-a-nfs-e-e-gerada/o-que-e-dps): numeração crescente e relação entre DPS e NFS-e.
- [Documentação de produção atual](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/documentacao-atual) e [documentação RTC](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc): versões dos contratos que o futuro emissor precisa selecionar por ambiente.
