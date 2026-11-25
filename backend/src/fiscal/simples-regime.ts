// O GestãoNF atende só o Simples Nacional "puro": ISS e tributos federais apurados no DAS e sem regime especial municipal.
// Por isso esses dois valores não são escolhidos pelo usuário: o sistema sempre os define.

/** regApTribSN: só existe para ME/EPP (e opção pendente); 1 = federais e ISS pelo Simples. MEI não informa. */
export function simplesTaxationRegimeFor(simplesNationalOption: string | null | undefined): '1' | null {
  return simplesNationalOption === '3' || simplesNationalOption === '4' ? '1' : null;
}

/** regEspTrib: 0 = Nenhum. */
export const SPECIAL_TAX_REGIME = '0';
