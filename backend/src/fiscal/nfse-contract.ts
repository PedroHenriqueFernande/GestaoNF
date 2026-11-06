import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { validateXML } from 'xmllint-wasm';
import { SignedXml } from 'xml-crypto';
import type { NfseGroup, NfseSnapshot } from './nfse.types.js';

export const NFSE_CONTRACT = 'national-homologation-20261020';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const escapeXml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const tag = (name: string, value: string | null | undefined) => value == null ? '' : `<${name}>${escapeXml(value)}</${name}>`;
const schemaNames = ['DPS_v1.01.xsd', 'NFSe_v1.01.xsd', 'tiposComplexos_v1.01.xsd', 'tiposSimples_v1.01.xsd', 'xmldsig-core-schema.xsd'];
let schemas: Promise<Array<{ fileName: string; contents: string }>> | undefined;
type OfficialService = { name: string; specificGroup: string; incidenceAt: 'PROVIDER' | 'PERFORMANCE' | 'CUSTOMER' | 'UNKNOWN' };
const officialServices = JSON.parse(readFileSync(new URL('./contracts/homologation-20261020/services.json', import.meta.url), 'utf8')) as Record<string, OfficialService>;
const officialNbsCodes = new Set(JSON.parse(readFileSync(new URL('./contracts/homologation-20261020/nbs-codes.json', import.meta.url), 'utf8')) as string[]);
export const officialService = (code: string) => officialServices[code];
export const isOfficialNbsCode = (code: string) => officialNbsCodes.has(code);

export function dpsIdentifier(municipality: string, taxId: string, series: number, number: string) {
  if (!/^\d{7}$/.test(municipality) || !/^[A-Z0-9]{12}\d{2}$/.test(taxId) || !/^[1-9]\d{0,14}$/.test(number)) throw new Error('Identidade fiscal inválida.');
  return `DPS${municipality}2${taxId}${String(series).padStart(5, '0')}${number.padStart(15, '0')}`;
}

export function buildDps(snapshot: NfseSnapshot, group: NfseGroup, number: string, issuedAt: string) {
  const { issuer, customer, series } = snapshot;
  if (!series || !issuer.taxId || !issuer.cityIbgeCode || !customer.taxId || !group.nationalTaxCode || !group.municipalityIbgeCode) throw new Error('Dados insuficientes para gerar a DPS.');
  const issuedDate = new Date(issuedAt);
  if (Number.isNaN(issuedDate.valueOf())) throw new Error('Data de emissao invalida.');
  const fiscalIssuedAt = issuedDate.toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const id = dpsIdentifier(issuer.cityIbgeCode, issuer.taxId, series.number, number);
  const address = customer.cityIbgeCode && customer.postalCode && customer.street && customer.number && customer.district
    ? `<end><endNac>${tag('cMun', customer.cityIbgeCode)}${tag('CEP', customer.postalCode)}</endNac>${tag('xLgr', customer.street)}${tag('nro', customer.number)}${tag('xBairro', customer.district)}</end>` : '';
  const input = snapshot.input;
  const totalTax = snapshot.simplesOption === '2' ? tag('indTotTrib', '0') : tag('pTotTribSN', input.simplesTotalTaxPercent);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><DPS xmlns="http://www.sped.fazenda.gov.br/nfse" versao="1.01"><infDPS Id="${id}">${tag('tpAmb', snapshot.environment === 'HOMOLOGATION' ? '2' : '1')}${tag('dhEmi', fiscalIssuedAt)}${tag('verAplic', 'GestaoNF-1.0')}${tag('serie', String(series.number))}${tag('nDPS', number)}${tag('dCompet', group.competence)}${tag('tpEmit', '1')}${tag('finNFSe', '0')}${tag('cLocEmi', issuer.cityIbgeCode)}<prest>${tag('CNPJ', issuer.taxId)}${snapshot.simplesOption === '2' ? '' : tag('IM', issuer.municipalRegistration)}<regTrib>${tag('opSimpNac', snapshot.simplesOption)}${snapshot.simplesOption === '3' ? tag('regApTribSN', snapshot.simplesTaxationRegime) : ''}${tag('regEspTrib', snapshot.specialTaxRegime)}</regTrib></prest><toma>${tag(customer.taxId.length === 11 ? 'CPF' : 'CNPJ', customer.taxId)}${tag('xNome', customer.name)}${address}${tag('email', customer.email)}</toma><serv><locPrest>${tag('cLocPrestacao', group.municipalityIbgeCode)}</locPrest><cServ>${tag('cTribNac', group.nationalTaxCode)}${snapshot.simplesOption === '2' ? '' : tag('cTribMun', group.municipalTaxCode)}${tag('cNBS', group.nbsCode)}${tag('xDescServ', group.description)}</cServ></serv><valores><vServPrest>${tag('vServ', group.grossAmount)}</vServPrest>${group.discountAmount === '0.00' ? '' : `<vDescCondIncond>${tag('vDescIncond', group.discountAmount)}</vDescCondIncond>`}<trib><tribMun>${tag('tribISSQN', '1')}${tag('tpRetISSQN', '1')}</tribMun><totTrib>${totalTax}</totTrib></trib></valores></infDPS></DPS>`;
  return { id, xml };
}

export async function validateFiscalXml(xml: string, kind: 'DPS' | 'NFSe' = 'DPS') {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML fiscal inválido ou acima do limite.');
  schemas ??= Promise.all(schemaNames.map(async fileName => ({ fileName, contents: await readFile(new URL(`./contracts/homologation-20261020/${fileName}`, import.meta.url), 'utf8') })));
  const all = await schemas;
  const result = await validateXML({ xml: [{ fileName: `${kind}.xml`, contents: xml }], schema: [all.find(s => s.fileName === `${kind}_v1.01.xsd`)!], preload: all, maxMemoryPages: 1024 });
  return { valid: result.valid, errors: result.errors.slice(0, 8).map(e => e.message.slice(0, 700)) };
}

export function signDps(xml: string, key: string, cert: string, profile: 'RSA_SHA1' | 'RSA_SHA256') {
  const sha1 = profile === 'RSA_SHA1';
  const signature = new SignedXml({ privateKey: key, publicCert: cert, signatureAlgorithm: sha1 ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1' : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256', canonicalizationAlgorithm: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315' });
  signature.addReference({ xpath: "//*[local-name(.)='infDPS']", transforms: ['http://www.w3.org/2000/09/xmldsig#enveloped-signature', 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315'], digestAlgorithm: sha1 ? 'http://www.w3.org/2000/09/xmldsig#sha1' : 'http://www.w3.org/2001/04/xmlenc#sha256' });
  signature.computeSignature(xml, { location: { reference: "//*[local-name(.)='infDPS']", action: 'after' } });
  const signed = signature.getSignedXml();
  const document = parseFiscalXml(signed);
  const node = document.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  const verifier = new SignedXml({ publicCert: cert, getCertFromKeyInfo: () => null });
  verifier.loadSignature(node.toString());
  if (!verifier.checkSignature(signed) || verifier.getSignedReferences().length !== 1) throw new Error('Falha na conferência da assinatura da DPS.');
  return signed;
}

export function parseFiscalXml(xml: string) {
  if (Buffer.byteLength(xml) > 2 * 1024 * 1024 || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('XML fiscal inválido.');
  return new DOMParser({ onError: level => { if (level !== 'warning') throw new Error('XML fiscal malformado.'); } }).parseFromString(xml, 'application/xml');
}
