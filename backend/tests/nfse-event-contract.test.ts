import { describe, expect, it } from 'vitest';
import forge from 'node-forge';
import { buildCancellationRequest, eventIdentifier, signEvent, validateEventXml } from '../src/fiscal/nfse-event-contract.js';
import { EMISSION_SKEW_MS, buildDps, emissionTimestamp, parseFiscalXml, validateFiscalXml } from '../src/fiscal/nfse-contract.js';
import type { NfseSnapshot } from '../src/fiscal/nfse.types.js';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
// cMun(7) + ambGer(1) + tpInsc(1) + CNPJ(14) + 27 digits = 50
const accessKey = `3304557${'2'}${'2'}11222333000181${'0'.repeat(26)}1`;

function testCredential() {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000);
  cert.validity.notAfter = new Date(Date.now() + 86400000);
  const attrs = [{ name: 'commonName', value: 'GESTAONF TESTE:11222333000181' }];
  cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
}
const credential = testCredential();

const snapshot = {
  schemaVersion: 1, saleId: 's', saleVersion: 1, orderCode: 'A0001', generatedAt: '2026-11-06T12:00:00.000Z', contractVersion: 'x', environment: 'HOMOLOGATION',
  series: { id: 'series', number: 1, nextNumber: '2', version: 1 },
  issuer: { name: 'Empresa Teste', taxId: '11222333000181', email: null, street: null, number: null, district: null, cityName: 'Rio de Janeiro', cityIbgeCode: '3304557', postalCode: null, stateCode: 'RJ', municipalRegistration: null },
  customer: { name: 'Cliente Teste', taxId: '52998224725', email: null, street: null, number: null, district: null, cityName: null, cityIbgeCode: null, postalCode: null, stateCode: null, municipalRegistration: null },
  customerId: 'c', simplesOption: '2', simplesTaxationRegime: null, specialTaxRegime: '0',
  groups: [{ key: 'g', competence: '2026-11-05', municipalityIbgeCode: '3304557', nationalTaxCode: '010101', nbsCode: null, municipalTaxCode: null, description: 'Consultoria', grossAmount: '100.00', discountAmount: '0.00', totalAmount: '100.00', ruleName: null, issWithholding: false, issRatePercent: null, items: [] }],
  totalAmount: '100.00', issues: [], input: {}, certificate: null,
} as unknown as NfseSnapshot;

describe('contrato de eventos NFS-e', () => {
  it('monta o identificador do pedido de cancelamento', () => {
    const id = eventIdentifier(accessKey);
    expect(id).toBe(`PRE${accessKey}101101`);
    expect(id).toHaveLength(59);
    expect(() => eventIdentifier('123')).toThrow();
  });

  it('gera pedido de cancelamento assinado e válido pelo XSD oficial', async () => {
    const xml = buildCancellationRequest({ accessKey, authorTaxId: '11222333000181', reasonCode: '1', reasonText: 'Erro de digitação no valor do serviço', environment: 'HOMOLOGATION', at: new Date('2026-11-06T15:00:00Z') });
    const signed = signEvent(xml, credential.key, credential.cert, 'RSA_SHA256');
    const result = await validateEventXml(signed, 'pedRegEvento');
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    const doc = parseFiscalXml(signed);
    expect(doc.getElementsByTagNameNS(NS, 'infPedReg')[0].getAttribute('Id')).toBe(`PRE${accessKey}101101`);
    expect(doc.getElementsByTagNameNS(NS, 'tpAmb')[0].textContent).toBe('2');
    expect(doc.getElementsByTagNameNS(NS, 'cMotivo')[0].textContent).toBe('1');
  });

  it('recusa justificativa fora de 15 a 255 caracteres e motivo inválido', () => {
    const base = { accessKey, authorTaxId: '11222333000181', environment: 'HOMOLOGATION' as const, at: new Date() };
    expect(() => buildCancellationRequest({ ...base, reasonCode: '1', reasonText: 'curto demais..' })).toThrow();
    expect(() => buildCancellationRequest({ ...base, reasonCode: '1', reasonText: 'x'.repeat(256) })).toThrow();
    expect(() => buildCancellationRequest({ ...base, reasonCode: '5' as '1', reasonText: 'Motivo suficientemente longo' })).toThrow();
  });

  it('inclui o grupo de substituição na posição do XSD', async () => {
    const withSubst = { ...snapshot, substitution: { documentId: 'd', accessKey, reasonCode: '99', reasonText: 'Correção da descrição do serviço' } } as NfseSnapshot;
    const { xml } = buildDps(withSubst, withSubst.groups[0], '2', '2026-11-06T12:00:00.000Z');
    expect(xml).toMatch(/<cLocEmi>3304557<\/cLocEmi><subst><chSubstda>\d{50}<\/chSubstda><cMotivo>99<\/cMotivo><xMotivo>Correção da descrição do serviço<\/xMotivo><\/subst><prest>/);
    const result = await validateFiscalXml(xml);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('não inclui substituição em emissão normal', () => {
    const { xml } = buildDps(snapshot, snapshot.groups[0], '2', '2026-11-06T12:00:00.000Z');
    expect(xml).not.toContain('<subst>');
  });
});

describe('data e hora de emissão (E0008 / E0015)', () => {
  it('recua 1 minuto para absorver diferença de relógio com o governo', () => {
    const now = new Date('2026-11-06T15:00:30.000Z');
    expect(EMISSION_SKEW_MS).toBe(60_000);
    expect(emissionTimestamp(now, '2026-11-06')).toBe('2026-11-06T14:59:30.000Z');
  });

  it('não recua para o dia anterior à competência (00:00:30 em Brasília)', () => {
    const now = new Date('2026-11-06T03:00:30.000Z');
    expect(emissionTimestamp(now, '2026-11-06')).toBe(now.toISOString());
  });

  it('recua normalmente quando a competência é de dias antes', () => {
    const now = new Date('2026-11-06T03:00:30.000Z');
    expect(emissionTimestamp(now, '2026-11-01')).toBe('2026-11-06T02:59:30.000Z');
  });
});
