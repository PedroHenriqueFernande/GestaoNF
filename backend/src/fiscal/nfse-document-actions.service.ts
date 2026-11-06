import { ConflictException, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { integrationOutbox, nfseDocumentEvents, nfseDocuments, nfseDps, nfseEvents, saleItems, sales } from '@gestaonf/database/schema';
import { DatabaseService } from '../database/database.module.js';
import { hash } from './nfse-contract.js';
import { eventIdentifier, CANCELLATION_EVENT } from './nfse-event-contract.js';
import { NfsePreviewService } from './nfse-preview.service.js';
import { saleFiscalState } from './sale-fiscal-state.js';
import type { NfseCancelInput, NfseSubstitutionInput } from './nfse.schemas.js';
import type { NfseSnapshot } from './nfse.types.js';

/** JSON with sorted keys: PostgreSQL's jsonb does not preserve key order, so stored and freshly built snapshots must be compared canonically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

type Tx = Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

const publicEvent = (event: typeof nfseDocumentEvents.$inferSelect) => ({
  id: event.id, documentId: event.documentId, eventType: event.eventType, reasonCode: event.reasonCode, reasonText: event.reasonText,
  status: event.status, lastError: event.lastError, sequenceNumber: event.sequenceNumber, processedAt: event.processedAt, createdAt: event.createdAt,
});

/** Commands the user can issue over an already authorized NFS-e: cancel it, or reconsult a cancellation with an unknown result. */
@Injectable()
export class NfseDocumentActionsService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(NfsePreviewService) private readonly previews: NfsePreviewService) {}

  async requestCancellation(companyId: string, userId: string, documentId: string, key: string, input: NfseCancelInput) {
    await this.previews.manager(companyId, userId);
    const reasonText = input.reasonText.trim();
    const requestHash = hash(JSON.stringify({ documentId, reasonCode: input.reasonCode, reasonText }));
    const [previous] = await this.database.db.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.requestKey, key))).limit(1);
    if (previous) {
      if (previous.requestHash !== requestHash) throw new ConflictException('Esta chave foi usada com outros dados de cancelamento.');
      return publicEvent(previous);
    }
    const event = await this.database.db.transaction(async tx => {
      const context = await this.lockDocument(tx, companyId, documentId);
      const [sameKey] = await tx.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.requestKey, key))).limit(1);
      if (sameKey) { if (sameKey.requestHash !== requestHash) throw new ConflictException('Chave idempotente incompatível.'); return sameKey; }
      if (context.document.status !== 'AUTHORIZED') throw new ConflictException({ code: 'NFSE_NOT_ACTIVE', message: 'Esta NFS-e já foi cancelada ou substituída.' });
      if (context.document.environment !== 'HOMOLOGATION') throw new UnprocessableEntityException('Cancelamento em produção ainda não está disponível.');
      const state = await saleFiscalState(tx, companyId, context.saleId);
      if (state.inProgress) throw new ConflictException({ code: 'NFSE_IN_PROGRESS', message: 'Há uma solicitação fiscal em andamento para esta venda. Aguarde o resultado antes de cancelar a nota.' });
      const [active] = await tx.select({ id: nfseDocumentEvents.id }).from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.documentId, documentId), eq(nfseDocumentEvents.eventType, CANCELLATION_EVENT), ne(nfseDocumentEvents.status, 'REJECTED'))).limit(1);
      if (active) throw new ConflictException({ code: 'CANCELLATION_ALREADY_REQUESTED', message: 'Já existe um pedido de cancelamento para esta NFS-e.' });
      const [created] = await tx.insert(nfseDocumentEvents).values({ companyId, documentId, environment: context.document.environment, eventType: CANCELLATION_EVENT, reasonCode: input.reasonCode, reasonText,
        identifier: eventIdentifier(context.document.accessKey), requestKey: key, requestHash, createdByUserId: userId }).returning();
      await tx.insert(integrationOutbox).values({ topic: 'nfse.event', aggregateId: created.id, payload: { companyId, eventId: created.id } });
      if (context.emissionId) await tx.insert(nfseEvents).values({ companyId, emissionId: context.emissionId, dpsId: context.dpsId, actorUserId: userId, action: 'CANCEL_REQUESTED', message: `Cancelamento da NFS-e ${context.document.number} solicitado (motivo ${input.reasonCode}).` });
      return created;
    });
    return publicEvent(event);
  }

  /** Opens a substitution: the sale becomes editable and the next emission replaces this note. */
  async openSubstitution(companyId: string, userId: string, documentId: string, input: NfseSubstitutionInput) {
    await this.previews.manager(companyId, userId);
    return this.database.db.transaction(async tx => {
      const context = await this.lockDocument(tx, companyId, documentId);
      if (context.document.status !== 'AUTHORIZED') throw new ConflictException({ code: 'NFSE_NOT_ACTIVE', message: 'Esta NFS-e já foi cancelada ou substituída.' });
      if (context.document.environment !== 'HOMOLOGATION') throw new UnprocessableEntityException('Substituição em produção ainda não está disponível.');
      if (context.document.substitutionReasonCode) throw new ConflictException({ code: 'SUBSTITUTION_ALREADY_OPEN', message: 'Já existe uma substituição aberta para esta NFS-e.' });
      if (context.saleStatus !== 'CONFIRMED') throw new ConflictException('Somente vendas confirmadas podem ter a nota substituída.');
      const state = await saleFiscalState(tx, companyId, context.saleId);
      if (state.inProgress) throw new ConflictException({ code: 'NFSE_IN_PROGRESS', message: 'Há uma solicitação fiscal em andamento para esta venda. Aguarde o resultado antes de substituir a nota.' });
      if (state.activeDocuments.length !== 1) throw new UnprocessableEntityException({ code: 'SUBSTITUTION_MULTIPLE_NOTES', message: 'A substituição só está disponível para vendas com uma única nota. Cancele a nota com erro e emita novamente.' });
      const items = await tx.select({ id: saleItems.id }).from(saleItems).where(and(eq(saleItems.companyId, companyId), eq(saleItems.saleId, context.saleId)));
      if (items.some(item => !state.coveredItemIds.has(item.id))) throw new UnprocessableEntityException({ code: 'SUBSTITUTION_PARTIAL', message: 'A nota não cobre todos os serviços da venda. Cancele a nota e emita novamente.' });
      const reasonText = input.reasonText?.trim() || null;
      await tx.update(nfseDocuments).set({ substitutionReasonCode: input.reasonCode, substitutionReasonText: reasonText, substitutionOpenedByUserId: userId, substitutionOpenedAt: new Date(), substitutionSaleVersion: context.saleVersion })
        .where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId)));
      if (context.emissionId) await tx.insert(nfseEvents).values({ companyId, emissionId: context.emissionId, dpsId: context.dpsId, actorUserId: userId, action: 'SUBSTITUTION_OPENED', message: `Substituição da NFS-e ${context.document.number} aberta (motivo ${input.reasonCode}).` });
      return { documentId, reasonCode: input.reasonCode, reasonText, saleVersion: context.saleVersion };
    });
  }

  /**
   * Gives up a substitution. Sale versions only grow, so "unchanged" is decided by content: the fiscal groups the sale
   * would produce today must be identical to the ones the authorized note was issued with.
   */
  async discardSubstitution(companyId: string, userId: string, documentId: string) {
    await this.previews.manager(companyId, userId);
    await this.database.db.transaction(async tx => {
      const context = await this.lockDocument(tx, companyId, documentId);
      if (context.document.status !== 'AUTHORIZED' || !context.document.substitutionReasonCode) throw new ConflictException({ code: 'SUBSTITUTION_NOT_OPEN', message: 'Não há substituição aberta para esta NFS-e.' });
      const state = await saleFiscalState(tx, companyId, context.saleId);
      if (state.inProgress) throw new ConflictException({ code: 'NFSE_IN_PROGRESS', message: 'A nota substituta está em processamento. Aguarde o resultado.' });
      if (context.saleVersion !== context.document.substitutionSaleVersion) {
        const original = context.dpsSnapshot;
        const current = await this.previews.build(companyId, context.saleId, original.input ?? {}, tx);
        // Editing a sale recreates its items, so item ids are not part of the comparison; only the fiscal content is.
        const fiscalContent = (snapshot: NfseSnapshot) => canonicalJson([snapshot.groups.map(group => ({ ...group, items: group.items.map(({ id: _id, ...item }) => item) })), snapshot.customer, snapshot.issuer, snapshot.simplesOption, snapshot.specialTaxRegime]);
        const same = fiscalContent(current) === fiscalContent(original);
        if (!same) throw new ConflictException({ code: 'SALE_CHANGED', message: 'A venda foi alterada depois de abrir a substituição. Emita a nota substituta ou desfaça as alterações para desistir.' });
      }
      await tx.update(nfseDocuments).set({ substitutionReasonCode: null, substitutionReasonText: null, substitutionOpenedByUserId: null, substitutionOpenedAt: null, substitutionSaleVersion: null })
        .where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId)));
      if (context.emissionId) await tx.insert(nfseEvents).values({ companyId, emissionId: context.emissionId, dpsId: context.dpsId, actorUserId: userId, action: 'SUBSTITUTION_DISCARDED', message: `Substituição da NFS-e ${context.document.number} desfeita.` });
    });
  }

  async getEvent(companyId: string, id: string) {
    const [event] = await this.database.db.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.id, id))).limit(1);
    if (!event) throw new NotFoundException('Evento fiscal não encontrado.');
    return publicEvent(event);
  }

  async reconcileEvent(companyId: string, userId: string, id: string) {
    await this.previews.manager(companyId, userId);
    const [event] = await this.database.db.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.id, id))).limit(1);
    if (!event) throw new NotFoundException('Evento fiscal não encontrado.');
    if (!['PENDING', 'READY', 'SENDING', 'UNKNOWN'].includes(event.status)) throw new ConflictException('Este cancelamento já tem resultado definitivo.');
    await this.database.db.insert(integrationOutbox).values({ topic: 'nfse.event', aggregateId: id, payload: { companyId, eventId: id } });
    return publicEvent(event);
  }

  /** Latest cancellation request of each document, for the sale history. */
  async latestEvents(companyId: string, documentIds: string[]) {
    if (!documentIds.length) return new Map<string, ReturnType<typeof publicEvent>>();
    const rows = await this.database.db.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), inArray(nfseDocumentEvents.documentId, documentIds))).orderBy(desc(nfseDocumentEvents.createdAt));
    const latest = new Map<string, ReturnType<typeof publicEvent>>();
    for (const row of rows) if (!latest.has(row.documentId)) latest.set(row.documentId, publicEvent(row));
    return latest;
  }

  /** Locks the sale first and the document second, the same order used by issuance and sale edits. */
  private async lockDocument(tx: Tx, companyId: string, documentId: string) {
    const [found] = await tx.select({ document: nfseDocuments, dps: nfseDps }).from(nfseDocuments).innerJoin(nfseDps, and(eq(nfseDps.companyId, nfseDocuments.companyId), eq(nfseDps.id, nfseDocuments.dpsId)))
      .where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId))).limit(1);
    if (!found?.dps.sourceSaleId) throw new NotFoundException('NFS-e não encontrada.');
    const [sale] = await tx.select({ version: sales.version, status: sales.status }).from(sales).where(and(eq(sales.companyId, companyId), eq(sales.id, found.dps.sourceSaleId))).for('update');
    const [document] = await tx.select().from(nfseDocuments).where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId))).for('update').limit(1);
    return { document, saleId: found.dps.sourceSaleId, saleVersion: sale.version, saleStatus: sale.status, dpsId: found.dps.id, emissionId: found.dps.emissionId, dpsSnapshot: found.dps.snapshot as unknown as NfseSnapshot };
  }
}
