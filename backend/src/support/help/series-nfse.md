---
id: series-nfse
titulo: Como configurar as séries da NFS-e
rota: fiscal_series
palavras-chave: [série, séries, numeração, dps, próximo número, série padrão, homologação, produção, editar série]
---
## O que é
A série e o próximo número identificam cada declaração (DPS) que o sistema envia ao emissor nacional. Quando há apenas uma série compatível disponível, ela é usada automaticamente. A série escolhida define o ambiente da emissão. Nesta versão, o envio funciona em **Homologação**, o ambiente de teste. Use uma série exclusiva do GestãoNF para evitar repetir números usados em outro sistema.

A tela fica em **Fiscal › Séries e numeração**. A tela está disponível para quem tem a permissão **Séries e numeração**.

## Passo a passo
1. No menu da esquerda, abra **Fiscal** e clique em **Séries e numeração**.
2. Antes de tudo, confira se a empresa tem CPF/CNPJ e município preenchidos em **Cadastros › Empresa**. Sem isso, o botão de cadastrar série fica desativado.
3. Em **Nova série**, escolha o **Ambiente** (**Homologação** para testar).
4. Informe o número da **Série** (de 1 a 49999) e o **Próximo número da DPS** (o primeiro número que será usado).
5. Clique em **Cadastrar série**. A numeração só é consumida quando você confirma uma emissão.
6. Com duas ou mais séries compatíveis disponíveis, use **Usar esta série na emissão** para escolher outra. A série escolhida aparece como **Padrão**.
7. Clique na série cadastrada para abrir **Editar série**. Você pode corrigir o número da série e o próximo número da DPS enquanto a série estiver sem vínculos ou histórico. Depois disso, só é permitido aumentar o próximo número da DPS, e a alteração aparece em **Histórico da numeração** no modal.
8. Para remover uma série sem vínculos, clique em **Excluir** e confirme. Séries vinculadas a vendas, reservas de DPS ou avanços de numeração ficam no histórico.

## Problemas comuns
- "Configure uma série padrão para emitir.": cadastre uma série de Homologação. Se houver mais de uma série disponível, selecione a que deseja usar.
- O botão **Cadastrar série** está desativado: complete CPF/CNPJ e município em **Cadastros › Empresa**.
- Receio de repetir números: ao editar a série, configure o **Próximo número da DPS** para depois do último número já usado.
- Não vejo a tela de séries: seu usuário não tem a permissão **Séries e numeração** nesta empresa. Fale com o responsável pela conta.
