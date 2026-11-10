---
id: certificado-digital
titulo: Como cadastrar o certificado digital
rota: empresa
palavras-chave: [certificado, certificado digital, a1, pfx, p12, senha do certificado, icp-brasil, vencido]
---
## O que é
Para emitir NFS-e, a empresa precisa de um **certificado digital A1** (arquivo `.pfx` ou `.p12`) em nome do mesmo CNPJ cadastrado. Ele é a assinatura digital da empresa e é guardado de forma protegida no sistema. O certificado pertence à empresa, não ao seu usuário pessoal. Só proprietário e administrador podem cadastrar, substituir ou desativar. Os demais usuários apenas consultam.

Ele fica no cadastro da empresa: menu **Fiscal › Empresa**, ao abrir a empresa, na seção **Certificado digital**.

## Passo a passo
1. No menu da esquerda, abra **Fiscal** e clique em **Empresa**.
2. Na lista **Empresas cadastradas**, clique na empresa para abrir o cadastro. Se ainda não houver empresa, clique em **Novo**, preencha os dados e salve primeiro. A seção de certificado só funciona depois que a empresa foi salva.
3. Confira se o CNPJ (ou CPF) da empresa está preenchido e salvo. Se alterou algo, clique em **Salvar alterações** antes de continuar.
4. Role até a seção **Certificado digital**.
5. Em **Arquivo A1 (.pfx ou .p12)**, escolha o arquivo do certificado.
6. Em **Senha do certificado**, digite a senha do arquivo.
7. Clique em **Validar e salvar certificado**.
8. Pronto: aparece "Certificado validado localmente", com o CPF/CNPJ, o emissor e a data de validade.

A conexão com o ambiente nacional só é conferida na etapa de emissão. Para testar a conexão sem emitir nota, use **Testar conexão com o ambiente nacional** em **Fiscal › Séries e numeração**.

Para trocar o certificado, escolha o novo arquivo e a senha e clique em **Substituir certificado**. Para remover, clique em **Desativar**.

## Problemas comuns
- O botão **Validar e salvar certificado** está desativado: falta escolher o arquivo ou digitar a senha, ou o CNPJ da empresa ainda não foi salvo ("Salve primeiro as alterações da empresa.").
- Falha ao cadastrar: confira se a senha está correta e se o certificado é do tipo A1 em nome do mesmo CNPJ cadastrado na empresa. Certificado A3 (cartão ou token) não é aceito.
- "Certificado expirado": cadastre um novo certificado com **Substituir certificado**.
- Não consigo alterar o CNPJ da empresa: com um certificado ativo, o campo fica bloqueado ("Para alterar, desative primeiro o certificado.").
- Não aparecem os botões de enviar arquivo: seu usuário só tem acesso de consulta. Peça ao proprietário ou a um administrador.
