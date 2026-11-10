---
id: tributacao
titulo: Como configurar a tributação
rota: fiscal_tributacao
palavras-chave: [tributação, imposto, impostos, iss, regra tributária, alíquota, retenção, pis, cofins, simples]
---
## O que é
O **Controle de tributação** guarda regras com **sugestões** de percentuais de impostos (ISS, PIS, COFINS, CSLL, IRRF, INSS e retenção do ISS) para preencher suas vendas de serviços. É uma ajuda: a regra não decide sozinha o imposto da nota. Os valores usados ficam registrados em cada venda, e o município, o regime e as retenções ainda são conferidos na emissão. Confirme os percentuais com seu contador.

A tela fica em **Fiscal › Controle de tributação**. Só proprietário e administrador cadastram regras.

## Passo a passo
1. No menu da esquerda, abra **Fiscal** e clique em **Controle de tributação**.
2. Em **Nova regra tributária**, escreva o **Nome da regra**, por exemplo "Serviços da empresa".
3. Em **Aplicar a**, escolha **Todos os serviços da empresa**, **Um serviço** ou **Um serviço em um município**. Nos dois últimos casos, escolha o **Serviço** (e, quando for o caso, o **Código IBGE do município**).
4. Marque **Aplicar automaticamente como padrão** se quiser que a regra seja sugerida sozinha.
5. Em **Válida a partir de**, informe a data de início.
6. Preencha os percentuais que quiser sugerir: **ISS (%)**, **PIS (%)**, **COFINS (%)**, **CSLL (%)**, **IRRF (%)** e **INSS (%)**. Os campos em branco ficam como "Não sugerir". Em **Retenção do ISS**, escolha **Sugerir ISS retido** ou **Sugerir sem retenção**.
7. Clique em **Cadastrar regra**.
8. Em **Regras cadastradas**, use **Nova revisão** para mudar percentuais (a regra antiga fica no histórico), **Tornar padrão** para definir a regra automática e **Inativar** ou **Ativar** para mudar a situação.

Para usar a regra, abra uma venda no **Portal de Serviços** e escolha em **Regra de tributação**. Se não quiser aplicar nenhuma, deixe "Sem regra".

## Problemas comuns
- A regra não aparece na venda: ela precisa estar ativa e se aplicar a todos os serviços do pedido. Regras de um serviço só aparecem quando todos os itens usam aquele serviço.
- Quero mudar a alíquota sem afetar vendas antigas: use **Nova revisão**. Vendas já feitas guardam os valores usados na época.
- Não consigo cadastrar regras: seu usuário precisa ser proprietário ou administrador.
- Dúvida sobre qual percentual usar: confirme com seu contador. O sistema apenas guarda as sugestões que você informa.
