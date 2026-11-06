import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { saleFiscalState } from '../src/fiscal/sale-fiscal-state.js';
import { and, eq } from 'drizzle-orm';
import * as s from '@gestaonf/database/schema';
import { createConfirmedSale, createIsolatedDatabase, createWorld, emitAndAuthorize, fiscalServices, governmentEventResponse, officialNfseResponse, previewAndEmit, salesService, seedCancellationEvent, seedEmission, type TestDb } from './nfse-fixtures.js';

config({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

let isolated: Awaited<ReturnType<typeof createIsolatedDatabase>>;
let db: TestDb;
let world: Awaited<ReturnType<typeof createWorld>>;
let sale: Awaited<ReturnType<typeof createConfirmedSale>>;

beforeAll(async () => { isolated = await createIsolatedDatabase('nfse_life'); db = isolated.db; }, 60_000);
afterAll(async () => { await isolated?.drop(); }, 30_000);
beforeEach(async () => { world = await createWorld(db); sale = await createConfirmedSale(db, world); }, 30_000);

const editInput = () => ({
  customerId: sale.customerId, soldOn: sale.soldOn!, expectedVersion: sale.version,
  items: sale.items.map(i => ({ id: i.id, serviceId: i.serviceId, quantity: i.quantity, unitPrice: i.unitPrice, discountAmount: i.discountAmount })),
  installments: sale.installments.map(p => ({ id: p.id, paymentMethod: p.paymentMethod, amount: p.amount, dueOn: p.dueOn! })),
});
const canEdit = async () => { try { await salesService(db).updateConfirmed(world.company, sale.id, world.owner, editInput() as never); return true; } catch (e) { if (e instanceof ConflictException) return false; throw e; } };
const canCancel = async () => { try { await salesService(db).cancel(world.company, sale.id, world.owner, sale.version, 'Cancelamento de teste'); return true; } catch (e) { if (e instanceof ConflictException) return false; throw e; } };

describe('trava fiscal da venda', () => {
  it('sem solicitação fiscal: livre para editar e cancelar', async () => {
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ inProgress: false, canEditSale: true, canCancelSale: true, lockReason: null });
    expect(await canEdit()).toBe(true);
  });

  it('DPS em processamento trava edição, cancelamento e nova emissão', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'RESERVED', number: 1 });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ inProgress: true, canEditSale: false, canCancelSale: false });
    expect(state.lockReason).toMatch(/em andamento/i);
    expect(await canEdit()).toBe(false);
    expect(await canCancel()).toBe(false);
  });

  it('tudo rejeitado: destrava', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'REJECTED', number: 1 });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ inProgress: false, canEditSale: true, canCancelSale: true });
    expect(state.activeDocuments).toHaveLength(0);
    expect(await canEdit()).toBe(true);
  });

  it('nota autorizada trava a venda e cobre os itens', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ inProgress: false, canEditSale: false, canCancelSale: false });
    expect(state.activeDocuments).toHaveLength(1);
    expect([...state.coveredItemIds]).toEqual(sale.items.map(i => i.id));
    expect(state.lockReason).toMatch(/autorizada/i);
    expect(await canEdit()).toBe(false);
    expect(await canCancel()).toBe(false);
  });

  it('nota cancelada ou substituída libera a venda', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1, documentStatus: 'CANCELLED' });
    expect(await saleFiscalState(db, world.company, sale.id)).toMatchObject({ canEditSale: true, canCancelSale: true });
  });

  it('substituição aberta libera a edição, mas não o cancelamento da venda', async () => {
    const { document } = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1, substitutionOpen: { reasonCode: '99', reasonText: 'Correção da descrição do serviço', saleVersion: sale.version } });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ canEditSale: true, canCancelSale: false });
    expect(state.substitution).toMatchObject({ documentId: document!.id, reasonCode: '99', saleVersion: sale.version });
    expect(await canEdit()).toBe(true);
    expect(await canCancel()).toBe(false);
  });

  it('cancelamento da nota em andamento trava a venda', async () => {
    const { document } = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    await seedCancellationEvent(db, world, document!.id, 'SENDING');
    expect(await saleFiscalState(db, world.company, sale.id)).toMatchObject({ inProgress: true, canEditSale: false });
  });

  it('nota autorizada só de parte dos itens: não cobre os demais', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1, itemIds: [sale.items[0].id] });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state.coveredItemIds.has(sale.items[0].id)).toBe(true);
    expect(state.canEditSale).toBe(false);
  });

  it('não enxerga solicitações de outra empresa', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    const state = await saleFiscalState(db, world.otherCompany, sale.id);
    expect(state.activeDocuments).toHaveLength(0);
  });
});

describe('correção de rejeição', () => {
  const dpsRows = () => db.select().from(s.nfseDps).where(eq(s.nfseDps.sourceSaleId, sale.id)).orderBy(s.nfseDps.dpsNumber);

  it('primeira emissão reserva o número 1 e cria uma emissão ISSUE', async () => {
    const services = fiscalServices(db, world);
    const emission = await previewAndEmit(services, world, sale.id);
    expect(emission.items.map(i => i.number)).toEqual(['1']);
    const [row] = await db.select().from(s.nfseEmissionRequests).where(eq(s.nfseEmissionRequests.id, emission.id));
    expect(row).toMatchObject({ kind: 'ISSUE', previousEmissionId: null, substitutesDocumentId: null });
  });

  it('com tudo rejeitado, nova emissão usa número novo e liga à anterior', async () => {
    const services = fiscalServices(db, world);
    const first = await previewAndEmit(services, world, sale.id);
    await db.update(s.nfseDps).set({ status: 'REJECTED', lastError: 'E999 — código inválido' }).where(eq(s.nfseDps.sourceSaleId, sale.id));
    const second = await previewAndEmit(services, world, sale.id);
    expect(second.id).not.toBe(first.id);
    expect(second.items.map(i => i.number)).toEqual(['2']);
    const [row] = await db.select().from(s.nfseEmissionRequests).where(eq(s.nfseEmissionRequests.id, second.id));
    expect(row.previousEmissionId).toBe(first.id);
    expect((await dpsRows()).map(d => [String(d.dpsNumber), d.status])).toEqual([['1', 'REJECTED'], ['2', 'RESERVED']]);
    const [series] = await db.select().from(s.nfseSeries).where(eq(s.nfseSeries.id, world.series.id));
    expect(series.nextNumber).toBe(3n);
  });

  it('com DPS em processamento, não emite outra', async () => {
    const services = fiscalServices(db, world);
    const preview = await services.previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {});
    await services.issuance.emit(world.company, world.owner, sale.id, preview.id, crypto.randomUUID());
    await expect(services.issuance.emit(world.company, world.owner, sale.id, preview.id, crypto.randomUUID())).rejects.toMatchObject({ response: { code: 'NFSE_IN_PROGRESS' } });
    expect(await dpsRows()).toHaveLength(1);
  });

  it('com nota autorizada cobrindo tudo, bloqueia nova emissão', async () => {
    const services = fiscalServices(db, world);
    const preview = await services.previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {});
    await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    await expect(services.issuance.emit(world.company, world.owner, sale.id, preview.id, crypto.randomUUID())).rejects.toMatchObject({ response: { code: 'NFSE_ALREADY_AUTHORIZED' } });
  });

  it('rejeição parcial: a nova prévia cobre apenas os itens sem nota', async () => {
    const two = await createConfirmedSale(db, world, [{ serviceId: world.service.id, amount: '100.00' }, { serviceId: world.secondService.id, amount: '50.00' }]);
    await seedEmission(db, world, two, { dpsStatus: 'AUTHORIZED', number: 1, itemIds: [two.items[0].id] });
    const services = fiscalServices(db, world);
    const preview = await services.previews.create(world.company, world.owner, two.id, crypto.randomUUID(), {});
    expect(preview.groups).toHaveLength(1);
    expect(preview.groups[0].items.map(i => i.id)).toEqual([two.items[1].id]);
    expect(preview.totalAmount).toBe('50.00');
    expect(preview.issues.filter(i => i.severity === 'ERROR')).toEqual([]);
    const emission = await services.issuance.emit(world.company, world.owner, two.id, preview.id, crypto.randomUUID());
    expect(emission.items.map(i => i.number)).toEqual(['2']);
  });

  it('prévia de venda em processamento acusa o impedimento', async () => {
    await seedEmission(db, world, sale, { dpsStatus: 'READY', number: 1 });
    const preview = await fiscalServices(db, world).previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {});
    expect(preview.canEmit).toBe(false);
    expect(preview.issues.map(i => i.code)).toContain('NFSE_IN_PROGRESS');
  });
});

describe('cancelamento', () => {
  const reason = { reasonCode: '1' as const, reasonText: 'Erro de digitação no valor do serviço' };
  const calls: Array<{ method: string; path: string }> = [];
  type Call = NonNullable<Parameters<typeof fiscalServices>[2]>;
  async function authorized() {
    const { document } = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    return document!;
  }
  const documentRow = async (id: string) => (await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.id, id)))[0];
  const eventRows = async (documentId: string) => db.select().from(s.nfseDocumentEvents).where(eq(s.nfseDocumentEvents.documentId, documentId)).orderBy(s.nfseDocumentEvents.createdAt);
  const registers: Call = async (method, path, xml) => { calls.push({ method, path }); return governmentEventResponse(xml!); };
  beforeEach(() => { calls.length = 0; });

  it('pedido é idempotente e recusa a mesma chave com outros dados', async () => {
    const document = await authorized();
    const { actions } = fiscalServices(db, world);
    const key = crypto.randomUUID();
    const first = await actions.requestCancellation(world.company, world.owner, document.id, key, reason);
    const again = await actions.requestCancellation(world.company, world.owner, document.id, key, reason);
    expect(again.id).toBe(first.id);
    expect(first).toMatchObject({ status: 'PENDING', eventType: '101101', reasonCode: '1' });
    await expect(actions.requestCancellation(world.company, world.owner, document.id, key, { ...reason, reasonCode: '2' })).rejects.toBeInstanceOf(ConflictException);
    expect(await eventRows(document.id)).toHaveLength(1);
    const outbox = await db.select().from(s.integrationOutbox).where(eq(s.integrationOutbox.topic, 'nfse.event'));
    expect(outbox.filter(o => o.aggregateId === first.id)).toHaveLength(1);
  });

  it('dois pedidos concorrentes resultam em um único evento ativo', async () => {
    const document = await authorized();
    const { actions } = fiscalServices(db, world);
    const results = await Promise.allSettled([1, 2].map(() => actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason)));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(await eventRows(document.id)).toHaveLength(1);
  });

  it('worker registra o cancelamento: nota CANCELLED e venda destravada', async () => {
    const document = await authorized();
    const services = fiscalServices(db, world, registers);
    const event = await services.actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason);
    expect(await services.events.process(world.company, event.id)).toBe('DONE');
    const [row] = await eventRows(document.id);
    expect(row).toMatchObject({ status: 'REGISTERED', sequenceNumber: 1, leaseToken: null });
    expect(row.signedXml).toContain('<e101101>');
    expect(row.officialXml).toContain('<evento');
    expect(await documentRow(document.id)).toMatchObject({ status: 'CANCELLED' });
    expect((await documentRow(document.id)).cancelledAt).toBeInstanceOf(Date);
    expect(calls).toEqual([{ method: 'POST', path: `/nfse/${document.accessKey}/eventos` }]);
    expect(await saleFiscalState(db, world.company, sale.id)).toMatchObject({ canEditSale: true, canCancelSale: true });
    const attempts = await db.select().from(s.nfseTransmissionAttempts).where(eq(s.nfseTransmissionAttempts.documentEventId, event.id));
    expect(attempts.map(a => [a.operation, a.outcome])).toEqual([['SEND_EVENT', 'RECEIVED']]);
    const audit = await db.select().from(s.nfseEvents).where(eq(s.nfseEvents.companyId, world.company));
    expect(audit.map(a => a.action)).toEqual(expect.arrayContaining(['CANCEL_SIGNED', 'CANCEL_SENDING', 'CANCELLED']));
  });

  it('recusa do governo mantém a nota ativa e permite novo pedido', async () => {
    const document = await authorized();
    const refuses: Call = async () => ({ status: 400, body: { erros: [{ codigo: 'E0840', descricao: 'Prazo de cancelamento expirado' }] } });
    const services = fiscalServices(db, world, refuses);
    const event = await services.actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason);
    expect(await services.events.process(world.company, event.id)).toBe('DONE');
    const [row] = await eventRows(document.id);
    expect(row.status).toBe('REJECTED');
    expect(row.lastError).toContain('Prazo de cancelamento expirado');
    expect(await documentRow(document.id)).toMatchObject({ status: 'AUTHORIZED' });
    await services.actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason);
    expect(await eventRows(document.id)).toHaveLength(2);
  });

  it('resultado incerto é consultado e nunca reenviado', async () => {
    const document = await authorized();
    let signed = '';
    const flaky: Call = async (method, path, xml) => {
      calls.push({ method, path });
      if (method === 'POST') { signed = xml!; throw new Error('socket hang up'); }
      return governmentEventResponse(signed);
    };
    const services = fiscalServices(db, world, flaky);
    const event = await services.actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason);
    expect(await services.events.process(world.company, event.id)).toBe('UNKNOWN');
    expect((await eventRows(document.id))[0].status).toBe('UNKNOWN');
    expect(await documentRow(document.id)).toMatchObject({ status: 'AUTHORIZED' });
    expect(await services.events.process(world.company, event.id)).toBe('DONE');
    expect((await eventRows(document.id))[0].status).toBe('REGISTERED');
    expect(await documentRow(document.id)).toMatchObject({ status: 'CANCELLED' });
    expect(calls.map(c => c.method)).toEqual(['POST', 'GET']);
    expect(calls[1].path).toBe(`/nfse/${document.accessKey}/eventos/101101`);
  });

  it('exige nota ativa e sem DPS em processamento', async () => {
    const { actions } = fiscalServices(db, world);
    const cancelled = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1, documentStatus: 'CANCELLED' });
    await expect(actions.requestCancellation(world.company, world.owner, cancelled.document!.id, crypto.randomUUID(), reason)).rejects.toMatchObject({ response: { code: 'NFSE_NOT_ACTIVE' } });
    const active = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 2 });
    await seedEmission(db, world, sale, { dpsStatus: 'RESERVED', number: 3 });
    await expect(actions.requestCancellation(world.company, world.owner, active.document!.id, crypto.randomUUID(), reason)).rejects.toMatchObject({ response: { code: 'NFSE_IN_PROGRESS' } });
  });

  it('não permite a outra empresa enxergar ou cancelar a nota', async () => {
    const document = await authorized();
    const { actions } = fiscalServices(db, world);
    await expect(actions.requestCancellation(world.otherCompany, world.other, document.id, crypto.randomUUID(), reason)).rejects.toBeInstanceOf(NotFoundException);
    const event = await actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), reason);
    await expect(actions.getEvent(world.otherCompany, event.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('substituição', () => {
  const reason = { reasonCode: '99' as const, reasonText: 'Correção da descrição do serviço prestado' };
  type Call = NonNullable<Parameters<typeof fiscalServices>[2]>;
  const accepts: Call = async (method, _path, xml) => { if (method !== 'POST') throw new Error('consulta inesperada'); return officialNfseResponse(xml!); };
  const docRow = async (id: string) => (await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.id, id)))[0];
  const emissions = () => db.select().from(s.nfseEmissionRequests).where(eq(s.nfseEmissionRequests.saleId, sale.id)).orderBy(s.nfseEmissionRequests.createdAt);

  /** Edits the description of the (single) item through the real sale service. */
  async function editDescription(description: string, serviceId?: string) {
    const current = await salesService(db).get(world.company, sale.id);
    await salesService(db).updateConfirmed(world.company, sale.id, world.owner, {
      customerId: current.customerId, soldOn: current.soldOn!, expectedVersion: current.version,
      items: current.items.map(i => ({ id: i.id, serviceId: serviceId ?? i.serviceId, quantity: i.quantity, unitPrice: i.unitPrice, discountAmount: i.discountAmount, description })),
      installments: current.installments.map(p => ({ id: p.id, paymentMethod: p.paymentMethod, amount: p.amount, dueOn: p.dueOn! })),
    } as never);
  }

  it('abrir a substituição destrava a venda e registra o motivo', async () => {
    const services = fiscalServices(db, world, accepts);
    const { document } = await emitAndAuthorize(services, world, sale.id);
    expect(await saleFiscalState(db, world.company, sale.id)).toMatchObject({ canEditSale: false });
    const opened = await services.actions.openSubstitution(world.company, world.owner, document.id, reason);
    expect(opened).toMatchObject({ reasonCode: '99', reasonText: reason.reasonText, saleVersion: sale.version });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ canEditSale: true, canCancelSale: false });
    expect(state.substitution?.documentId).toBe(document.id);
    await expect(services.actions.openSubstitution(world.company, world.owner, document.id, reason)).rejects.toMatchObject({ response: { code: 'SUBSTITUTION_ALREADY_OPEN' } });
  });

  it('fluxo completo: edita, emite a substituta e a original passa a SUBSTITUTED', async () => {
    const services = fiscalServices(db, world, accepts);
    const first = await emitAndAuthorize(services, world, sale.id);
    expect(first.outcome).toBe('DONE');
    expect(first.document.status).toBe('AUTHORIZED');
    await services.actions.openSubstitution(world.company, world.owner, first.document.id, reason);
    await editDescription('Consultoria estratégica — descrição corrigida');
    const preview = await services.previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {});
    expect(preview.substitution).toMatchObject({ documentId: first.document.id, accessKey: first.document.accessKey, reasonCode: '99' });
    expect(preview.issues.filter(i => i.severity === 'ERROR')).toEqual([]);
    expect(preview.groups).toHaveLength(1);
    const emission = await services.issuance.emit(world.company, world.owner, sale.id, preview.id, crypto.randomUUID());
    const [row] = await db.select().from(s.nfseEmissionRequests).where(eq(s.nfseEmissionRequests.id, emission.id));
    expect(row).toMatchObject({ kind: 'SUBSTITUTION', substitutesDocumentId: first.document.id, previousEmissionId: first.emission.id });
    const [dps] = await db.select().from(s.nfseDps).where(eq(s.nfseDps.emissionId, emission.id));
    expect(dps.signedXml ?? '').toBe('');
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    const [signedDps] = await db.select({ x: s.nfseDps.signedXml }).from(s.nfseDps).where(eq(s.nfseDps.id, dps.id));
    expect(signedDps.x).toContain(`<chSubstda>${first.document.accessKey}</chSubstda><cMotivo>99</cMotivo>`);
    const original = await docRow(first.document.id);
    expect(original).toMatchObject({ status: 'SUBSTITUTED', substitutionReasonCode: null, substitutionSaleVersion: null });
    const [replacement] = await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.dpsId, dps.id));
    expect(replacement).toMatchObject({ status: 'AUTHORIZED' });
    expect(original.substitutedByDocumentId).toBe(replacement.id);
    expect(original.substitutedAt).toBeInstanceOf(Date);
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state.activeDocuments.map(d => d.id)).toEqual([replacement.id]);
    expect(state.canEditSale).toBe(false);
    expect((await emissions()).map(e => e.kind)).toEqual(['ISSUE', 'SUBSTITUTION']);
  });

  it('substituta rejeitada mantém a original válida e a substituição aberta', async () => {
    const refuses: Call = async (method, path, xml) => (method === 'POST' && calls === 0 ? (calls++, officialNfseResponse(xml!)) : { status: 400, body: { erros: [{ codigo: 'E1234', descricao: 'Descrição inválida' }] } });
    let calls = 0;
    const services = fiscalServices(db, world, refuses);
    const first = await emitAndAuthorize(services, world, sale.id);
    await services.actions.openSubstitution(world.company, world.owner, first.document.id, reason);
    await editDescription('Descrição que o governo vai recusar');
    const second = await previewAndEmit(services, world, sale.id);
    const [dps] = await db.select().from(s.nfseDps).where(eq(s.nfseDps.emissionId, second.id));
    expect(await services.processor.process(world.company, dps.id)).toBe('DONE');
    expect((await db.select().from(s.nfseDps).where(eq(s.nfseDps.id, dps.id)))[0]).toMatchObject({ status: 'REJECTED' });
    expect(await docRow(first.document.id)).toMatchObject({ status: 'AUTHORIZED', substitutionReasonCode: '99' });
    const state = await saleFiscalState(db, world.company, sale.id);
    expect(state).toMatchObject({ canEditSale: true, inProgress: false });
    expect(state.substitution?.documentId).toBe(first.document.id);
    // The user can correct and try again with a fresh number.
    const third = await previewAndEmit(services, world, sale.id);
    expect(third.items.map(i => i.number)).toEqual(['3']);
  });

  it('retorno que não referencia a nota substituída não altera a original', async () => {
    let calls = 0;
    const wrong: Call = async (_method, _path, xml) => (calls++ === 0 ? officialNfseResponse(xml!) : officialNfseResponse(xml!, { substitutedKey: `${'3304557'}22${world.issuerTaxId}${'9'.repeat(27)}` }));
    const services = fiscalServices(db, world, wrong);
    const first = await emitAndAuthorize(services, world, sale.id);
    await services.actions.openSubstitution(world.company, world.owner, first.document.id, reason);
    await editDescription('Descrição nova da prestação de serviços');
    const second = await previewAndEmit(services, world, sale.id);
    const [dps] = await db.select().from(s.nfseDps).where(eq(s.nfseDps.emissionId, second.id));
    expect(await services.processor.process(world.company, dps.id)).toBe('UNKNOWN');
    const [after] = await db.select().from(s.nfseDps).where(eq(s.nfseDps.id, dps.id));
    expect(after.lastError).toMatch(/não referencia a nota substituída/);
    expect(await docRow(first.document.id)).toMatchObject({ status: 'AUTHORIZED' });
    expect(await db.select().from(s.nfseDocuments).where(eq(s.nfseDocuments.dpsId, dps.id))).toHaveLength(0);
  });

  it('desistir: permitido com a venda igual, mesmo após editar e desfazer; bloqueado se ela mudou', async () => {
    const services = fiscalServices(db, world, accepts);
    const { document } = await emitAndAuthorize(services, world, sale.id);
    await services.actions.openSubstitution(world.company, world.owner, document.id, reason);
    const original = (await salesService(db).get(world.company, sale.id)).items[0].descriptionSnapshot ?? null;
    await editDescription('Outra descrição qualquer da venda');
    await expect(services.actions.discardSubstitution(world.company, world.owner, document.id)).rejects.toMatchObject({ response: { code: 'SALE_CHANGED' } });
    expect(await docRow(document.id)).toMatchObject({ substitutionReasonCode: '99' });
    await editDescription(original as string);
    await services.actions.discardSubstitution(world.company, world.owner, document.id);
    expect(await docRow(document.id)).toMatchObject({ status: 'AUTHORIZED', substitutionReasonCode: null });
    expect(await saleFiscalState(db, world.company, sale.id)).toMatchObject({ canEditSale: false });
  });

  it('prévia de substituição que gera duas notas é bloqueada', async () => {
    const services = fiscalServices(db, world, accepts);
    const two = await createConfirmedSale(db, world, [{ serviceId: world.service.id, amount: '100.00' }, { serviceId: world.service.id, amount: '50.00' }]);
    const first = await emitAndAuthorize(services, world, two.id);
    expect(first.emission.items).toHaveLength(1);
    await services.actions.openSubstitution(world.company, world.owner, first.document.id, reason);
    const current = await salesService(db).get(world.company, two.id);
    await salesService(db).updateConfirmed(world.company, two.id, world.owner, {
      customerId: current.customerId, soldOn: current.soldOn!, expectedVersion: current.version,
      // The service of an existing item cannot change: keep the first item and replace the second with another service.
      items: [{ id: current.items[0].id, serviceId: current.items[0].serviceId, quantity: current.items[0].quantity, unitPrice: current.items[0].unitPrice, discountAmount: current.items[0].discountAmount },
        { serviceId: world.secondService.id, quantity: '1.0000', unitPrice: current.items[1].unitPrice, discountAmount: '0.00' }],
      installments: current.installments.map(p => ({ id: p.id, paymentMethod: p.paymentMethod, amount: p.amount, dueOn: p.dueOn! })),
    } as never);
    const preview = await services.previews.create(world.company, world.owner, two.id, crypto.randomUUID(), {});
    expect(preview.groups).toHaveLength(2);
    expect(preview.canEmit).toBe(false);
    expect(preview.issues.map(i => i.code)).toContain('SUBSTITUTION_SINGLE_GROUP');
  });

  it('só abre substituição com uma nota ativa que cubra a venda toda', async () => {
    const { actions } = fiscalServices(db, world);
    const two = await createConfirmedSale(db, world, [{ serviceId: world.service.id, amount: '100.00' }, { serviceId: world.secondService.id, amount: '50.00' }]);
    const partial = await seedEmission(db, world, two, { dpsStatus: 'AUTHORIZED', number: 1, itemIds: [two.items[0].id] });
    await expect(actions.openSubstitution(world.company, world.owner, partial.document!.id, reason)).rejects.toMatchObject({ response: { code: 'SUBSTITUTION_PARTIAL' } });
    await seedEmission(db, world, two, { dpsStatus: 'AUTHORIZED', number: 2, itemIds: [two.items[1].id] });
    await expect(actions.openSubstitution(world.company, world.owner, partial.document!.id, reason)).rejects.toMatchObject({ response: { code: 'SUBSTITUTION_MULTIPLE_NOTES' } });
    const cancelled = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 3, documentStatus: 'CANCELLED' });
    await expect(actions.openSubstitution(world.company, world.owner, cancelled.document!.id, reason)).rejects.toMatchObject({ response: { code: 'NFSE_NOT_ACTIVE' } });
  });

  it('não permite a outra empresa abrir ou desfazer a substituição', async () => {
    const { actions } = fiscalServices(db, world);
    const { document } = await seedEmission(db, world, sale, { dpsStatus: 'AUTHORIZED', number: 1 });
    await expect(actions.openSubstitution(world.otherCompany, world.other, document!.id, reason)).rejects.toBeInstanceOf(NotFoundException);
    await expect(actions.discardSubstitution(world.otherCompany, world.other, document!.id)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('leitura: histórico e estado da venda', () => {
  type Call = NonNullable<Parameters<typeof fiscalServices>[2]>;
  const accepts: Call = async (method, _path, xml) => { if (method !== 'POST') throw new Error('consulta inesperada'); return officialNfseResponse(xml!); };

  it('venda nunca emitida: pode emitir, não há nota ativa', async () => {
    const state = await fiscalServices(db, world).issuance.state(world.company, sale.id);
    expect(state).toMatchObject({ inProgress: false, canEditSale: true, canCancelSale: true, uncoveredItems: 1, hasActiveDocuments: false, emitMode: 'ISSUE', substitution: null, activeDocuments: [] });
  });

  it('nota autorizada: oferece cancelar e substituir; sem emissão pendente', async () => {
    const services = fiscalServices(db, world, accepts);
    const { document } = await emitAndAuthorize(services, world, sale.id);
    const state = await services.issuance.state(world.company, sale.id);
    expect(state).toMatchObject({ canEditSale: false, emitMode: null, uncoveredItems: 0, activeDocuments: [{ id: document.id, canSubstitute: true, canCancel: true }] });
  });

  it('substituição aberta: modo SUBSTITUTION e histórico com a nota e a substituição', async () => {
    const services = fiscalServices(db, world, accepts);
    const { document, emission } = await emitAndAuthorize(services, world, sale.id);
    await services.actions.openSubstitution(world.company, world.owner, document.id, { reasonCode: '99', reasonText: 'Correção da descrição do serviço prestado' });
    const state = await services.issuance.state(world.company, sale.id);
    expect(state).toMatchObject({ emitMode: 'SUBSTITUTION', canEditSale: true, substitution: { documentId: document.id, reasonCode: '99' }, activeDocuments: [{ canSubstitute: false }] });
    const history = await services.issuance.forSale(world.company, sale.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: emission.id, kind: 'ISSUE', status: 'AUTHORIZED' });
    expect(history[0].items[0].document).toMatchObject({ id: document.id, status: 'AUTHORIZED', substitution: { reasonCode: '99' }, cancellation: null });
  });

  it('cancelamento aparece no histórico da nota', async () => {
    const services = fiscalServices(db, world, accepts);
    const { document } = await emitAndAuthorize(services, world, sale.id);
    await services.actions.requestCancellation(world.company, world.owner, document.id, crypto.randomUUID(), { reasonCode: '2', reasonText: 'Serviço não chegou a ser prestado' });
    const [emission] = await services.issuance.forSale(world.company, sale.id);
    expect(emission.items[0].document?.cancellation).toMatchObject({ status: 'PENDING', reasonCode: '2' });
    expect((await services.issuance.state(world.company, sale.id)).inProgress).toBe(true);
  });

  it('rejeitada e reemitida: histórico em ordem, ligando as tentativas', async () => {
    const services = fiscalServices(db, world);
    const first = await previewAndEmit(services, world, sale.id);
    await db.update(s.nfseDps).set({ status: 'REJECTED', lastError: 'E1 — erro' }).where(eq(s.nfseDps.sourceSaleId, sale.id));
    const second = await previewAndEmit(services, world, sale.id);
    const history = await services.issuance.forSale(world.company, sale.id);
    expect(history.map(e => e.id)).toEqual([first.id, second.id]);
    expect(history[1].previousEmissionId).toBe(first.id);
    expect(history[0]).toMatchObject({ status: 'REJECTED' });
    expect(history[0].items[0].lastError).toContain('E1');
  });
});

describe('substituição: o que o governo não deixa mudar (E0061/E0063)', () => {
  type Call = NonNullable<Parameters<typeof fiscalServices>[2]>;
  const accepts: Call = async (method, _path, xml) => { if (method !== 'POST') throw new Error('consulta inesperada'); return officialNfseResponse(xml!); };
  const reason = { reasonCode: '99' as const, reasonText: 'Correção da descrição do serviço prestado' };
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

  async function edit(changes: { amount?: string; soldOn?: string; customerId?: string; description?: string }) {
    const current = await salesService(db).get(world.company, sale.id);
    const amount = changes.amount ?? current.items[0].unitPrice;
    await salesService(db).updateConfirmed(world.company, sale.id, world.owner, {
      customerId: changes.customerId ?? current.customerId, soldOn: changes.soldOn ?? current.soldOn!, expectedVersion: current.version,
      items: current.items.map(i => ({ id: i.id, serviceId: i.serviceId, quantity: i.quantity, unitPrice: amount, discountAmount: i.discountAmount, ...(changes.description ? { description: changes.description } : {}) })),
      installments: current.installments.map(p => ({ id: p.id, paymentMethod: p.paymentMethod, amount, dueOn: p.dueOn! })),
    } as never);
  }
  async function openedSubstitution() {
    const services = fiscalServices(db, world, accepts);
    const { document } = await emitAndAuthorize(services, world, sale.id);
    await services.actions.openSubstitution(world.company, world.owner, document.id, reason);
    return services;
  }
  const preview = (services: Awaited<ReturnType<typeof openedSubstitution>>) => services.previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {});
  const codes = (p: Awaited<ReturnType<typeof preview>>) => p.issues.filter(i => i.severity === 'ERROR').map(i => i.code);

  it('alterar só a descrição é permitido', async () => {
    const services = await openedSubstitution();
    await edit({ description: 'Consultoria estratégica — descrição corrigida' });
    const p = await preview(services);
    expect(codes(p)).toEqual([]);
    expect(p.canEmit).toBe(true);
  });

  it('alterar o valor do serviço é bloqueado, com o valor original na mensagem', async () => {
    const services = await openedSubstitution();
    await edit({ amount: '120.00' });
    const p = await preview(services);
    expect(codes(p)).toEqual(['SUBSTITUTION_VALUE_LOCKED']);
    expect(p.canEmit).toBe(false);
    expect(p.issues.find(i => i.code === 'SUBSTITUTION_VALUE_LOCKED')!.message).toContain('100,00');
    expect(p.issues.find(i => i.code === 'SUBSTITUTION_VALUE_LOCKED')!.message).toMatch(/cancele a nota/i);
  });

  it('alterar a competência é bloqueado', async () => {
    const services = await openedSubstitution();
    await edit({ soldOn: daysAgo(3) });
    expect(codes(await preview(services))).toEqual(['SUBSTITUTION_COMPETENCE_LOCKED']);
  });

  it('trocar o tomador é bloqueado', async () => {
    const services = await openedSubstitution();
    const [other] = await db.insert(s.customers).values({ companyId: world.company, kind: 'PF', name: 'Outro Cliente', taxId: '11144477735', countryCode: 'BR' }).returning();
    await edit({ customerId: other.id });
    expect(codes(await preview(services))).toEqual(['SUBSTITUTION_CUSTOMER_LOCKED']);
  });

  it('alterações combinadas geram um aviso para cada campo', async () => {
    const services = await openedSubstitution();
    const [other] = await db.insert(s.customers).values({ companyId: world.company, kind: 'PF', name: 'Outro Cliente', taxId: '11144477735', countryCode: 'BR' }).returning();
    await edit({ amount: '90.00', soldOn: daysAgo(2), customerId: other.id });
    expect(codes(await preview(services)).sort()).toEqual(['SUBSTITUTION_COMPETENCE_LOCKED', 'SUBSTITUTION_CUSTOMER_LOCKED', 'SUBSTITUTION_VALUE_LOCKED']);
  });

  it('emissão normal (sem substituição) não é afetada', async () => {
    const services = fiscalServices(db, world, accepts);
    await edit({ amount: '120.00', soldOn: daysAgo(2) });
    expect(codes(await services.previews.create(world.company, world.owner, sale.id, crypto.randomUUID(), {}))).toEqual([]);
  });
});
