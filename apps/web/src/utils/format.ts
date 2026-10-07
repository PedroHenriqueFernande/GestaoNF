export function formatTaxId(value: string | null | undefined, kind: 'PF' | 'PJ' = 'PF'): string {
  const clean = (value ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, kind === 'PF' ? 11 : 14);
  if (!clean) return '';
  if (kind === 'PF') {
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
