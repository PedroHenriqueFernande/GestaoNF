# ADR: configuração fiscal vinculada à venda sem emissão antecipada

## Status

Aceita em 21/10/2026.

## Contexto

O usuário quer cadastrar alíquotas e série uma vez. Na venda, escolhe opcionalmente uma regra tributária para todos os serviços; a série é encontrada automaticamente pela empresa emissora. Uma venda comercial pode ser editada ou cancelada, enquanto uma DPS precisa de identidade fiscal e sequência próprias. A emissão nacional ainda depende de certificado, validação do município e transmissão.

## Decisão

- Guardar séries por empresa, ambiente, município, identidade fiscal e número, com contador no banco e registro de avanços administrativos.
- Guardar regras tributárias como perfis com revisões imutáveis e data de vigência. O padrão mais específico aplicável (serviço e município, serviço, empresa) fornece a sugestão.
- Na venda, escolher uma única regra opcional ao lado do cliente. "Sem regra" é o padrão e grava ausência de sugestão tributária em todos os itens. Somente regras aplicáveis a todos os serviços da venda podem ser escolhidas. O backend guarda em cada item uma cópia da revisão da regra escolhida para preservar o histórico.
- Associar automaticamente à venda a série ativa padrão da empresa que corresponda à identidade fiscal e ao município. Quando existir apenas uma série ativa compatível, usá-la mesmo sem marcação de padrão. A série não é escolhida na venda.
- Criar o livro `nfse_dps`, mas não expor reserva pública nem consumir número ao salvar ou confirmar venda. A reserva fará parte do comando futuro de emissão, com transação e idempotência.

## Alternativas e trade-offs

| Opção | Ganho | Custo | Decisão |
| --- | --- | --- | --- |
| Número da DPS ao confirmar a venda | Mostra número cedo | Desperdiça números em vendas sem nota e mistura pedido com documento fiscal | Rejeitada |
| Apenas percentuais no cadastro de serviço | Implementação menor | Perde vigência e dificulta alteração sem afetar o passado | Rejeitada |
| Regras com revisões e snapshot na venda | Histórico claro e seleção automática | Mais tabelas e validação contextual na emissão | Escolhida |

## Consequências

A venda mostra uma configuração fiscal sugerida, sem prometer que a nota será aceita. Ao implementar emissão, o sistema terá de validar município, regime, retenções e leiaute vigente, reservar o número da DPS em transação e registrar tentativas e respostas. Se a venda for editada depois de uma emissão autorizada, o documento fiscal não poderá ser alterado por esse fluxo comercial.
