# ADR: emissão nacional com processamento persistente e homologação isolada

Estado: proposta para implementação em 29/10/2026.

## Contexto

O GestãoNF já possui vendas, séries e sugestões tributárias, livro inicial de DPS, certificado A1 criptografado, R2 privado e processamento em worker. O produto atenderá inicialmente MEI/SIMEI e ME/EPP optantes pelo Simples Nacional. O objetivo imediato é obter uma nota de teste autorizada no ambiente oficial, preservando sua origem comercial e impedindo duplicidade em falhas de comunicação.

Homologação e produção possuem pacotes de leiaute distintos na data desta decisão. A API externa recebe emissões de forma síncrona, mas uma conexão interrompida pode deixar o resultado desconhecido para o GestãoNF.

## Decisões

1. Integrar diretamente à SEFIN Nacional no monólito modular existente, com adaptador fiscal próprio e contrato versionado por ambiente.
2. Receber comandos de emissão na API e executá-los em worker, usando a outbox transacional existente. O banco é a fonte do estado; a fila pode entregar o mesmo job mais de uma vez.
3. Uma solicitação integral por venda e ambiente. Dividir em DPS apenas quando a classificação/contexto dos serviços exigir. Confirmar a divisão na prévia.
4. Reservar números somente no comando confirmado e em transação com os snapshots e a outbox. Nunca devolver números comprometidos ao contador.
5. Persistir XML assinado e XML oficial no PostgreSQL antes de considerar a etapa durável; arquivar cópias no R2 privado de forma recuperável.
6. Tratar timeout e interrupção de envio como resultado desconhecido. Recuperar pela mesma identidade antes de permitir nova emissão. Não habilitar retry HTTP cego de POST.
7. Usar A1 e-CNPJ da própria empresa na primeira entrega; separar validação local, confiança ICP-Brasil e autorização remota.
8. Fixar algoritmos XMLDSIG e OpenAPI do ambiente antes de liberar transmissão. Documentação histórica não substitui essa verificação.
9. Habilitar primeiro homologação. Produção requer configuração e liberação explícitas, com pacote compatível e validações próprias.

## Alternativas consideradas

| Alternativa | Benefício | Custo ou risco | Escolha |
| --- | --- | --- | --- |
| Provedor fiscal intermediário | Reduz manutenção direta dos contratos | Nova dependência/custo, desnecessária para o recorte nacional escolhido | Integração direta |
| Emissão durante a requisição do navegador | Menos componentes novos | Timeout do cliente, recuperação frágil e maior risco de duplicidade | Worker já existente |
| Microsserviço fiscal separado | Isolamento de implantação | Infraestrutura e operação adicionais para o volume inicial | Módulo no backend atual |
| Redis como única fonte dos comandos | Implementação rápida de fila | Falha entre commit e publicação pode perder ou duplicar trabalho | Outbox e estado no PostgreSQL |
| Uma nota para qualquer conjunto de serviços | Menos documentos na tela | Pode combinar classificações/contextos incompatíveis | Agrupamento fiscal confirmado |
| Bloquear todas as vendas com mais de um serviço | Gerador mais simples | Limitação comercial desnecessária | Grupos compatíveis por solicitação |
| XML somente no R2 | Menor uso do banco | Autorização externa e arquivo remoto não participam da mesma transação | Banco durável e arquivo assíncrono |
| Reemitir após timeout com novo número | Aparente recuperação rápida | Pode produzir duas notas para a mesma prestação | Reconciliação pela DPS original |
| Reutilizar série comercial de produção nos testes | Menos lógica de resolução | Mistura ambientes/contadores | Resolver série do ambiente na emissão |

## Consequências e custos aceitos

Snapshots e XML ocupam espaço no PostgreSQL, adequado ao início e sujeito a medição. O agrupamento exige mostrar resultado parcial e corrigir rejeições por grupo. A fila e o arquivo R2 não garantem execução única; os serviços precisam implementar unicidade e transições condicionais no banco.

A API e o worker passam a depender de runtime com validador XSD real e pacotes fiscais fixados. Há manutenção de contratos, domínios e cadeia de certificados. Esse custo é aceito para evitar depender de provedor intermediário neste recorte.

O suporte inicial ao Simples não significa suporte automático a todos os casos tributários ou à mudança de competência para 2027. Cada capacidade precisa de implementação e evidência de aceitação. O documento [arquitetura de homologação](nfse-national-homologation.md) define os campos, invariantes, rotas, sequência de implementação e critérios concretos de aceite.

## Gatilhos de revisão

- Alteração oficial de leiaute, algoritmos, autenticação ou regras de acesso.
- Suporte a empresas fora do Simples ou emissores municipais.
- Faturamento parcial, emissão avulsa, cancelamento/substituição ou certificados de procurador.
- Crescimento que torne o armazenamento primário de XML no banco inadequado.
- Necessidade comprovada de separar o runtime fiscal ou delegar chaves a um serviço de assinatura/KMS.
