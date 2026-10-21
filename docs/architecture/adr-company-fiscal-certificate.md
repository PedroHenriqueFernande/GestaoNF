# ADR: guarda do certificado fiscal vinculada à empresa

## Status

Proposta em 21/10/2026, para implementação na próxima etapa fiscal.

## Contexto

O GestãoNF tem cadastro de várias empresas por usuário e anexos privados de contratos em R2. A autenticação nas APIs fiscais e a assinatura da DPS precisam usar a identidade da prestadora escolhida. Um PFX contém chave privada e requer proteção diferente de um anexo baixável.

## Decisão

- Cada empresa terá no máximo um certificado fiscal A1 ativo; o usuário o gerencia dentro do modal de edição da própria empresa.
- CPF/CNPJ e PF/PJ são lidos do cadastro da empresa e comparados ao certificado. A primeira versão exige identidade completa correspondente para emissão. Nenhuma empresa herda a chave de outra automaticamente.
- O backend guarda PFX e senha criptografados em tabela própria, com chave mestra separada e versão. Apenas o serviço fiscal pode decifrar; nenhum endpoint fornece download.
- Upload, substituição e desativação exigem `OWNER` ou `ADMIN`. A substituição só ativa o novo certificado depois da validação bem-sucedida.
- Validade local, autenticação remota e aptidão fiscal para emitir são estados diferentes. Teste remoto não cria DPS.

## Alternativas e trade-offs

| Alternativa | Vantagem | Limite | Decisão |
| --- | --- | --- | --- |
| Reutilizar `stored_files`/R2 | Menos código inicial | Fluxo atual tem download e URL assinada para anexos; expõe uma chave fiscal por uma superfície desnecessária | Rejeitada |
| Guardar somente no navegador ou pedir PFX a cada emissão | Servidor não mantém chave em repouso | Quebra emissão pelo backend, reconciliação e processamento assíncrono; usuário precisa estar presente | Rejeitada para este produto |
| Certificado em tabela dedicada, criptografado | Isolamento, auditoria e uso servidor | Requer gestão e recuperação segura da chave mestra | Escolhida |
| A3 físico/assinatura remota | Chave pode ficar fora do servidor | Integração distinta com dispositivo/provedor e latência | Fase posterior |

## Consequências

A guarda da chave privada eleva a responsabilidade operacional do GestãoNF. O gerenciamento de segredos/KMS, backups recuperáveis, controle de acesso e trilha de auditoria passam a ser parte da entrega antes de aceitar certificados reais de clientes em produção. O certificado por si só não habilita emissão: o transmissor, a assinatura do XML, a validação fiscal e o ambiente nacional permanecem etapas separadas. A arquitetura detalhada está em [nfse-company-certificate.md](nfse-company-certificate.md).
