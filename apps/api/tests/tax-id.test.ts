import { describe, expect, it } from 'vitest';
import { isValidCnpj, isValidCpf } from '../src/customers/tax-id.js';

describe('documentos brasileiros', () => {
  it('valida CPF e rejeita sequência repetida', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(isValidCpf('52998224726')).toBe(false);
    expect(isValidCpf('11111111111')).toBe(false);
  });

  it('valida CNPJ alfanumérico de exemplo da Receita Federal', () => {
    expect(isValidCnpj('00000000E08G12')).toBe(true);
    expect(isValidCnpj('00000000E08G13')).toBe(false);
    expect(isValidCnpj('00000000000000')).toBe(false);
  });
});
