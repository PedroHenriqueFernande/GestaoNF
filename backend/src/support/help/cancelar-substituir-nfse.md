---
id: cancelar-substituir-nfse
titulo: Como cancelar ou substituir uma NFS-e
rota: portal_servicos
palavras-chave: [cancelar nota, cancelamento, substituir nota, substituição, nfse autorizada, nota errada, corrigir nota]
---
## O que é
Depois que uma NFS-e é autorizada, você pode **cancelar** a nota ou **substituí-la** por outra corrigida. Essas ações ficam na janela da nota, dentro do pedido no **Portal de Serviços**. Só proprietário e administrador da empresa veem e usam os botões. Nesta versão, tudo vale apenas para o ambiente de homologação (teste).

- **Cancelar**: a nota é cancelada no ambiente nacional e **não pode ser desfeita**. A venda continua confirmada e o financeiro não muda. Depois você pode emitir outra nota, se precisar.
- **Substituir**: a venda fica editável para você corrigir o que for preciso e emitir uma nota substituta. A nota atual só passa a "Substituída" quando a nova for autorizada. Para MEI e ME/EPP, a competência, o tomador e o valor do serviço não podem mudar. Se o erro estiver em um deles, cancele a nota e emita outra.

## Passo a passo
Para cancelar:
1. Abra o **Portal de Serviços**, clique no pedido e, no alto da tela, clique em **Ver NFS-e**.
2. Na nota autorizada, clique em **Cancelar NFS-e**.
3. Escolha o **Motivo** (**Erro na emissão**, **Serviço não prestado** ou **Outros**).
4. Escreva a **Justificativa**, com no mínimo 15 e no máximo 255 caracteres.
5. Clique em **Confirmar cancelamento**. Enquanto o cancelamento estiver em andamento, a nota aparece como "Cancelamento em andamento".

Para substituir:
1. No mesmo lugar (**Ver NFS-e**), clique em **Substituir NFS-e**.
2. Escolha o **Motivo** da substituição. Para "Correção de dados da nota (outros)", a **Justificativa** é obrigatória (15 a 255 caracteres). Nos demais motivos ela é opcional.
3. Clique em **Abrir substituição**.
4. Corrija a venda ou os cadastros e salve.
5. Volte ao pedido e clique em **Emitir substituta**. Confira a prévia e clique em **Confirmar substituição em homologação**.
6. Se desistir, clique em **Desistir da substituição**.

## Problemas comuns
- Não aparecem os botões **Cancelar NFS-e** e **Substituir NFS-e**: seu usuário precisa ser proprietário ou administrador, e a nota precisa estar autorizada, sem cancelamento em andamento. A substituição só está disponível quando a venda tem exatamente uma nota ativa. Nos outros casos, cancele e emita de novo.
- "Cancelamento recusado pelo ambiente nacional. A nota continua válida.": leia a mensagem exibida abaixo e, se for o caso, tente novamente com outro motivo ou justificativa.
- O cancelamento ficou sem resposta: clique em **Consultar resultado do cancelamento** para atualizar a situação.
- A justificativa não é aceita: ela precisa ter pelo menos 15 caracteres. O contador mostra quantos você já digitou.
