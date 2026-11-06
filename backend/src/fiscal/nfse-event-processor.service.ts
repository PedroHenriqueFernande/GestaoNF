import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { companies, companyUsers, nfseDocumentEvents, nfseDocuments, nfseDps, nfseEvents, nfseTransmissionAttempts } from '@gestaonf/database/schema';
import { DatabaseService } from '../database/database.module.js';
import { CertificateService } from './certificate.service.js';
import { EMISSION_SKEW_MS, hash } from './nfse-contract.js';
import { CANCELLATION_EVENT, buildCancellationRequest, readRegisteredEvent, signEvent, validateEventXml, type CancellationReason } from './nfse-event-contract.js';
import { EVENT_REQUEST_FIELD, NationalNfseClient, classifyResponse, eventLookupPath, eventsPath, extractEventXml, nationalErrors, rawBodySummary, transportRefusal } from './nfse-national.client.js';

type Event = typeof nfseDocumentEvents.$inferSelect;
type Document = typeof nfseDocuments.$inferSelect;
type Dps = typeof nfseDps.$inferSelect;
type Outcome = 'DONE' | 'WAIT' | 'UNKNOWN';

/**
 * Sends a signed cancellation to the national environment. Mirrors the DPS processor: the database is the source of truth,
 * a lease serializes workers, and an uncertain result is always reconsulted before anything is sent again.
 */
@Injectable()
export class NfseEventProcessorService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CertificateService) private readonly certificates: CertificateService,
    @Inject(NationalNfseClient) private readonly client: NationalNfseClient) {}

  private async audit(dps: Dps, action: string, message: string) {
    if (dps.emissionId) await this.database.db.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId, dpsId: dps.id, action, message });
  }

  async process(companyId: string, id: string): Promise<Outcome> {
    const token = randomUUID();
    const claimed = await this.database.db.transaction(async tx => {
      const [event] = await tx.select().from(nfseDocumentEvents).where(and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.id, id))).for('update').limit(1);
      if (!event || ['REGISTERED', 'REJECTED'].includes(event.status)) return null;
      if (event.leaseExpiresAt && event.leaseExpiresAt > new Date()) return 'WAIT' as const;
      const [row] = await tx.update(nfseDocumentEvents).set({ leaseToken: token, leaseExpiresAt: new Date(Date.now() + 180000), status: event.status === 'SENDING' ? 'UNKNOWN' : event.status }).where(eq(nfseDocumentEvents.id, id)).returning();
      return row;
    });
    if (!claimed) return 'DONE';
    if (claimed === 'WAIT') return 'WAIT';
    const event = claimed;
    const owns = () => and(eq(nfseDocumentEvents.companyId, companyId), eq(nfseDocumentEvents.id, id), eq(nfseDocumentEvents.leaseToken, token));
    const [loaded] = await this.database.db.select({ document: nfseDocuments, dps: nfseDps }).from(nfseDocuments).innerJoin(nfseDps, and(eq(nfseDps.companyId, nfseDocuments.companyId), eq(nfseDps.id, nfseDocuments.dpsId)))
      .where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, event.documentId))).limit(1);
    try {
      if (!loaded) throw new Error('Documento fiscal do evento não encontrado.');
      const { document, dps } = loaded;
      if (event.environment !== 'HOMOLOGATION' || document.environment !== 'HOMOLOGATION') throw new Error('Cancelamento em produção ainda não está implementado.');
      return await this.certificates.withSigningCredential(companyId, async credential => {
        if (event.status === 'UNKNOWN' || event.sentAt) {
          const lookup = await this.attempt(event, 'LOOKUP_EVENT', () => this.client.call('GET', eventLookupPath(document.accessKey, CANCELLATION_EVENT), credential));
          const xml = lookup.status >= 200 && lookup.status < 300 ? extractEventXml(lookup.body) : null;
          if (xml) { await this.register(event, document, dps, xml); return 'DONE'; }
          await this.database.db.update(nfseDocumentEvents).set({ status: 'UNKNOWN', lastError: 'O resultado do cancelamento ainda não foi confirmado. O mesmo pedido será consultado; um novo não será enviado automaticamente.', updatedAt: new Date() }).where(owns());
          return 'UNKNOWN';
        }
        await this.assertRequesterStillAllowed(companyId, event.createdByUserId);
        let signed = event.signedXml;
        if (!signed) {
          const profile = process.env.NFSE_SIGNATURE_PROFILE;
          if (process.env.NFSE_CONTRACT_CONFIRMED !== 'true' || profile !== 'RSA_SHA1' && profile !== 'RSA_SHA256') throw new Error('Confirme o contrato e configure o perfil de assinatura da homologação.');
          const request = buildCancellationRequest({ accessKey: document.accessKey, authorTaxId: dps.issuerTaxIdSnapshot, reasonCode: event.reasonCode as CancellationReason, reasonText: event.reasonText, environment: 'HOMOLOGATION', at: new Date(Date.now() - EMISSION_SKEW_MS) });
          signed = signEvent(request, credential.key, credential.cert, profile);
          const validation = await validateEventXml(signed, 'pedRegEvento');
          if (!validation.valid) throw new Error(`O pedido de cancelamento assinado não passou na validação de estrutura: ${validation.errors.join(' ')}`);
          await this.database.db.update(nfseDocumentEvents).set({ signedXml: signed, signedXmlSha256: hash(signed), certificateId: credential.certificateId, status: 'READY', lastError: null, updatedAt: new Date() }).where(owns());
          await this.audit(dps, 'CANCEL_SIGNED', 'Pedido de cancelamento assinado e conferido localmente.');
        } else if (event.certificateId !== credential.certificateId) throw new Error('O certificado foi substituído após a preparação. Revise este cancelamento antes de transmitir.');
        this.client.configuration();
        if (process.env.NFSE_HOMOLOGATION_ENABLED !== 'true' || process.env.NFSE_CONTRACT_CONFIRMED !== 'true') throw new Error('Envio em homologação desabilitado no servidor.');
        const [sending] = await this.database.db.update(nfseDocumentEvents).set({ status: 'SENDING', sentAt: new Date(), updatedAt: new Date() }).where(and(owns(), eq(nfseDocumentEvents.status, 'READY'))).returning({ id: nfseDocumentEvents.id });
        if (!sending) throw new Error('O pedido de cancelamento mudou antes do envio.');
        await this.audit(dps, 'CANCEL_SENDING', 'Pedido de cancelamento enviado ao ambiente nacional de homologação.');
        const response = await this.attempt(event, 'SEND_EVENT', () => this.client.call('POST', eventsPath(document.accessKey), credential, signed!, EVENT_REQUEST_FIELD));
        const xml = response.status >= 200 && response.status < 300 ? extractEventXml(response.body) : null;
        if (xml) { await this.register(event, document, dps, xml); return 'DONE'; }
        const errors = nationalErrors(response.body);
        const verdict = classifyResponse(response.status);
        if (verdict === 'REJECTED') {
          const reason = errors ?? rawBodySummary(response.status, response.body);
          await this.database.db.update(nfseDocumentEvents).set({ status: 'REJECTED', lastError: reason, updatedAt: new Date() }).where(owns());
          await this.audit(dps, 'CANCEL_REJECTED', reason);
          return 'DONE';
        }
        if (verdict === 'NOT_PROCESSED') {
          const reason = `${transportRefusal(response.status)}${errors ? `\n${errors}` : ''}`;
          await this.database.db.update(nfseDocumentEvents).set({ status: 'READY', sentAt: null, lastError: reason, updatedAt: new Date() }).where(owns());
          await this.audit(dps, 'CANCEL_TRANSPORT_REFUSED', reason);
          return 'DONE';
        }
        await this.database.db.update(nfseDocumentEvents).set({ status: 'UNKNOWN', lastError: errors || 'O retorno não confirmou o cancelamento. O resultado será consultado.', updatedAt: new Date() }).where(owns());
        await this.audit(dps, 'CANCEL_UNKNOWN', 'Envio sem resultado definitivo; consulta necessária.');
        return 'UNKNOWN';
      });
    } catch (error) {
      const [current] = await this.database.db.select({ status: nfseDocumentEvents.status, sentAt: nfseDocumentEvents.sentAt }).from(nfseDocumentEvents).where(owns()).limit(1);
      if (current?.status === 'REGISTERED') return 'DONE';
      const uncertain = current?.status === 'SENDING' || current?.status === 'UNKNOWN' || !!current?.sentAt;
      const message = error instanceof Error ? error.message.slice(0, 1400) : 'Não foi possível processar este cancelamento.';
      await this.database.db.update(nfseDocumentEvents).set({ ...(uncertain ? { status: 'UNKNOWN' } : {}), lastError: message, updatedAt: new Date() }).where(owns());
      if (loaded) await this.audit(loaded.dps, uncertain ? 'CANCEL_UNKNOWN' : 'CANCEL_FAILED', message);
      return uncertain ? 'UNKNOWN' : 'DONE';
    } finally {
      await this.database.db.update(nfseDocumentEvents).set({ leaseToken: null, leaseExpiresAt: null }).where(owns());
    }
  }

  private async assertRequesterStillAllowed(companyId: string, userId: string) {
    const [member] = await this.database.db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, userId), eq(companyUsers.status, 'ACTIVE')));
    const [company] = await this.database.db.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!member || !['OWNER', 'ADMIN'].includes(member.role) || company?.status !== 'ACTIVE') throw new Error('O solicitante não possui mais permissão fiscal na empresa ativa.');
  }

  private async attempt(event: Event, operation: 'SEND_EVENT' | 'LOOKUP_EVENT', call: () => Promise<{ status: number; body: Record<string, unknown> }>) {
    const [attempt] = await this.database.db.insert(nfseTransmissionAttempts).values({ companyId: event.companyId, documentEventId: event.id, operation }).returning({ id: nfseTransmissionAttempts.id });
    try {
      const response = await call();
      await this.database.db.update(nfseTransmissionAttempts).set({ outcome: 'RECEIVED', httpStatus: response.status, response: response.body, completedAt: new Date() }).where(eq(nfseTransmissionAttempts.id, attempt.id));
      return response;
    } catch (error) {
      await this.database.db.update(nfseTransmissionAttempts).set({ outcome: 'UNCERTAIN', message: error instanceof Error ? error.message.slice(0, 1400) : 'Falha de comunicação.', completedAt: new Date() }).where(eq(nfseTransmissionAttempts.id, attempt.id));
      throw error;
    }
  }

  /** Validates the registered event, then marks event and note in one transaction. */
  private async register(event: Event, document: Document, dps: Dps, xml: string) {
    const validation = await validateEventXml(xml, 'evento');
    if (!validation.valid) throw new Error('O evento retornado não corresponde ao esquema fiscal instalado. Consulte o pedido antes de reenviar.');
    const registered = readRegisteredEvent(xml, { accessKey: document.accessKey, eventType: CANCELLATION_EVENT, environment: 'HOMOLOGATION', authorTaxId: dps.issuerTaxIdSnapshot });
    await this.database.db.transaction(async tx => {
      const [current] = await tx.select({ status: nfseDocumentEvents.status }).from(nfseDocumentEvents).where(eq(nfseDocumentEvents.id, event.id)).for('update').limit(1);
      if (current?.status === 'REGISTERED') return;
      await tx.update(nfseDocumentEvents).set({ status: 'REGISTERED', officialXml: xml, officialXmlSha256: hash(xml), sequenceNumber: registered.sequence, processedAt: registered.processedAt, lastError: null, nextActionAt: null, updatedAt: new Date() }).where(eq(nfseDocumentEvents.id, event.id));
      await tx.update(nfseDocuments).set({ status: 'CANCELLED', cancelledAt: registered.processedAt, substitutionReasonCode: null, substitutionReasonText: null, substitutionOpenedByUserId: null, substitutionOpenedAt: null, substitutionSaleVersion: null })
        .where(and(eq(nfseDocuments.companyId, document.companyId), eq(nfseDocuments.id, document.id), eq(nfseDocuments.status, 'AUTHORIZED')));
      if (dps.emissionId) await tx.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId, dpsId: dps.id, action: 'CANCELLED', message: `NFS-e ${document.number} cancelada em homologação.` });
    });
  }
}
