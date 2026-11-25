export type BrazilianAddress = {
  postalCode: string;
  street: string;
  district: string;
  cityName: string;
  stateCode: string;
  cityIbgeCode: string;
};

export async function lookupBrazilianAddress(postalCode: string): Promise<BrazilianAddress | null> {
  const digits = postalCode.replace(/\D/g, '');
  if (!/^\d{8}$/.test(digits)) return null;

  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  if (!response.ok) throw new Error('Não foi possível consultar o CEP.');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') return null;
  const address = data as Record<string, unknown>;
  if (address.erro || typeof address.localidade !== 'string' || typeof address.uf !== 'string'
    || typeof address.ibge !== 'string' || !/^[A-Z]{2}$/.test(address.uf) || !/^\d{7}$/.test(address.ibge)) return null;

  return {
    postalCode: digits,
    street: typeof address.logradouro === 'string' ? address.logradouro : '',
    district: typeof address.bairro === 'string' ? address.bairro : '',
    cityName: address.localidade,
    stateCode: address.uf,
    cityIbgeCode: address.ibge,
  };
}
