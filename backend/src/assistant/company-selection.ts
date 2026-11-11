// backend/src/assistant/company-selection.ts
import type { OutboundButton } from '../whatsapp/meta-cloud.client.js';

export type CompanyOption = { companyId: string; companyLinkId: string; name: string };
export const COMPANY_BUTTON_PREFIX = 'nero:company:';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

export function companyQuestion(options: CompanyOption[]): { body: string; buttons?: OutboundButton[] } {
  // A Meta rejeita botões com título repetido: se os títulos truncados colidirem, cai na lista numerada.
  const titles = options.map((option) => option.name.slice(0, 20).trim().toLowerCase());
  if (options.length <= 3 && new Set(titles).size === titles.length) {
    return { body: 'Para qual empresa?', buttons: options.map((option) => ({ id: `${COMPANY_BUTTON_PREFIX}${option.companyLinkId}`, title: option.name.slice(0, 20) })) };
  }
  return { body: ['Para qual empresa?', '', ...options.map((option, index) => `${index + 1} — ${option.name}`), '', 'Responda com o número.'].join('\n') };
}

export function findCompanyByName(options: CompanyOption[], name: string | null) {
  if (!name) return null;
  const matches = options.filter((option) => normalize(option.name) === normalize(name));
  return matches.length === 1 ? matches[0] : null;
}

export function resolveCompany(options: CompanyOption[], input: { text: string | null; buttonId: string | null }) {
  if (input.buttonId?.startsWith(COMPANY_BUTTON_PREFIX)) {
    const linkId = input.buttonId.slice(COMPANY_BUTTON_PREFIX.length);
    return options.find((option) => option.companyLinkId === linkId) ?? null;
  }
  const text = input.text?.trim() ?? '';
  const number = text.match(/^(?:op[cç][aã]o\s+)?([1-9]\d*)[.)]?$/i);
  if (number) return options[Number(number[1]) - 1] ?? null;
  return findCompanyByName(options, text);
}
