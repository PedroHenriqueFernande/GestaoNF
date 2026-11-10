---
id: emitir-nfse
titulo: Como emitir uma NFS-e
rota: portal_servicos
palavras-chave: [nota, nfse, nfs-e, emitir, emissão, nota fiscal, homologação, prévia]
---
## O que é
A NFS-e é emitida a partir de um pedido confirmado no **Portal de Serviços**, usando o emissor nacional (SEFIN Nacional). Nesta versão, a emissão acontece apenas no ambiente de homologação (Produção Restrita), que serve para teste. O envio em produção ainda não está disponível.

## Antes de emitir
- **Certificado digital** A1 ativo da empresa, cadastrado em **Fiscal › Empresa** (veja o artigo sobre certificado digital).
- **Dados fiscais da empresa** completos: CNPJ válido, município com código IBGE e a **Opção pelo Simples Nacional** (MEI ou ME/EPP).
- **Série da NFS-e** padrão, ativa e de **Homologação**, cadastrada em **Fiscal › Séries e numeração**.
- O serviço vendido precisa ter o **Código de tributação nacional (cTribNac)** preenchido em **Cadastros › Serviços**.
- O cliente (tomador) deve ter o cadastro completo, com documento e endereço quando a nota exigir.
- A regra em **Fiscal › Controle de tributação** é opcional: ela só sugere os percentuais de impostos na venda.

Para conferir tudo de uma vez, abra **Fiscal › Séries e numeração**. O quadro "Prontidão para emitir em homologação" mostra o que ainda está pendente (visível para proprietário e administrador).

## Passo a passo
1. Abra o **Portal de Serviços** e localize o pedido na lista **Lançamentos**.
2. Se o pedido estiver como **Rascunho**, clique nele, depois em **Confirmar pedido**. Para uma venda nova, **Registrar venda de serviço** já registra e confirma o pedido.
3. Clique no pedido confirmado para abrir a edição da venda (título "Editar venda"). Os botões da nota ficam no alto da tela.
4. Se quiser conferir antes, clique em **Pré-visualizar NFS-e**. A prévia não envia nada ao governo e não consome numeração.
5. Clique em **Emitir NFS-e**. Abre uma janela com a prévia da nota e as conferências antes da emissão.
6. Se aparecer algum aviso em "Conferências antes da emissão", corrija o que for indicado (links para empresa, cliente, serviço e série aparecem na janela).
7. Se precisar, ajuste a **Competência da prestação** e clique em **Atualizar prévia**.
8. Clique em **Confirmar emissão em homologação**. Só proprietário e administrador conseguem confirmar.
9. Acompanhe a situação na própria janela. Depois de autorizada, o botão passa a se chamar **Ver NFS-e**, e a janela oferece **Baixar XML autorizado**.

## Problemas comuns
- "Configure uma série padrão para emitir.": cadastre ou ative uma série em **Fiscal › Séries e numeração** e use **Tornar padrão**.
- Certificado vencido ou ausente: cadastre um novo certificado A1 em **Fiscal › Empresa**.
- O botão **Confirmar emissão em homologação** está desativado: seu usuário pode não ser proprietário ou administrador, ou ainda há pendências em "Conferências antes da emissão". Se a prévia mudou, clique em **Atualizar prévia**.
- "Salve as alterações para usar os dados atualizados na nota.": você alterou a venda e ainda não salvou. Salve e tente de novo.
- Nota rejeitada: corrija a venda ou os cadastros indicados e clique em **Emitir NFS-e** de novo (a janela abre com o título "Emitir NFS-e novamente"). Um número novo é usado a cada tentativa.
