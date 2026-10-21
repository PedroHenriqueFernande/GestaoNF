# NFS-e: empresa, serviço e cliente — análise e arquitetura dos pré-cadastros

Status: pré-cadastros implementados em 13/10/2026, com base no código existente e na documentação oficial consultada nessa data. As etapas de emissão continuam planejadas.

## 1. Contrato e limites desta entrega

Preparar os três cadastros existentes para fornecer dados à futura emissão de NFS-e, começando pelo emissor nacional em produção restrita. Dados fiscais continuam opcionais para cadastrar, editar, vender serviços, criar leads e elaborar propostas.

Há duas validações distintas:

- **Ao salvar um cadastro:** validar formato, tamanho e coerência dos dados efetivamente informados. Ausência de informação fiscal não impede salvar. Campo ausente em PATCH preserva o valor; `null` remove; o frontend converte texto vazio em `null`.
- **Ao preparar uma emissão:** verificar a completude e a aplicabilidade ao prestador, competência, operação, município, ambiente e versão do leiaute. Uma pendência necessária bloqueia a emissão e aponta o cadastro/campo a corrigir.

Certificado, série/numeração da DPS, escolha do provedor, transmissão, modelos de operação e cálculo tributário serão funcionalidades posteriores. Não são novas colunas de cliente ou serviço nesta entrega. A extensão dos cadastros não significa que a empresa já esteja habilitada a emitir.

O primeiro conector considera um prestador estabelecido no Brasil, PF ou PJ. Os dados de tomadores do exterior estão mapeados abaixo, mas sua emissão dependerá também do futuro fluxo de comércio exterior. Prestador estrangeiro emitindo por intermédio de tomador/importador exige um fluxo próprio.

## 2. Base técnica e versões

As fontes têm papéis diferentes:

| Referência | Uso nesta análise |
| --- | --- |
| [Documentação atual de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) | Contratos em vigor e documentos do emissor nacional |
| [Documentação de produção restrita](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/producao-restrita) | Esquemas efetivamente disponíveis para testes |
| [NT 009 v1.01](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nota-tecnica-009-se-cgnfs-e-v-1-01.pdf) | Mudanças e condições dos novos campos |
| [Anexo VI v1.04.01 da NT 009](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/anexovi-leiautesrn_rtc_ibscbs-v1-04-01-nt009.xlsx) | Leiaute e regras usados para identificar as lacunas |
| [Anexo I de produção v1.01, 09/02/2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/anexo_i-sefin_adn-dps_nfse-snnfse-v1-01-20260209.xlsx) | Comparação com o contrato anterior |
| [Manual de contribuintes/API](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf) | Responsabilidades da Sefin, parâmetros municipais e autorização |
| [Orientação do Simples Nacional](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026) | Separação entre uso do emissor nacional e efeitos das regras de IBS/CBS |

O catálogo pode guardar dados para o leiaute novo antes de ele ser aceito pelo ambiente. A futura montagem da DPS precisará de um contrato por versão: campo armazenado não significa campo transmitido. Homologação e produção usarão o mesmo conector, com configuração e versão compatíveis com cada ambiente.

Regras marcadas com códigos provisórios, tachadas ou em evolução na publicação não devem ser tratadas como contrato definitivo. A entrada em vigor técnico/legal e a disponibilidade real precisam ser conferidas ao implementar o emissor. Neste documento, obrigatoriedade de um novo campo significa **quando a versão e a regra aplicável o exigirem**, não uma obrigação para todo cadastro hoje.

## 3. Inventário do código existente

| Camada | Arquivos analisados |
| --- | --- |
| Banco | `packages/database/src/schema.ts`: `companies`, `customers`, `services`, `serviceMunicipalTaxCodes`, snapshots de venda/proposta |
| Empresa/API | `apps/api/src/companies/companies.schemas.ts`, `companies.service.ts`, `companies.controller.ts` |
| Serviço/API | `apps/api/src/services/services.schemas.ts`, `services.service.ts`, `services.controller.ts` |
| Cliente/API | `apps/api/src/customers/customers.schemas.ts`, `customers.service.ts`, `tax-id.ts`, `customers.controller.ts` |
| Frontend | `apps/web/src/features/companies/CompanyPage.tsx`, `features/services/ServiceForm.tsx`, `features/customers/CustomerForm.tsx`, `api/client.ts` |
| Fluxos relacionados | `features/crm/QuickServiceModal.tsx`, `ProposalEditor.tsx`, `apps/api/src/crm/proposal.schemas.ts`, `proposals.service.ts`, `apps/api/src/sales/sales.schemas.ts`, `sales.service.ts` |

O sistema já suporta CPF/CNPJ alfanumérico nos schemas, armazenamento e validação de dígitos. Manter essa capacidade, sem converter CNPJ em número. Nenhum dos três módulos realiza transmissão de DPS atualmente.

## 4. Empresa

### 4.1. O que já existe

| Dados | Situação atual | Aproveitamento |
| --- | --- | --- |
| Nome de exibição, tipo PF/PJ, nome legal e fantasia | Banco/API/frontend | Nome de exibição é comercial; nome legal mantém sua função cadastral |
| CPF/CNPJ | Opcional; validação de formato e dígitos | Identidade do prestador |
| E-mail e telefone | Opcionais | Contato; limites do XML serão verificados separadamente |
| CEP, logradouro, número, complemento, bairro, cidade, UF e IBGE | Opcionais | Endereço cadastral e referência de município |
| País ISO2 | Banco/API; interface sempre envia `BR` | Para o prestador brasileiro do primeiro conector, explicitar Brasil na interface |
| Inscrição municipal | Opcional, até 30 caracteres | Já atende o armazenamento; transmissão tem seu próprio limite e condições |
| Inscrição estadual e CNAE | Opcionais | Manter; não transformar em requisito geral para NFS-e nacional |
| Opção pelo Simples | Já admite `1`, `2`, `3`, `4` | `simplesNationalOption` corresponde a `opSimpNac` |
| Apuração de tributos no Simples | Já admite `1`, `2`, `3` | `simplesTaxationRegime` corresponde a `regApTribSN` |
| Regime especial | Já admite `0` a `6` | Precisa contemplar também o domínio novo, conforme versão |

### 4.2. Campos realmente ausentes

Todos os novos campos serão opcionais e sem valor fiscal presumido.

| Campo na interface | Nome proposto no backend | Armazenamento | Aplicação |
| --- | --- | --- | --- |
| Apuração de IBS/CBS no Simples | `simplesIbsCbsRegime` | `simples_ibs_cbs_regime varchar(1) NULL` | Separado do regime de apuração já existente; corresponde a `regApIBSCBSSN`. Domínio `1/2/3`; considerar ME/EPP e opção pendente quando aplicável |
| CAEPF | `caepfCode` | `caepf_code varchar(14) NULL` | Identificação complementar de prestador PF, quando aplicável; validar 14 dígitos, não usar o algoritmo de CNPJ para esse campo |

O regime federal “Lucro Real/Lucro Presumido” pode ser útil comercialmente, mas não é uma lacuna obrigatória do contrato nacional de DPS analisado. `opSimpNac = 1` já representa não optante. Se a gestão precisar distinguir esses regimes, planejar essa informação administrativa sem inventar uma nova tag no XML.

### 4.3. Ajustes nos campos e regras atuais

- Expandir `specialTaxRegime` com `9 — Outros`, no banco, schema, tipo de API e seletor. Só transmitir esse domínio em versão que o aceite.
- A validação `CompaniesService.validateTaxRegime` hoje aceita apuração existente apenas para opção `3`. O leiaute novo veda esse preenchimento para `1/2` e contempla a situação pendente. Ajustar a coerência cadastral para `3/4`, mantendo a condição de transmissão por versão. Não confundir `regApTribSN` com o novo `regApIBSCBSSN`.
- País da empresa: preservar `countryCode` recebido; mostrar o país. O primeiro conector de emissão não deverá declarar suporte a prestador estrangeiro só porque o cadastro contém outro país.
- A inscrição municipal terá validação fiscal de até 15 caracteres quando enviada; o registro comercial pode continuar com 30 para acomodar integrações municipais futuras.
- Não marcar CNAE, inscrição estadual ou toda inscrição municipal como obrigatórios em todas as notas. A inscrição municipal depende inclusive da identificação complementar no CNC; o MEI tem tratamento próprio.
- Não preencher um regime desconhecido com “Nenhum” só para o cadastro parecer completo. `null` é desconhecido; `0` é uma escolha informada.

**Limite importante do mapeamento:** dados de nome/endereço guardados no cadastro não devem ser copiados indiscriminadamente para a DPS. No leiaute analisado, a regra E0121 não permite informar o nome do prestador quando ele é o próprio emitente (`tpEmit = 1`); parte dos dados é resolvida pelo cadastro oficial. A validação deve diferenciar dados necessários para o sistema, dados obtidos oficialmente e campos que devem ser omitidos no XML.

## 5. Serviço

### 5.1. O que já existe

| Dados | Situação atual | Aproveitamento |
| --- | --- | --- |
| Nome, código interno, unidade, preço e descrição | Banco/API/frontend | Informações comerciais; código interno pode alimentar `cIntContrib` |
| Código de tributação nacional | `nationalTaxCode`, opcional, 6 dígitos | `cTribNac`; falta verificar existência/compatibilidade no catálogo oficial na emissão |
| NBS | `nbsCode`, opcional, 9 dígitos | `cNBS`; não exigir universalmente só por estar no cadastro |
| Código municipal por município | Relação `service_municipal_tax_codes`, 3 dígitos, empresa + serviço + município | `cTribMun`, quando necessário; nenhum novo campo equivalente precisa ser criado |
| Indicador de classificação | `fiscalClassificationStatus` | Hoje informa apenas presença de `cTribNac`; não significa validade fiscal nem prontidão para emissão |

### 5.2. Campo ausente e alteração de limite

| Campo/ajuste | Nome proposto | Armazenamento/contrato | Aplicação |
| --- | --- | --- | --- |
| Atividade do Simples Nacional | `simplesActivityCode` | `simples_activity_code varchar(2) NULL` | `cAtvSN`. Seleção no domínio oficial, armazenada como string de dois dígitos; condicionada ao perfil da empresa e versão |
| Descrição com até 2.000 caracteres | Reutilizar `description` | Alterar limite 1.000 → 2.000 | O anexo novo amplia `xDescServ`; o contrato anterior continua limitado a 1.000 na transmissão |

O enquadramento da atividade no Simples não é o CNAE, nem uma substituição do `cTribNac` ou da NBS. A escolha pode depender do enquadramento daquele serviço, incluindo o Fator R; o sistema não deve inventá-la a partir do nome comercial.

### 5.3. Tributação por operação e sugestões no cadastro

CST de IBS/CBS, `cClassTrib`, incidência de ISS, retenções e alíquotas **não existem atualmente**. São necessários conforme o contexto de emissão, mas não são invariantes do catálogo. Nesta etapa, o contrato mínimo adiciona `simplesActivityCode` e amplia a descrição; a definição dos modelos de operação permanece pendente conforme pedido do usuário.

Se posteriormente for escolhido guardar sugestões no serviço, a extensão pequena recomendada é:

| Sugestão futura | Tipo | Regra |
| --- | --- | --- |
| `defaultIbsCbsCst` | `varchar(3) NULL` | Somente sugestão para o preenchimento; código válido e aplicável ao documento |
| `defaultIbsCbsTaxClassCode` | `varchar(6) NULL` | Conferir sua relação com o CST e o domínio oficial |

Essas duas colunas **não fazem parte da primeira migração recomendada**. Também não congelar `cIndOp`, retenção ou alíquota única no serviço: local, destinatário, competência, regime e regras municipais podem alterar o tratamento. Um controle fiscal posterior poderá fornecer sugestões, com confirmação e validação no preparo da nota.

### 5.4. Impacto da descrição e dos snapshots

A ampliação de `services.description` precisa acompanhar os pontos que copiam esse texto:

- `services_description_chk`, schema de serviços e formulário principal;
- `QuickServiceModal` e demais limites de texto de cadastro rápido;
- `proposalItemSchema.description`, `ProposalEditor` e snapshots em `crm_proposal_items`;
- schema dos itens da venda e `sale_items_description_chk`;
- renderização e envio de propostas: identificar limites reais caso algum renderizador imponha limite adicional.

Não ampliar só o formulário e deixar a criação de proposta/venda falhar ao copiar o novo texto. Registros anteriores e seus snapshots permanecem como foram gravados. Se a descrição final agregada ultrapassar o limite fiscal da versão ativa, pedir edição ou divisão da emissão; não truncar automaticamente.

O código nacional/municipal e a NBS devem ser consultáveis por descrição para facilitar a seleção. A forma numérica sozinha não comprova que um código existe. Os dados de correlação do Anexo VIII são orientativos enquanto a própria documentação assim os classificar; não inventar rejeições fiscais baseadas neles.

Quando um `nationalTaxCode` mudar, os códigos municipais associados precisam ser revistos. O sufixo municipal não é uma classificação autônoma que possa ser reutilizada sem verificar o código nacional e o município.

## 6. Cliente

### 6.1. O que já existe

| Dados | Situação atual | Aproveitamento |
| --- | --- | --- |
| PF/PJ, nome/razão social e fantasia | Banco/API/frontend | `name` já representa nome civil/razão social; não criar uma segunda razão social duplicada |
| CPF/CNPJ | Opcional; único por empresa quando informado; valida dígitos e formato alfanumérico | Identidade brasileira quando a operação exigir |
| E-mail e telefone | Opcionais | Contato/envio de documentos, com condições de transmissão próprias |
| Endereço nacional e IBGE | Opcionais | Dados disponíveis para o tomador/destinatário |
| País ISO2 | Banco/API | **Lacuna de interface:** o formulário sempre manda `BR`, mesmo ao editar um registro de outro país |
| Observações internas | `notes` | Não enviar como informação fiscal sem ação explícita |

Para um tomador brasileiro comum, não falta um novo conjunto obrigatório de impostos no cliente. Falta completar os dados já existentes quando a emissão exigir e oferecer informações complementares para casos específicos.

### 6.2. Informações complementares ausentes

| Campo na interface | Nome proposto | Armazenamento | Aplicação |
| --- | --- | --- | --- |
| Inscrição municipal | `municipalRegistration` | `municipal_registration varchar(15) NULL` | `IM` do tomador, se aplicável; não obrigatória para todos |
| CAEPF | `caepfCode` | `caepf_code varchar(14) NULL` | Complemento de identificação de PF quando aplicável |
| Identificação fiscal no exterior | `foreignTaxId` | `foreign_tax_id varchar(40) NULL` | NIF, quando essa identificação for usada |
| Motivo de ausência de NIF | `noForeignTaxIdReason` | `no_foreign_tax_id_reason varchar(1) NULL` | Alternativa ao NIF; cadastro para emissão direta oferece opções `1/2`, não a opção de compartilhamento `0` |
| Código postal no exterior | `foreignPostalCode` | `foreign_postal_code varchar(11) NULL` | Alfanumérico; não reutilizar o CEP brasileiro de oito dígitos |
| Estado/província/região no exterior | `foreignStateProvince` | `foreign_state_province varchar(60) NULL` | Não reutilizar a UF brasileira de duas letras |

Todos são opcionais para salvar. NIF e motivo de ausência de NIF não devem ser preenchidos simultaneamente. CPF/CNPJ e identificação estrangeira podem ser conhecidos pelo cadastro; a futura emissão seleciona uma única alternativa de identificação para o documento, sem deduzir sua escolha apenas da nacionalidade ou do país do endereço.

Reutilizar `countryCode`, `cityName`, `street`, `number`, `complement` e `district` para o endereço no exterior. Mostrar controles nacionais ou internacionais conforme o país do endereço. A cidade estrangeira terá validação de comprimento no contexto fiscal. Não criar outro nome de cliente para resolver limite de XML.

### 6.3. Mudanças na interface e no contrato

- Incluir seletor de país e preservar seu valor no `defaults` e no payload de edição.
- No Brasil, manter CEP/UF/IBGE; no exterior, mostrar código postal e estado/província livres, com cidade e país.
- Uma mudança de país deve explicar quais dados de endereço deixarão de ser utilizados; limpar campos incompatíveis somente como parte de uma alteração explícita, preservando CPF/CNPJ que continue verdadeiro.
- Manter clientes sem documento ou sem endereço no CRM e nas propostas. O emissor pode permitir tomador não identificado em determinadas situações; não transformar CPF de qualquer PF em requisito universal.
- Identificar qual informação está ausente quando a operação requer endereço/identidade. Não apresentar “cliente inválido” como erro genérico.
- Preservar a unicidade atual de CPF/CNPJ por empresa. Não aplicar automaticamente unicidade global de NIF: o domínio estrangeiro precisa considerar o país e a identificação usada.

## 7. Compatibilidade de tamanhos e domínios

Limites comerciais existentes podem ser maiores que os fiscais. Validar a representação fiscal separadamente, sem apagar ou encurtar o cadastro automaticamente.

| Dado | Cadastro atual | Verificação fiscal prevista |
| --- | --- | --- |
| Nome legal/nome do cliente | Até 200 | Até 150 quando enviado em `xNome`; considerar quando o campo deve ser omitido |
| Inscrição municipal da empresa | Até 30 | Até 15 quando transmitida |
| Bairro | Até 120 | Até 60 no grupo de endereço enviado |
| E-mail | Até 254 | Até 80 quando enviado |
| Telefone | Até 32, texto livre em parte dos fluxos | Normalizar quando permitido e verificar formato/tamanho; não remover contato válido do cadastro |
| Cidade no exterior | `cityName` até 150 | Até 60 na representação fiscal |
| Descrição do serviço | Até 1.000 | Até 2.000 no anexo novo; até 1.000 no contrato anterior |

O catálogo de referência deve validar municípios e países, não apenas o formato IBGE/ISO2. Município da prestação, município de emissão, endereço do cliente e município de incidência não são sempre o mesmo local.

## 8. Arquitetura de banco e backend

### 8.1. Banco

Estender as tabelas atuais. Não criar tabelas de operações, clientes fiscais duplicados ou serviços fiscais duplicados nesta fase.

```text
companies
  + simples_ibs_cbs_regime NULL
  + caepf_code NULL
  ~ special_tax_regime: domínio inclui 9

services
  + simples_activity_code NULL
  ~ description: limite cadastral 2000

customers
  + municipal_registration NULL
  + caepf_code NULL
  + foreign_tax_id NULL
  + no_foreign_tax_id_reason NULL
  + foreign_postal_code NULL
  + foreign_state_province NULL

service_municipal_tax_codes
  = reutilizar estrutura existente

sale_items / crm_proposal_items
  ~ compatibilidade de descrição; preservar snapshots gravados
```

CHECKs novos aceitam `NULL`; quando houver valor, validam tamanho, códigos enumerados e campos não vazios. Não adicionar um CHECK de “todos os dados fiscais preenchidos”. Coerência NIF/motivo deve ser garantida no serviço e no banco. Não adicionar índices de relatório para esses campos sem necessidade demonstrada.

A primeira migração será aditiva, com os campos novos vazios. Os valores existentes não podem ser classificados retroativamente como tributáveis, não retidos ou apurados pelo SN por conveniência de migração.

### 8.2. API de cadastro

Reutilizar os endpoints existentes:

| Registro | Endpoints |
| --- | --- |
| Empresa | `POST /companies`, `GET/PATCH /companies/current` |
| Serviço | `POST /services`, `GET/PATCH /services/:id` |
| Código municipal | `GET /services/:id/municipal-tax-codes`, `PUT/DELETE /services/:id/municipal-tax-codes/:municipalityIbgeCode` |
| Cliente | `POST /customers`, `GET/PATCH /customers/:id` |

Estender schemas Zod, tipos do frontend e objetos de entrada/retorno. Criações rápidas continuam válidas com os mínimos atuais. PATCH valida a combinação do registro atual com a mudança para evitar falso conflito por ausência de campos não alterados.

Preservar a autorização atual: empresa modificável por OWNER/ADMIN; clientes/serviços seguem a política vigente. Reutilizar `AccessGuard`, `CompanyGuard` e escopo `X-Company-Id`. Referências a cliente, serviço e empresa devem pertencer à empresa autorizada. Não usar CNPJ, código IBGE ou país como autorização de acesso.

### 8.3. Validação fiscal futura

A futura camada `NfsePreflightService` recebe um **contexto de emissão**, não apenas o ID de um cadastro:

```text
companyId autorizado
customerId / identificação do tomador
itens e valores efetivos da venda
competência
local da prestação e eventual destinatário
tratamento fiscal informado ou sugerido
ambiente + provedor + versão técnica aplicável
```

O serviço lê os cadastros, consulta parâmetros oficiais disponíveis e valida as regras aplicáveis. A falta de consulta externa não permite declarar habilitação confirmada. Um indicador de completude local não equivale à autorização final da Sefin.

Contrato sugerido de pendência, para a implementação futura:

```json
{
  "code": "NFSE_VALIDATION_FAILED",
  "message": "Complete as informações necessárias para esta emissão.",
  "issues": [
    {
      "entity": "SERVICE",
      "entityId": "<id-do-servico>",
      "field": "simplesActivityCode",
      "code": "REQUIRED_FOR_CONTEXT",
      "message": "Informe a atividade do Simples para este serviço."
    }
  ]
}
```

IDs e dados reais devem ser incluídos somente para quem tiver acesso. Erros locais de emissão usam HTTP 422; formatos inválidos de cadastro mantêm o contrato atual HTTP 400. O frontend pode apontar “Editar empresa”, “Editar serviço” ou “Editar cliente” e preservar a emissão em preparo.

Uma nota depende também de certificado, série, numeração e informações operacionais. A validação desses três cadastros nunca deve prometer “Tudo pronto para emitir” enquanto as outras etapas não forem avaliadas.

### 8.4. Valores históricos e dados da venda

O regime e os cadastros armazenados representam os dados conhecidos atualmente. Emitir com competência passada exige confirmar os dados e o enquadramento daquela competência; não usar o regime atual como prova da situação histórica. Uma futura gestão por vigência pode ser acrescentada se esse uso for frequente.

Venda/proposta já preservam snapshots de nome, documento, descrição e códigos. Depois de completar um cadastro, um snapshot fiscal antigo pode continuar vazio. O futuro preparo da emissão precisa resolver isso explicitamente: manter valores comerciais contratados e montar uma cópia fiscal revisada com os dados confirmados para a nota. Não reescrever vendas ou propostas antigas para completar informação fiscal.

Após autorização, guardar a cópia dos dados enviados e o XML retornado. Alterações posteriores no cadastro não alteram o documento autorizado. O desenho detalhado dessa persistência pertence à arquitetura de emissão.

## 9. Campos que pertencem à emissão

Os seguintes dados podem faltar para emitir, mas não serão exigências permanentes do cadastro de empresa, serviço ou cliente:

- competência e local da prestação;
- destinatário diferente do tomador e intermediário, quando existirem;
- incidência/retentor de ISS, benefícios, suspensão de exigibilidade e deduções;
- CST, classificação tributária e indicador da operação de IBS/CBS conforme o contexto;
- retenções federais e alíquotas efetivamente aplicáveis;
- identificação da obra, evento, imóvel, condomínio ou comércio exterior;
- finalidade da nota, substituição ou ajustes de crédito/débito;
- certificado, série e número da DPS.

Em especial, não gravar “ISS retido sempre” em um cliente como regra incontornável. Um tomador pode participar de serviços com tratamentos diferentes. Não associar um evento do CRM automaticamente ao grupo fiscal de atividade de evento da NFS-e.

## 10. Decisões de arquitetura e alternativas

| Decisão proposta | Alternativa considerada | Motivo e consequência |
| --- | --- | --- |
| Estender os três cadastros | Duplicar cadastros fiscais | Reutiliza entidades/permissões e evita divergência; exige separar validação cadastral da fiscal |
| Campos novos `NULL` e sem padrão tributário | Obrigar preenchimento ou assumir tributação comum | Preserva captação e gestão comercial; o emissor deve apresentar pendências depois |
| Atividade SN por serviço | Atividade única na empresa | Uma empresa pode prestar serviços com enquadramentos distintos; a seleção precisa de validação por contexto |
| Identificação/endereço exterior próprios para o cliente | Colocar NIF no CPF/CNPJ ou código postal no CEP | Preserva regras brasileiras e evita perda de dados alfanuméricos; acrescenta controles condicionais |
| Adiar CST/alíquotas padrão até a decisão sobre operações | Gravar todos os tributos no serviço agora | Evita tratar condição de operação como propriedade fixa; deixa parte do preenchimento para a futura emissão |
| Aceitar descrição cadastral de 2000 e validar perfil de transmissão | Manter todo o sistema em 1000 ou truncar o texto | Prepara o leiaute novo; exige atualização dos consumidores e aviso quando a versão ativa tem limite menor |
| Completude dinâmica por contexto | Salvar um único `fiscalReady=true` | Evita indicador ficar inválido após mudança de regra, competência ou cadastro; autorização segue sendo decisão oficial |

Revisitar essas decisões se houver emissão recorrente com competências passadas, múltiplas classificações por serviço ou suporte amplo a provedores municipais. Nesse momento poderão fazer sentido perfis fiscais por vigência e configurações tributárias reutilizáveis.

## 11. Etapas da implementação

1. Preparar migração aditiva, campos novos e domínios; atualizar contratos de API e tipos.
2. Ajustar Empresa com apuração IBS/CBS, CAEPF, regime especial e coerência do Simples.
3. Ajustar Serviço com atividade SN, descrição ampliada e todos os fluxos que a copiam.
4. Ajustar Cliente com informações complementares e preservação do país; acrescentar endereço/identificação estrangeiros nos controles condicionais.
5. Verificar cadastros mínimos, edição parcial e fluxos rápidos de lead/proposta/venda.
6. Na arquitetura de emissão, acrescentar certificado, DPS, tratamento tributário e validação por versão/contexto. Nenhuma transmissão fiscal é necessária para validar a entrega dos pré-cadastros.

## 12. Critérios de aceite dos pré-cadastros

- Empresa continua cadastrável sem documentos ou campos fiscais adicionais; autorização e vínculo atuais permanecem corretos.
- Serviço continua cadastrável sem `cTribNac`, NBS ou atividade SN.
- Cliente continua cadastrável só com os mínimos comerciais atuais; lead continua sem criar cliente automaticamente.
- Não aceitar valor malformado só porque o campo é opcional; aceitar ausência e remoção de campo fiscal.
- PATCH não limpa dados que não foram enviados, e valida coerência sobre o resultado completo.
- Opção pendente do Simples e seu regime novo não são confundidos com MEI ou não optante.
- País diferente de BR não é substituído silenciosamente por BR na edição do cliente.
- NIF/código postal alfanuméricos mantêm sua representação; NIF e motivo simultâneos são rejeitados.
- CAEPF e IM não se tornam obrigatórios para todos os clientes/PFs.
- Texto de 2000 caracteres atravessa serviço → proposta → venda sem falhar em limites antigos; histórico anterior preservado.
- Código nacional presente não gera promessa de classificação validada ou habilitação oficial.
- Casos de emissão futura informam a entidade/campo ausente, respeitam dados que devem ser omitidos e as exigências de cada versão.

## 13. Implementação e verificação

- Migração aditiva `0024_nfse_pre_registrations.sql` aplicada pelo contêiner da API na inicialização. Os novos campos são opcionais e as restrições de domínio ficam também no banco.
- Empresa, serviço e cliente receberam os campos e controles condicionais descritos acima; os contratos de API, a venda e a proposta aceitam descrição de serviço com até 2.000 caracteres.
- O backend valida coerência na gravação, inclusive durante edição parcial. A edição de cliente bloqueia a linha para evitar duas alterações concorrentes que deixem NIF e motivo de ausência preenchidos ao mesmo tempo.
- Durante a implementação, foram executadas verificações de integração em PostgreSQL isolado e fluxos no navegador. Os arquivos de teste criados para esta etapa foram removidos depois, a pedido do usuário.
- Typecheck da API, typecheck e build do frontend, typecheck e conferência do banco passaram. Os contêineres locais de API e frontend foram reconstruídos.

A validação de completude fiscal por contexto, certificados, série, montagem da DPS e transmissão não integram esta etapa. O código cadastral não deve afirmar que a empresa já pode emitir.
