import type { RoleLabel } from '@gestaonf/permissions';
export function formatTaxId(value: string | null | undefined, kind?: 'PF' | 'PJ' | null): string {
  const normalized = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const resolvedKind = kind ?? (normalized.length > 11 || /[A-Z]/.test(normalized) ? 'PJ' : 'PF');
  const clean = normalized.slice(0, resolvedKind === 'PF' ? 11 : 14);
  if (!clean) return '';
  if (resolvedKind === 'PF') {
    return clean.replace(/^(\d{3})(\d)/, '$1.$2').replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3').replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return clean.replace(/^(.{2})(.)/, '$1.$2').replace(/^(.{2})\.(.{3})(.)/, '$1.$2.$3')
    .replace(/^(.{2})\.(.{3})\.(.{3})(.)/, '$1.$2.$3/$4').replace(/\/(.{4})(.{1,2})$/, '/$1-$2');
}

export function formatPhone(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  const prefixLength = rest.length > 8 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, prefixLength)}-${rest.slice(prefixLength)}`;
}

export function formatPostalCode(value: string | null | undefined): string {
  const digits = (value ?? '').replace(/\D/g, '').slice(0, 8);
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return `${parts[0]?.[0] ?? ''}${parts.length > 1 ? parts.at(-1)?.[0] ?? '' : ''}`.toUpperCase();
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value));
}

const COMPANY_ROLE_LABELS: Record<RoleLabel, string> = { OWNER: 'Proprietário', MANAGER: 'Gerente', COLLABORATOR: 'Colaborador' };

export function companyRoleLabel(role: string | null | undefined): string {
  return role && role in COMPANY_ROLE_LABELS ? COMPANY_ROLE_LABELS[role as RoleLabel] : 'Usuário';
}

/** Rótulo de apresentação do vínculo do usuário com uma empresa (fora da lista de apresentação, telas usam isto e não o campo). */
export const companyRoleOf = (company: { roleLabel: RoleLabel }): string => companyRoleLabel(company.roleLabel);
