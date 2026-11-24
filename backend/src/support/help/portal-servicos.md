---
id: portal-servicos
titulo: Como lançar um pedido de serviços
rota: portal_servicos
palavras-chave: [venda, pedido, portal de serviços, lançamento, rascunho, parcelas, recebimento, os, desconto]
---
## O que é
O **Portal de Serviços** é onde você registra cada serviço vendido e acompanha os valores recebidos. Cada lançamento é um pedido com o cliente, os serviços, as formas de pagamento (os recebimentos) e, se quiser, o número da OS. É do pedido confirmado que sai a NFS-e. Você encontra a tela no menu da esquerda, em **Portal de Serviços**.

## Passo a passo
1. Clique em **Nova venda** no alto do menu da esquerda, ou abra o **Portal de Serviços** e clique em **Nova venda de serviço**.
2. Em **Dados do lançamento**, confira a **Empresa**, escolha o **Cliente** (busque pelo nome ou use o botão de novo cliente) e a data da venda. O **Número da OS** é opcional.
3. Se quiser aplicar sugestões de imposto, escolha a **Regra de tributação**. É opcional.
4. Em **Serviços vendidos**, busque e escolha o serviço, informe a **Quantidade**, o **Valor unitário** e, se houver, o **Desconto** (em R$ ou em %). Repita para cada serviço.
5. Em **Formas de pagamento**, escolha a forma (PIX, Dinheiro, Cartão de crédito, Cartão de débito, Boleto, Transferência ou Outra) e o valor. Na **Situação**, marque **Pendente** (e informe o **Vencimento**) ou **Já recebida** (e informe **Recebido em**). Para dividir em parcelas, use **Adicionar forma de pagamento**. A soma dos recebimentos precisa ser igual ao total dos serviços.
6. Se precisar, escreva as **Observações da venda**.
7. Clique em **Registrar venda de serviço**. O pedido é salvo e confirmado.

Para acompanhar, use as abas **Todos**, **Confirmados**, **Rascunhos** e **Excluídas** e o campo de busca (pedido, OS ou cliente). Clique em um pedido para abrir e editar. Se o pedido for um **Rascunho**, o botão final se chama **Confirmar pedido**, e **Salvar alterações** guarda sem confirmar. Para ver os detalhes, as baixas e o histórico de um pedido já aberto, clique em **Ver detalhes, baixas e histórico**. Para excluir um pedido, use o menu **⋯** da linha e clique em **Excluir**: o sistema pede o motivo, e o pedido fica no histórico como **Excluída**. Recebimentos ou NFS-e ativos impedem a exclusão.

O que aparece depende das suas permissões. Rascunhos são alterados por quem tem **Criar vendas**. Para editar um pedido confirmado, use **Editar venda**. **Excluir** exige **Excluir venda**. Sem **Alterar preço e desconto na venda**, você pode preencher esses valores ao adicionar um serviço sem preço no catálogo. Para alterar apenas a data de lançamento ou o vencimento, use **Alterar data e vencimento** no **Financeiro**. Veja o tópico "Permissões e acesso".

## Problemas comuns
- "Selecione a empresa e o cliente e adicione ao menos um serviço.": falta o cliente ou o serviço.
- "A soma das formas de pagamento precisa ser igual ao total dos serviços.": ajuste os valores dos recebimentos até fecharem com o total.
- "Revise quantidade, valores e datas dos serviços e dos recebimentos.": confira se todos os valores são maiores que zero e se as datas estão preenchidas.
- O pedido ficou como **Rascunho** depois de uma falha: abra o pedido e clique em **Confirmar pedido** (ou **Tentar confirmar**).
- Uma NFS-e autorizada bloqueia a edição e a exclusão da venda. Abrir uma substituição libera **Editar** para quem tem a permissão **Editar venda**. A edição volta a ficar bloqueada durante a emissão da substituta e após sua autorização. A exclusão continua bloqueada enquanto houver uma nota ativa ou uma solicitação fiscal em andamento. Veja o artigo "Como cancelar ou substituir uma NFS-e".
- Não encontro o cliente ou o serviço: cadastre antes em **Cadastros › Clientes** ou **Cadastros › Serviços**.
