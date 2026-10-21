# Certificado digital da empresa para NFS-e — arquitetura

Status em 21/10/2026: cadastro A1 implementado no banco, API e modal da empresa. A conexão com a API nacional, validação completa da cadeia ICP-Brasil/revogação, assinatura XML e emissão permanecem para a etapa do transmissor. O estado exibido após upload significa que arquivo, senha, identidade e compatibilidade TLS passaram na verificação local.

## Objetivo e encaixe no GestãoNF

O certificado será uma **credencial fiscal da empresa emissora**, não da conta pessoal do usuário. O operador abre **Cadastros → Empresa → editar empresa → Dados fiscais → Certificado digital**, envia o arquivo A1 (`.pfx` ou `.p12`) e informa sua senha uma vez. O sistema usa automaticamente CPF/CNPJ e tipo PF/PJ já cadastrados na empresa para validar a titularidade. Não haverá outro campo para digitar a inscrição federal no upload.

Hoje o modal em `apps/web/src/features/companies/CompanyPage.tsx` contém identificação, endereço e dados fiscais; `companies.tax_id`, `kind`, `city_ibge_code` e regime estão em `packages/database/src/schema.ts`. O serviço `apps/api/src/companies/companies.service.ts` permite alterar o cadastro somente a `OWNER`/`ADMIN`. O módulo fiscal já guarda séries, regras e `nfse_dps`, mas não autentica no governo nem assina/transmite uma DPS. O upload privado de contratos de venda em `stored_files`/R2 permite download e, portanto, **não é cofre de chave privada**.

## Base oficial e decisão de escopo

O [manual atual da API do Emissor Público Nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-emissor-publico-api-sistema-nacional-nfs-e-v1-2-out2025.pdf) descreve o envio da DPS pelo `POST /nfse` e consultas em que a identidade do certificado da conexão determina o acesso. A [documentação atual de produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual) e os [endereços oficiais de produção restrita e produção](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/apis-prod-restrita-e-producao/apis-prod-restrita-e-producao) devem ser a referência ao implementar o transmissor. Para a API de distribuição do ADN, o [manual de 2026](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/documentacao-atual/manual-contribuintes-apis-adn-sistema-nacional-nfse.pdf) admite certificado de CNPJ da mesma raiz em consultas específicas; isso **não autoriza inferir** a mesma regra para assinar e emitir uma DPS.

Primeira entrega: **A1 ICP-Brasil exportável** em PKCS#12 para autenticação de cliente na conexão TLS e assinatura do documento fiscal, conforme o contrato ativo. O [manual técnico histórico do Sistema Nacional](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/leiaute-e-esquemas-antigos/manualintegradosnnfse_v1-00-02-producao.pdf) descreve A1/A3 e a identificação CPF/CNPJ no certificado; por ser histórico, seus detalhes técnicos precisam ser reconfirmados nos manuais/XSD vigentes antes de codificar. A3 depende de dispositivo físico ou assinatura remota e terá arquitetura própria. Não confundir a senha do PFX com login do GestãoNF nem com um token OAuth. Um certificado cadastrado não prova sozinho que o município, o contribuinte e a DPS estão habilitados para emissão.

## Experiência no modal da empresa

1. A seção aparece no **modal de edição**, depois de salvar a empresa pela primeira vez. No modal de criação, mostrar “Salve a empresa para adicionar o certificado”.
2. Mostrar o CPF/CNPJ já salvo, tipo da empresa e estado do certificado: ausente, válido localmente, expirado, desativado ou validação remota pendente/falha. Exibir titular, emissor, número de série abreviado, impressão digital abreviada e validade; nunca mostrar arquivo, senha ou chave privada.
3. `OWNER`/`ADMIN` podem “Adicionar certificado”, “Substituir”, “Testar conexão” e “Desativar”. Outros membros veem apenas o estado permitido pela política de acesso da empresa. Upload em campo de arquivo + campo de senha com visibilidade opcional e botão “Validar e salvar”. A senha não faz parte do formulário geral da empresa.
4. Antes do upload, exigir CPF/CNPJ válido e empresa brasileira. Se a inscrição do certificado divergir da empresa, bloquear com orientação para revisar os dados; não corrigir automaticamente o cadastro fiscal. Se houver dados da empresa alterados ainda não salvos no formulário, solicitar que sejam salvos primeiro para evitar comparação com valor antigo.
5. Após validação, mostrar separadamente “certificado válido no cadastro” e “conexão ao ambiente de homologação testada”. Não mostrar “pronto para emitir” até os demais requisitos de emissão serem verificados. Alertas de vencimento, por exemplo, 30, 15 e 7 dias, são calculados da validade e aparecem no modal; comunicação por e-mail pode vir depois.

## Banco de dados

Tabela `company_fiscal_certificates`:

| Campo | Uso |
| --- | --- |
| `id`, `company_id` | UUID; FK para `companies`, sempre consultado pelo par empresa + ID |
| `status` | `ACTIVE`, `REPLACED` ou `DISABLED`; `EXPIRED` é condição calculada de `not_after`, não transição necessária |
| `subject_kind`, `subject_tax_id` | Identidade extraída do certificado, normalizada; snapshot imutável |
| `fingerprint_sha256`, `serial_number`, `issuer_summary`, `subject_summary`, `not_before`, `not_after` | Metadados públicos de inspeção e auditoria; resposta HTTP só devolve o necessário |
| `pfx_ciphertext`, `pfx_iv`, `pfx_tag`, `passphrase_ciphertext`, `passphrase_iv`, `passphrase_tag`, `key_version` | Conteúdo e senha criptografados com chave de aplicação separada; nenhuma coluna sai em DTO |
| `local_validated_at`, `remote_tested_at`, `remote_test_environment`, `remote_test_result` | Evidência separada de parse/identidade e autenticação remota; falha remota não apaga validade local |
| `created_by_user_id`, `created_at`, `replaced_at`, `disabled_at`, `updated_at` | Autor e ciclo de vida |

Índices: unicidade parcial de **um `ACTIVE` por empresa**; o mesmo arquivo ativo não pode ser reinstalado, mas pode ser enviado novamente após desativação. O mesmo CNPJ em duas empresas cadastradas não concede compartilhamento automático da chave. FK e filtros por `company_id` em toda operação evitam usar certificado de outra empresa. Tabela `company_fiscal_certificate_events`: `id`, `company_id`, `certificate_id`, `actor_user_id`, `action`, `created_at`, sem senha ou PFX. Eventos de teste remoto, ambiente e resultado serão adicionados com o transmissor.

Para o MVP, o PFX fica **criptografado no PostgreSQL**, em tabela e serviço dedicados. Arquivo pequeno, limite inicial de 2 MiB; não usar `stored_files`, URLs assinadas do R2 nem anexos comerciais. A criptografia é AES-256-GCM com nonce aleatório por campo, chave de 256 bits em segredo do ambiente, AAD contendo empresa/ID/versão, `key_version` para rotação. PFX e senha podem ser cifrados em um único envelope se a implementação garantir limites e metadados equivalentes. Backup do banco **e** da chave precisam de recuperação coordenada; perda da chave impede futuras emissões até novo upload. Antes de operar certificados reais de clientes em produção, escolher e integrar um gerenciador de segredos/KMS para a chave mestra, mantendo uma interface `CertificateEncryptionService` para não reescrever os dados. Não reutilizar a chave existente do módulo de e-mail.

## API e serviços

Usar módulo NestJS `apps/api/src/fiscal/certificates/`. Rotas autenticadas e com empresa autorizada (padrão atual: `X-Company-Id` / `CompanyGuard`); o `company_id` vem do contexto validado, nunca de um campo livre no corpo. `GET /fiscal/certificate` devolve metadados e estado; `POST /fiscal/certificate` recebe `multipart/form-data` (`file`, `passphrase`) e substitui o ativo após validação; `POST /fiscal/certificate/test` tenta uma operação **somente de leitura** no ambiente selecionado, conforme endpoint oficial confirmado na implementação; `DELETE /fiscal/certificate` desativa. Se o framework Fastify ainda não tiver parser multipart, registrar `@fastify/multipart` exclusivamente com limite de tamanho e rejeição de campos inesperados. Respostas comuns: 400 formato/senha, 403 papel, 409 identidade em conflito/troca concorrente, 422 certificado incompatível/expirado, 502/503 falha do serviço nacional sem transformar isso em falha do arquivo.

`CertificateService.install()` implementado:

1. Confirmar sessão, empresa ativa e papel `OWNER`/`ADMIN`; limitar tamanho, taxa de tentativas e campos. Nunca registrar corpo multipart nem senha. Receber via HTTPS em produção, sem link público, sem cache e sem arquivo temporário persistente.
2. Analisar PKCS#12, confirmar senha, presença de chave privada, correspondência chave/certificado, período de validade e usos de TLS/assinatura declarados. Extrair CPF/CNPJ da extensão apropriada do certificado por ASN.1; não inferir titularidade apenas do texto do nome. A verificação criptográfica da cadeia ICP-Brasil e da revogação ainda precisa ser integrada antes de afirmar aptidão fiscal. Certificados não exportáveis/A3 são rejeitados com explicação.
3. Comparar tipo e inscrição com `companies.kind` e `companies.tax_id` integralmente na primeira versão. Esta é uma restrição **conservadora do produto** para emissão; regras específicas de matriz/filial ou procuração precisam de contrato oficial confirmado e fluxo explícito futuro. Se não for possível confirmar revogação por fonte confiável naquele momento, marcar verificação externa como pendente, jamais “não revogado”.
4. Cifrar os segredos antes de gravar. Em transação, bloquear a empresa/credencial ativa, marcar a anterior `REPLACED`, inserir a nova `ACTIVE` e registrar evento. Falha de validação deixa o certificado anterior ativo. Conflitos simultâneos retornam 409. Remover o conteúdo cifrado do certificado substituído após a política de retenção definida; manter só metadados e eventos quando não houver obrigação operacional de conservar a chave.
5. Limpar buffers de senha/chave na medida permitida pelo runtime, fechar agentes TLS e não guardar chave decifrada em cache compartilhado. O uso posterior pelo emissor ocorre apenas no servidor, resolvendo o certificado ativo pela empresa autenticada e revendo validade/estado no instante da operação.

O teste remoto é um **teste de autenticação/conectividade**, não uma emissão de nota: usar endpoint de leitura que exija certificado se confirmado na documentação viva do ambiente, registrar código e data, sem criar DPS nem consumir número. Uma resposta sem autorização fiscal deve ser exibida como tal, separada de senha incorreta, certificado inválido e indisponibilidade. Se nenhum endpoint seguro de leitura permitir demonstrar identidade naquele ambiente, não chamar 404 genérico de “teste aprovado”.

Na futura emissão, a DPS precisa usar o CPF/CNPJ da mesma empresa, série compatível e certificado válido; o serviço de assinatura e o cliente mTLS recebem um `CertificateHandle` interno, não PFX em payload HTTP. Registrar `certificate_id`/impressão digital na tentativa fiscal para rastreabilidade. Uma rotação entre preparação e transmissão exige revalidar a identidade; jobs já em execução devem terminar com a versão que fixaram ou ser reconciliados antes de nova tentativa. Desativar bloqueia novas transmissões; timeout e estado `UNKNOWN` continuam seguindo a reconciliação por DPS descrita em `nfse-series-tax-control.md`.

## Alterações nos cadastros e limites

- Em `CompaniesService.update()`, bloquear mudança de `kind` ou `taxId` enquanto houver certificado ativo; oferecer desativar/substituir e depois editar, tudo com verificação transacional. Alterar nome de exibição não troca a identidade fiscal. Alterar município/regime exige nova conferência do contexto de emissão, não novo PFX por si só.
- A UI deve consultar o estado do certificado separadamente do `CompanyInput`, para que “Salvar alterações” dos dados empresariais não reenvie segredo ou substitua credencial.
- O certificado não substitui os cadastros de empresa, serviço, cliente, regra tributária e série, nem a validação de inscrição/habilitação pelo serviço nacional. A presença do certificado não liga produção automaticamente.
- A revisão do contrato oficial mais recente é obrigatória ao implementar XML, assinatura e transmissão, pois a documentação e os XSD mudam; homologação e produção usam endereços diferentes.

## Entrega e verificação

1. Migração, criptografia e política de papéis; upload e validação local do A1.
2. Seção no modal de edição, estado seguro, substituição/desativação e bloqueio de mudança da inscrição fiscal.
3. Cliente mTLS e teste de leitura em produção restrita, com resultado honesto e auditoria.
4. Integrar assinatura da DPS/transmissão somente na etapa de emissor; validar XSD vigente e regras fiscais no momento da emissão.

Verificações essenciais: senha incorreta não substitui certificado ativo; arquivo malformado ou >2 MiB é recusado; CPF/CNPJ divergente e acesso entre empresas são bloqueados; colaborador não instala/desativa; nenhum DTO/log/URL expõe segredo; instalação concorrente mantém um ativo; certificado expirado ou desativado não autentica; chave antiga continua recuperável na rotação de segredo até recriptografar os dados; falha remota não é apresentada como certificado inválido; rotação durante tentativa fiscal não duplica envio.
