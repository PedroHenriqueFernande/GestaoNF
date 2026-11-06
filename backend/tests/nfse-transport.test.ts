import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { classifyResponse, nationalErrors } from '../src/fiscal/nfse-national.client.js';
import { createConfirmedSale, createIsolatedDatabase, createWorld, fiscalServices, governmentEventResponse, officialNfseResponse, previewAndEmit, seedEmission, type TestDb } from './nfse-fixtures.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

describe('leitura dos erros do ambiente nacional', () => {
  it('aceita erros em formatos diferentes', () => {
    expect(nationalErrors({ erros: [{ codigo: 'E0010', descricao: 'Série inválida', complemento: 'faixa 1-49999' }] })).toBe('E0010 — Série inválida — faixa 1-49999');
    expect(nationalErrors({ erro: [{ codigo: 'E0014', descricao: 'Duplicada' }] })).toBe('E0014 — Duplicada');
    expect(nationalErrors({ Erros: [{ Codigo: 'E0008', Descricao: 'Data de emissão' }] })).toBe('E0008 — Data de emissão');
    expect(nationalErrors({ erro: { codigo: 'E999', descricao: 'Erro não catalogado' } })).toBe('E999 — Erro não catalogado');
    expect(nationalErrors({ errors: ['primeiro', 'segundo'] })).toBe('primeiro\nsegundo');
  });

  it('usa mensagens genéricas quando não há lista de erros', () => {
    expect(nationalErrors({ mensagem: 'Requisição inválida' })).toBe('Requisição inválida');
    expect(nationalErrors({ title: 'Bad Request', detail: 'Corpo ilegível' })).toBe('Bad Request — Corpo ilegível');
  });

  it('descreve item desconhecido em vez de descartá-lo e limita o tamanho', () => {
    expect(nationalErrors({ erros: [{ x: 1 }] })).toBe('{"x":1}');
    expect(nationalErrors({ erros: Array.from({ length: 30 }, (_, i) => ({ codigo: `E${i}`, descricao: 'd' })) })!.split('\n')).toHaveLength(12);
    expect(nationalErrors({ foo: 'bar' })).toBeNull();
  });
});

describe('classificação da resposta HTTP', () => {
  it.each([[400, 'REJECTED'], [422, 'REJECTED'], [401, 'NOT_PROCESSED'], [403, 'NOT_PROCESSED'], [404, 'NOT_PROCESSED'],
    [408, 'UNCERTAIN'], [409, 'UNCERTAIN'], [429, 'UNCERTAIN'], [500, 'UNCERTAIN'], [502, 'UNCERTAIN'], [503, 'UNCERTAIN']] as const)('HTTP %i é %s', (status, expected) => {
    expect(classifyResponse(status)).toBe(expected);
  });
});

describe('processamento diante de respostas do governo', () => {
  let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;
  let db: TestDb;
  let world: Awaited<ReturnType<typeof createWorld>>;
  let saleId: string;
  type Call = NonNullable<Parameters<typeof fiscalServices>[2]>;
  const posts: string[] = [];

  beforeAll(async () => { isolated = await createIsolatedDatabase('nfse_transport'); db = isolated.db; }, 60_000);
  afterAll(async () => { await isolated?.drop(); }, 30_000);
  beforeEach(async () => { posts.length = 0; world = await createWorld(db); saleId = (await createConfirmedSale(db, world)).id; }, 30_000);
  const salesFor = async (id: string) => (await import('./nfse-fixtures.js')).salesService(db).get(world.company, id);
  const dpsOf = async (emissionId: string) => (await db.select().from(s.nfseDps).where(eq(s.nfseDps.emissionId, emissionId)))[0];

  it('400 com erro em formato alternativo vira rejeição legível', async () => {
    const call: Call = async () => ({ status: 400, body: { erro: [{ codigo: 'E0010', descricao: 'Série fora da faixa' }] } });
    const services = fiscalServices(db, world, call);
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    expect(await dpsOf(emission.id)).toMatchObject({ status: 'REJECTED' });
    expect((await dpsOf(emission.id)).lastError).toContain('E0010 — Série fora da faixa');
  });

  it('400 com corpo desconhecido também é rejeição, guardando o texto cru', async () => {
    const call: Call = async () => ({ status: 400, body: { foo: 'bar' } });
    const services = fiscalServices(db, world, call);
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    await services.processor.process(world.company, dps.id);
    const row = await dpsOf(emission.id);
    expect(row.status).toBe('REJECTED');
    expect(row.lastError).toContain('HTTP 400');
    expect(row.lastError).toContain('"foo":"bar"');
  });

  it('rejeição não trava a série: a próxima DPS é processada', async () => {
    let first = true;
    const call: Call = async (_m, _p, xml) => { if (first) { first = false; return { status: 400, body: { foo: 'bar' } }; } return officialNfseResponse(xml!); };
    const services = fiscalServices(db, world, call);
    const one = await previewAndEmit(services, world, saleId);
    await services.processor.process(world.company, (await dpsOf(one.id)).id);
    const two = await previewAndEmit(services, world, saleId);
    expect(await services.processor.process(world.company, (await dpsOf(two.id)).id)).toBe('DONE');
    expect(await dpsOf(two.id)).toMatchObject({ status: 'AUTHORIZED' });
  });

  it('403 (URL ou certificado recusados) volta para READY e pode ser retomada sem consultar', async () => {
    let refused = true;
    const call: Call = async (method, _path, xml) => { posts.push(method); return refused ? { status: 403, body: {} } : officialNfseResponse(xml!); };
    const services = fiscalServices(db, world, call);
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    const row = await dpsOf(emission.id);
    expect(row).toMatchObject({ status: 'READY', sentAt: null });
    expect(row.lastError).toMatch(/HTTP 403/);
    expect(row.lastError).toMatch(/Retomar processamento/);
    expect(row.signedXml).toBeTruthy();
    refused = false;
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    expect(posts).toEqual(['POST', 'POST']);
    expect(await dpsOf(emission.id)).toMatchObject({ status: 'AUTHORIZED' });
    const attempts = await db.select().from(s.nfseTransmissionAttempts).where(eq(s.nfseTransmissionAttempts.dpsId, dps.id));
    expect(attempts.map(a => a.operation)).toEqual(['SEND', 'SEND']);
  });

  it('404 no envio (caminho base errado) também não deixa a DPS em consulta eterna', async () => {
    const services = fiscalServices(db, world, async () => ({ status: 404, body: {} }));
    const emission = await previewAndEmit(services, world, saleId);
    await services.processor.process(world.company, (await dpsOf(emission.id)).id);
    expect(await dpsOf(emission.id)).toMatchObject({ status: 'READY', sentAt: null });
  });

  it('NFS-e autorizada que diverge do XSD local é gravada com aviso, não perdida', async () => {
    const services = fiscalServices(db, world, async (_m, _p, xml) => officialNfseResponse(xml!, { unknownField: true }));
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    expect(await dpsOf(emission.id)).toMatchObject({ status: 'AUTHORIZED' });
    const [document] = await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.dpsId, dps.id));
    expect(document.officialXml).toContain('<campoNovo>valor</campoNovo>');
    const warnings = (await db.select().from(s.nfseEvents).where(eq(s.nfseEvents.dpsId, dps.id))).filter(e => e.action === 'SCHEMA_WARNING');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/esquema/i);
    expect(warnings[0].message).toContain('campoNovo');
  });

  it('retorno de outra DPS continua sendo recusado, mesmo com o aviso de esquema', async () => {
    let n = 0;
    const call: Call = async (_m, _p, xml) => { const answer = await officialNfseResponse(xml!, { unknownField: true }); return n++ === 0 ? { ...answer, body: { ...answer.body, nfseXmlGZipB64: Buffer.from('<NFSe xmlns="http://www.sped.fazenda.gov.br/nfse"><infNFSe Id="NFS1"/></NFSe>').toString('base64') } } : answer; };
    const services = fiscalServices(db, world, call);
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    expect(await services.processor.process(world.company, dps.id)).toBe('UNKNOWN');
    expect(await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.dpsId, dps.id))).toHaveLength(0);
  });

  it('a DPS assinada leva dhEmi com margem de 1 minuto', async () => {
    const services = fiscalServices(db, world, async (_m, _p, xml) => officialNfseResponse(xml!));
    const emission = await previewAndEmit(services, world, saleId);
    const before = Date.now();
    await services.processor.process(world.company, (await dpsOf(emission.id)).id);
    const signed = (await dpsOf(emission.id)).signedXml!;
    const issuedAt = Date.parse(/<dhEmi>([^<]+)<\/dhEmi>/.exec(signed)![1]);
    expect(before - issuedAt).toBeGreaterThanOrEqual(59_000);
    expect(before - issuedAt).toBeLessThan(5 * 60_000);
  });

  it('cancelamento recusado no gateway (403) volta para READY e é retomado depois', async () => {
    let refused = true;
    const call: Call = async (_m, _p, xml) => (refused ? { status: 403, body: {} } : governmentEventResponse(xml!));
    const services = fiscalServices(db, world, call);
    const sale = await salesFor(saleId);
    const { document } = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    const event = await services.actions.requestCancellation(world.company, world.owner, document!.id, crypto.randomUUID(), { reasonCode: '1', reasonText: 'Erro de digitação no valor do serviço' });
    expect(await services.events.process(world.company, event.id)).toBe('DONE');
    const [refusedRow] = await db.select().from(s.nfseDocumentEvents).where(eq(s.nfseDocumentEvents.id, event.id));
    expect(refusedRow).toMatchObject({ status: 'READY', sentAt: null });
    expect(refusedRow.lastError).toMatch(/HTTP 403/);
    refused = false;
    expect(await services.events.process(world.company, event.id)).toBe('DONE');
    expect((await db.select().from(s.nfseDocumentEvents).where(eq(s.nfseDocumentEvents.id, event.id)))[0].status).toBe('REGISTERED');
  });

  it('500 continua incerto: a próxima execução consulta e não reenvia', async () => {
    const calls: string[] = [];
    const call: Call = async (method) => { calls.push(method); return { status: 500, body: {} }; };
    const services = fiscalServices(db, world, call);
    const emission = await previewAndEmit(services, world, saleId);
    const dps = await dpsOf(emission.id);
    expect(await services.processor.process(world.company, dps.id)).toBe('UNKNOWN');
    expect(await dpsOf(emission.id)).toMatchObject({ status: 'UNKNOWN' });
    await services.processor.process(world.company, dps.id);
    expect(calls).toEqual(['POST', 'GET']);
  });
});
