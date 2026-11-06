import { parseFiscalXml, signXml, tag, validateFiscalXml, type SignatureProfile } from './nfse-contract.js';

/** Event contract for the national NFS-e (pedRegEvento / evento v1.01, Produção Restrita 20261020). */
export const NFSE_NS = 'http://www.sped.fazenda.gov.br/nfse';
export const CANCELLATION_EVENT = '101101';
export const SUBSTITUTION_CANCELLATION_EVENT = '105102';
export const CANCELLATION_REASONS = ['1', '2', '9'] as const;
export type CancellationReason = typeof CANCELLATION_REASONS[number];

export function eventIdentifier(accessKey: string, eventType: string = CANCELLATION_EVENT) {
  // TSIdPedRegEvt: "PRE" + chave de acesso (50) + código do evento (6) = 59 caracteres.
  if (!/^\d{8}[12][0-9A-Z]{14}\d{27}$/.test(accessKey) || !/^\d{6}$/.test(eventType)) throw new Error('Chave de acesso inválida para o pedido de evento.');
  return `PRE${accessKey}${eventType}`;
}

export function fiscalTimestamp(at: Date) {
  if (Number.isNaN(at.valueOf())) throw new Error('Data do evento inválida.');
  return at.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function buildCancellationRequest(input: { accessKey: string; authorTaxId: string; reasonCode: CancellationReason; reasonText: string; environment: 'HOMOLOGATION' | 'PRODUCTION'; at: Date }) {
  const reasonText = input.reasonText.trim();
  if (!CANCELLATION_REASONS.includes(input.reasonCode)) throw new Error('Motivo de cancelamento inválido.');
  if (reasonText.length < 15 || reasonText.length > 255) throw new Error('A justificativa do cancelamento deve ter de 15 a 255 caracteres.');
  if (!/^[0-9A-Z]{14}$/.test(input.authorTaxId)) throw new Error('CNPJ do autor do evento inválido.');
  const id = eventIdentifier(input.accessKey);
  return `<?xml version="1.0" encoding="UTF-8"?><pedRegEvento xmlns="${NFSE_NS}" versao="1.01"><infPedReg Id="${id}">${tag('tpAmb', input.environment === 'HOMOLOGATION' ? '2' : '1')}${tag('verAplic', 'GestaoNF-1.0')}${tag('dhEvento', fiscalTimestamp(input.at))}${tag('CNPJAutor', input.authorTaxId)}${tag('chNFSe', input.accessKey)}<e101101>${tag('xDesc', 'Cancelamento de NFS-e')}${tag('cMotivo', input.reasonCode)}${tag('xMotivo', reasonText)}</e101101></infPedReg></pedRegEvento>`;
}

export function signEvent(xml: string, key: string, cert: string, profile: SignatureProfile) {
  return signXml(xml, 'infPedReg', key, cert, profile);
}

export function validateEventXml(xml: string, kind: 'pedRegEvento' | 'evento') {
  return validateFiscalXml(xml, kind);
}

/** Reads the event returned by the national environment and checks that it answers our request. */
export function readRegisteredEvent(xml: string, expected: { accessKey: string; eventType: string; environment: 'HOMOLOGATION' | 'PRODUCTION'; authorTaxId: string }) {
  const document = parseFiscalXml(xml);
  if (document.documentElement?.localName !== 'evento' || document.documentElement?.namespaceURI !== NFSE_NS) throw new Error('O retorno não é um evento da NFS-e nacional.');
  const value = (name: string) => document.getElementsByTagNameNS(NFSE_NS, name)[0]?.textContent?.trim() ?? '';
  const request = document.getElementsByTagNameNS(NFSE_NS, 'infPedReg')[0];
  if (!request || request.getAttribute('Id') !== eventIdentifier(expected.accessKey, expected.eventType)) throw new Error('O evento retornado pertence a outra nota ou a outro tipo de evento.');
  if (value('chNFSe') !== expected.accessKey || value('tpAmb') !== (expected.environment === 'HOMOLOGATION' ? '2' : '1') || value('CNPJAutor') !== expected.authorTaxId) throw new Error('Chave, ambiente ou autor do evento divergiram do pedido.');
  if (document.getElementsByTagNameNS(NFSE_NS, `e${expected.eventType}`).length !== 1) throw new Error('O tipo do evento retornado diverge do pedido.');
  const sequence = Number(value('nSeqEvento'));
  const processedAt = new Date(value('dhProc'));
  if (!Number.isInteger(sequence) || sequence < 1 || Number.isNaN(processedAt.valueOf())) throw new Error('O evento retornado não contém sequência ou data de processamento válidas.');
  return { sequence, processedAt };
}
