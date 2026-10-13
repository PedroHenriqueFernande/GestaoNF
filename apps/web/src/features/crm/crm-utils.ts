import type { CrmStatus } from '../../api/client';

export const CRM_STATUSES: { value: CrmStatus; label: string; short: string }[] = [
  { value: 'NEW', label: 'Novo lead', short: 'Novos' },
  { value: 'CONTACTING', label: 'Em contato', short: 'Em contato' },
  { value: 'QUALIFIED', label: 'Qualificado', short: 'Qualificados' },
  { value: 'DISQUALIFIED', label: 'Desqualificado', short: 'Desqualificados' },
  { value: 'LOST', label: 'Perdido', short: 'Perdidos' },
  { value: 'WON', label: 'Ganho', short: 'Ganhos' },
];
export const statusLabel = (value: CrmStatus) => CRM_STATUSES.find((item) => item.value === value)?.label ?? value;
export const money = (value: string | null) => value === null ? 'A definir' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
export const shortDateTime = (value: string) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value));
export const dateOnly = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'A definir';
export const normalizeMoney = (value: string) => {
  const cleaned = value.trim().replace(/\s/g, '').replace(/^R\$/i, '');
  const normalized = cleaned.includes(',') ? cleaned.replace(/\./g, '').replace(',', '.') : cleaned;
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed.toFixed(2) : undefined;
};

