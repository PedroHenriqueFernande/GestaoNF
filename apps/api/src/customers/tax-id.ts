import { BadRequestException } from '@nestjs/common';

export function isValidCpf(value: string): boolean {
  if (!/^\d{11}$/.test(value) || /^(\d)\1{10}$/.test(value)) return false;
  const digit = (length: number) => {
    const sum = [...value.slice(0, length)].reduce((total, char, index) => total + Number(char) * (length + 1 - index), 0);
    return (sum * 10) % 11 % 10;
  };
  return digit(9) === Number(value[9]) && digit(10) === Number(value[10]);
}

export function isValidCnpj(value: string): boolean {
  if (!/^[A-Z0-9]{12}\d{2}$/.test(value) || /^(\d)\1{13}$/.test(value)) return false;
  const digit = (length: number) => {
    let weight = 2;
    let sum = 0;
    for (let index = length - 1; index >= 0; index--) {
      sum += (value.charCodeAt(index) - 48) * weight;
      weight = weight === 9 ? 2 : weight + 1;
    }
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  return digit(12) === Number(value[12]) && digit(13) === Number(value[13]);
}

export function validateCustomerTaxId(kind: 'PF' | 'PJ', taxId: string | null | undefined, tradeName: string | null | undefined) {
  if (kind === 'PF' && tradeName) throw new BadRequestException('Nome fantasia só é permitido para pessoa jurídica');
  if (taxId && (kind === 'PF' ? !isValidCpf(taxId) : !isValidCnpj(taxId))) {
    throw new BadRequestException(kind === 'PF' ? 'CPF inválido' : 'CNPJ inválido');
  }
}
