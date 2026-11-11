// backend/src/assistant/tools/write-support.ts
import { money } from '../nero-format.js';
import { label } from './read-support.js';

/** Rótulos em português dos campos de cliente e serviço (chaves dos schemas de domínio). */
export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo', name: 'Nome', tradeName: 'Nome fantasia', taxId: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', notes: 'Observações', status: 'Situação',
  street: 'Rua', number: 'Número', complement: 'Complemento', district: 'Bairro', postalCode: 'CEP', cityName: 'Cidade', cityIbgeCode: 'Código IBGE da cidade',
  stateCode: 'UF', countryCode: 'País', municipalRegistration: 'Inscrição municipal', caepfCode: 'CAEPF', foreignTaxId: 'Documento estrangeiro',
  noForeignTaxIdReason: 'Motivo sem documento estrangeiro', foreignPostalCode: 'CEP estrangeiro', foreignStateProvince: 'Estado/província estrangeiro',
  internalCode: 'Código interno', description: 'Descrição', unitLabel: 'Unidade', suggestedUnitPrice: 'Preço sugerido', nationalTaxCode: 'Código de tributação nacional',
  nbsCode: 'Código NBS', simplesActivityCode: 'Anexo do Simples',
};

const PRICE_FIELDS = new Set(['suggestedUnitPrice']);
/** Campos cujo valor vem de um código interno traduzido (início em maiúscula, como em "Tipo: Pessoa física"). */
const CODED_FIELDS = new Set(['kind', 'status']);

export function formatTaxId(value: string) {
  const digits = value.replace(/\W/g, '');
  if (/^\d{11}$/.test(digits)) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (/^[A-Z0-9]{12}\d{2}$/i.test(digits)) return digits.replace(/(.{2})(.{3})(.{3})(.{4})(.{2})/, '$1.$2.$3/$4-$5');
  return value;
}

export function formatValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '(vazio)';
  if (PRICE_FIELDS.has(field)) return money(String(value));
  if (field === 'taxId') return formatTaxId(String(value));
  const text = String(label(String(value)));
  return CODED_FIELDS.has(field) ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "Nome: X · Telefone: Y" dos campos informados (ignora vazios e os campos em `skip`). */
export function describeFields(values: Record<string, unknown>, skip: string[] = []) {
  return Object.entries(values).filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined && value !== '' && FIELD_LABELS[key])
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, value)}`).join(' · ');
}

/** Só os campos que mudam: "Telefone: A → B". */
export function describeChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  const parts = Object.entries(changes).filter(([key, value]) => FIELD_LABELS[key] && (before[key] ?? null) !== (value ?? null))
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, before[key])} → ${formatValue(key, value)}`);
  return parts.length ? parts.join(' · ') : 'nenhuma mudança';
}
