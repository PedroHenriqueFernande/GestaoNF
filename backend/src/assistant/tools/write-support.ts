// backend/src/assistant/tools/write-support.ts
import { ConflictException } from '@nestjs/common';
import { money } from '../nero-format.js';
import { label } from './read-support.js';

/** Rótulos em português dos campos de cliente e serviço (chaves dos schemas de domínio). */
export const FIELD_LABELS: Record<string, string> = {
  kind: 'Tipo', name: 'Nome', tradeName: 'Nome fantasia', taxId: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', notes: 'Observações', status: 'Situação',
  street: 'Rua', number: 'Número', complement: 'Complemento', district: 'Bairro', postalCode: 'CEP', cityName: 'Cidade', cityIbgeCode: 'Código IBGE da cidade',
  stateCode: 'UF', countryCode: 'País', municipalRegistration: 'Inscrição municipal', caepfCode: 'CAEPF', foreignTaxId: 'Documento estrangeiro',
  noForeignTaxIdReason: 'Motivo sem documento estrangeiro', foreignPostalCode: 'CEP estrangeiro', foreignStateProvince: 'Estado/província estrangeiro',
  internalCode: 'Código interno', description: 'Descrição', unitLabel: 'Unidade', suggestedUnitPrice: 'Preço sugerido', nationalTaxCode: 'Código de tributação nacional',
  nbsCode: 'Código NBS', simplesActivityCode: 'Categoria da atividade no Simples Nacional',
};

const PRICE_FIELDS = new Set(['suggestedUnitPrice']);
/** Campos cujo valor vem de um código interno traduzido (início em maiúscula, como em "Tipo: Pessoa física"). */
const CODED_FIELDS = new Set(['kind', 'status']);
/** Mesmos textos das opções dos formulários de clientes e serviços. */
const FIELD_OPTIONS: Record<string, Record<string, string>> = {
  noForeignTaxIdReason: {
    '1': 'Dispensado desse documento',
    '2': 'O país não exige esse documento',
  },
  simplesActivityCode: {
    '07': 'Serviços tributados exclusivamente pelo Anexo III',
    '08': 'Contabilidade com ISS fixo no município — Anexo III',
    '09': 'Serviços sujeitos ao Fator R — Anexo III ou V',
    '10': 'Transporte municipal de passageiros — Anexo III',
    '11': 'Locação e operações sem incidência de ISS — Anexo III',
    '12': 'Construção civil — Anexo III',
    '13': 'Construção civil — Anexo IV',
    '14': 'Serviços tributados pelo Anexo IV',
    '90': 'Operações não tributadas',
  },
};

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
  if (Object.hasOwn(FIELD_OPTIONS, field)) return FIELD_OPTIONS[field][String(value)] ?? String(value);
  if (!CODED_FIELDS.has(field)) return String(value);
  const text = String(label(String(value)));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Dados normalizados que correspondem apenas aos campos pedidos pelo usuário. */
export function providedFields(saved: Record<string, unknown>, supplied: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(saved).filter(([key]) => Object.hasOwn(supplied, key)));
}

export const VERSION_CONFLICT_MESSAGE = 'Os dados deste cadastro mudaram desde o resumo. Peça uma nova proposta para conferir antes de confirmar.';

/** Chamado com a linha bloqueada por updateInTx; o erro reverte a transação inteira. */
export function assertExpectedVersion(actual: Date, expected: string | undefined) {
  if (expected !== undefined && actual.toISOString() !== expected) throw new ConflictException(VERSION_CONFLICT_MESSAGE);
}

function comparableValue(field: string, value: unknown) {
  if (PRICE_FIELDS.has(field) && typeof value === 'string' && /^\d+(?:\.\d{1,2})?$/.test(value)) {
    const [integer, fraction = ''] = value.split('.');
    return `${integer}.${fraction.padEnd(2, '0')}`;
  }
  return value ?? null;
}

/** "Nome: X · Telefone: Y" dos campos informados (ignora vazios e os campos em `skip`). */
export function describeFields(values: Record<string, unknown>, skip: string[] = []) {
  return Object.entries(values).filter(([key, value]) => !skip.includes(key) && value !== null && value !== undefined && value !== '' && FIELD_LABELS[key])
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, value)}`).join(' · ');
}

/** Só os campos que mudam: "Telefone: A → B". */
export function describeChanges(before: Record<string, unknown>, changes: Record<string, unknown>) {
  const parts = Object.entries(changes).filter(([key, value]) => FIELD_LABELS[key] && comparableValue(key, before[key]) !== comparableValue(key, value))
    .map(([key, value]) => `${FIELD_LABELS[key]}: ${formatValue(key, before[key])} → ${formatValue(key, value)}`);
  return parts.length ? parts.join(' · ') : 'nenhuma mudança';
}
