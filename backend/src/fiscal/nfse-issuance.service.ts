import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { companies, companyUsers, integrationOutbox, nfseDocuments, nfseDps, nfseEmissionRequests, nfseEvents, nfsePreviews, nfseSeries, sales } from '@gestaonf/database/schema';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { DatabaseService } from '../database/database.module.js';
import { NfsePreviewService, snapshotHash } from './nfse-preview.service.js';
import { dpsIdentifier, hash } from './nfse-contract.js';
import type { NfseSnapshot } from './nfse.types.js';
import { NationalNfseClient } from './nfse-national.client.js';

@Injectable()
export class NfseIssuanceService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(NfsePreviewService) private readonly previews: NfsePreviewService, @Inject(NationalNfseClient) private readonly national: NationalNfseClient) {}

  async emit(companyId: string, userId: string, saleId: string, previewId: string, key: string) {
    await this.previews.manager(companyId, userId);
    const requestHash = hash(JSON.stringify({ saleId, previewId }));
    const [previous] = await this.database.db.select().from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.requestKey, key))).limit(1);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ConflictException('Esta chave de emissão foi usada com outros dados.');
      return this.get(companyId, previous.id);
    }
    const preview = await this.previews.get(companyId, previewId);
    if (preview.saleId !== saleId) throw new NotFoundException('Prévia não encontrada para esta venda.');
    if (preview.environment !== 'HOMOLOGATION') throw new UnprocessableEntityException('A série precisa estar em homologação. Emissão em produção ainda não está disponível.');
    if (Date.now() - Date.parse(preview.generatedAt) > 5 * 60000) throw new ConflictException('A prévia expirou. Atualize os dados antes de emitir.');
    if (!preview.canEmit) throw new UnprocessableEntityException({ code: 'NFSE_NOT_READY', message: [...preview.issues, ...preview.emissionIssues].filter(i => i.severity === 'ERROR').map(i => i.message).join('\n'), issues: [...preview.issues, ...preview.emissionIssues] });
    try { this.national.configuration(); } catch { throw new ServiceUnavailableException('Configure o endereço oficial da SEFIN de homologação no servidor.'); }
    const current = await this.previews.build(companyId, saleId, { ...preview.input, expectedSaleVersion: preview.saleVersion });
    if (snapshotHash(current) !== preview.hash || current.issues.some(i => i.severity === 'ERROR')) throw new ConflictException('Os dados fiscais ou a série mudaram. Gere outra prévia.');
    const id = await this.database.db.transaction(async tx => {
      await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for('share');
      // The same lock is used by edits/cancellation. No HTTP or signature runs in this transaction.
      const [sale] = await tx.select().from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, saleId))).for('update').limit(1);
      if (!sale || sale.version !== preview.saleVersion || sale.status !== 'CONFIRMED') throw new ConflictException('A venda mudou. Gere outra prévia.');
      const [sameKey] = await tx.select().from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.requestKey, key))).limit(1);
      if (sameKey) {
        if (sameKey.requestHash !== requestHash) throw new ConflictException('Chave idempotente incompatível.');
        return sameKey.id;
      }
      const [issued] = await tx.select({ id: nfseEmissionRequests.id }).from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.saleId, saleId), eq(nfseEmissionRequests.environment, 'HOMOLOGATION'))).limit(1);
      if (issued) throw new ConflictException({ code: 'NFSE_ALREADY_REQUESTED', message: 'Esta venda já possui uma solicitação de emissão em homologação. Consulte seu resultado.', emissionId: issued.id });
      const [series] = await tx.select().from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, preview.series!.id))).for('update').limit(1);
      if (!series || series.environment !== 'HOMOLOGATION' || series.status !== 'ACTIVE' || series.version !== preview.series!.version || series.nextNumber.toString() !== preview.series!.nextNumber || series.issuerTaxIdSnapshot !== preview.issuer.taxId) throw new ConflictException('A série mudou. Gere outra prévia.');
      // Lock and compare all mutable sources with the saved snapshot before accepting it.
      const verified = await this.previews.build(companyId, saleId, preview.input, tx);
      if (snapshotHash(verified) !== preview.hash) throw new ConflictException('Os cadastros mudaram. Gere outra prévia.');
      const end = series.nextNumber + BigInt(preview.groups.length);
      if (end > 1000000000000000n) throw new ConflictException('A numeração da série está esgotada.');
      const [request] = await tx.insert(nfseEmissionRequests).values({ companyId, saleId, previewId, environment: 'HOMOLOGATION', requestKey: key, requestHash, createdByUserId: userId }).returning({ id: nfseEmissionRequests.id });
      for (const [index, group] of preview.groups.entries()) {
        const number = series.nextNumber + BigInt(index);
        const [dps] = await tx.insert(nfseDps).values({ companyId, seriesId: series.id, environment: 'HOMOLOGATION', issuerTaxIdSnapshot: series.issuerTaxIdSnapshot, municipalityIbgeCode: series.municipalityIbgeCode, seriesNumber: series.seriesNumber, dpsNumber: number, sourceSaleId: saleId, emissionId: request.id, groupKey: group.key,
          identifier: dpsIdentifier(series.municipalityIbgeCode, series.issuerTaxIdSnapshot, series.seriesNumber, number.toString()), snapshot: current as unknown as Record<string, unknown>, requestKey: randomUUID(), requestHash: preview.hash, createdByUserId: userId }).returning({ id: nfseDps.id });
        await tx.insert(integrationOutbox).values({ topic: 'nfse.process', aggregateId: dps.id, payload: { companyId, dpsId: dps.id } });
        await tx.insert(nfseEvents).values({ companyId, emissionId: request.id, dpsId: dps.id, actorUserId: userId, action: 'RESERVED', message: `DPS ${series.seriesNumber}/${number} reservada em homologação.` });
      }
      await tx.update(nfseSeries).set({ nextNumber: end, version: series.version + 1, updatedAt: new Date() }).where(eq(nfseSeries.id, series.id));
      return request.id;
    });
    return this.get(companyId, id);
  }

  async get(companyId: string, id: string) {
    const [request] = await this.database.db.select({ id: nfseEmissionRequests.id, saleId: nfseEmissionRequests.saleId, environment: nfseEmissionRequests.environment, createdAt: nfseEmissionRequests.createdAt }).from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.id, id))).limit(1);
    if (!request) throw new NotFoundException('Emissão não encontrada.');
    const rows = await this.database.db.select({ dps: { id: nfseDps.id, status: nfseDps.status, seriesNumber: nfseDps.seriesNumber, number: nfseDps.dpsNumber, lastError: nfseDps.lastError, nextActionAt: nfseDps.nextActionAt }, document: { id: nfseDocuments.id, number: nfseDocuments.number, accessKey: nfseDocuments.accessKey, authorizedAt: nfseDocuments.authorizedAt } }).from(nfseDps).leftJoin(nfseDocuments, and(eq(nfseDocuments.companyId, nfseDps.companyId), eq(nfseDocuments.dpsId, nfseDps.id))).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.emissionId, id))).orderBy(asc(nfseDps.dpsNumber));
    const states = rows.map(r => r.dps.status);
    const status = states.every(s => s === 'AUTHORIZED') ? 'AUTHORIZED' : states.some(s => s === 'AUTHORIZED') ? 'PARTIAL' : states.every(s => s === 'REJECTED') ? 'REJECTED' : states.some(s => s === 'UNKNOWN') ? 'UNKNOWN' : 'PROCESSING';
    const events = await this.database.db.select({ id: nfseEvents.id, action: nfseEvents.action, message: nfseEvents.message, createdAt: nfseEvents.createdAt }).from(nfseEvents).where(and(eq(nfseEvents.companyId, companyId), eq(nfseEvents.emissionId, id))).orderBy(desc(nfseEvents.createdAt)).limit(100);
    return { ...request, status, items: rows.map(r => ({ ...r.dps, number: r.dps.number.toString(), document: r.document })), events };
  }

  async forSale(companyId: string, saleId: string) {
    const rows = await this.database.db.select({ id: nfseEmissionRequests.id }).from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.saleId, saleId)));
    return Promise.all(rows.map(r => this.get(companyId, r.id)));
  }

  async resume(companyId: string, userId: string, id: string) {
    await this.previews.manager(companyId, userId);
    const [dps] = await this.database.db.select().from(nfseDps).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.id, id))).limit(1);
    if (!dps?.emissionId) throw new NotFoundException('DPS não encontrada.');
    if (['AUTHORIZED', 'REJECTED'].includes(dps.status)) throw new ConflictException('Esta DPS já tem resultado definitivo.');
    await this.database.db.insert(integrationOutbox).values({ topic: 'nfse.process', aggregateId: id, payload: { companyId, dpsId: id } });
    return this.get(companyId, dps.emissionId);
  }

  async document(companyId: string, id: string) {
    const [document] = await this.database.db.select().from(nfseDocuments).where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, id))).limit(1);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    return document;
  }
}
