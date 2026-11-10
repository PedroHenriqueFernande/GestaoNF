---
id: series-nfse
titulo: Como configurar as séries da NFS-e
rota: fiscal_series
palavras-chave: [série, séries, numeração, dps, próximo número, série padrão, homologação, produção, avançar número]
---
## O que é
A série e o próximo número identificam cada declaração (DPS) que o sistema envia ao emissor nacional. Sem uma **série padrão** ativa, a NFS-e não é emitida. O **ambiente** da emissão (Homologação ou Produção) é definido pela série padrão. Nesta versão, o envio só funciona em **Homologação**, que é o ambiente de teste. Use uma série exclusiva do GestãoNF, para não repetir números usados em outro sistema.

A tela fica em **Fiscal › Séries e numeração**. Só proprietário e administrador cadastram e alteram séries; os demais usuários apenas consultam.

## Passo a passo
1. No menu da esquerda, abra **Fiscal** e clique em **Séries e numeração**.
2. Antes de tudo, confira se a empresa tem CPF/CNPJ e município preenchidos em **Fiscal › Empresa**. Sem isso, o botão de cadastrar série fica desativado.
3. Em **Nova série**, escolha o **Ambiente** (**Homologação** para testar).
4. Informe o número da **Série** (de 1 a 49999) e o **Próximo número da DPS** (o primeiro número que será usado).
5. Deixe marcado **Usar como série padrão da empresa**.
6. Clique em **Cadastrar série**. A numeração só é consumida quando você confirma uma emissão.
7. Em **Séries cadastradas**, use **Tornar padrão** para trocar a série padrão, ou **Inativar** e **Ativar** para mudar a situação.
8. Se precisar pular números (por exemplo, usados em outro sistema), clique em **Avançar número**, informe o **Novo próximo número** e o **Motivo** (mínimo de 5 caracteres) e clique em **Confirmar avanço**. O número nunca volta atrás. O **Histórico da numeração** mostra todos os avanços.

No alto da tela, o quadro **Prontidão para emitir em homologação** lista o que ainda impede a emissão. O botão **Testar conexão com o ambiente nacional** confere a conexão sem emitir nota e sem gastar numeração. Esse quadro e o botão são visíveis apenas para proprietário e administrador.

## Problemas comuns
- "Configure uma série padrão para emitir.": cadastre uma série de Homologação e marque como padrão.
- O botão **Cadastrar série** está desativado: complete CPF/CNPJ e município em **Fiscal › Empresa**.
- "Defina uma única série padrão de homologação": há mais de uma série padrão compatível. Deixe apenas uma como padrão.
- Receio de repetir números de nota: use **Avançar número** para começar a numeração depois do último número já usado.
- Não vejo o cadastro de série: seu usuário pode ter só acesso de consulta nesta empresa.
