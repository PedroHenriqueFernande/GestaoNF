import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { companies, companyUsers, integrationOutbox, nfseDocuments, nfseDps, nfseEmissionRequests, nfseEvents, nfseSeries, nfseTransmissionAttempts } from '@gestaonf/database/schema';
import { DatabaseService } from '../database/database.module.js';
import { R2StorageService } from '../files/r2-storage.service.js';
import { CertificateService } from './certificate.service.js';
import { buildDps, emissionTimestamp, hash, parseFiscalXml, signDps, validateFiscalXml } from './nfse-contract.js';
import { NationalNfseClient, classifyResponse, extractOfficialXml, nationalErrors, rawBodySummary, transportRefusal } from './nfse-national.client.js';
import type { NfseSnapshot } from './nfse.types.js';

const NS = 'http://www.sped.fazenda.gov.br/nfse';
type Dps = typeof nfseDps.$inferSelect;

@Injectable()
export class NfseProcessorService {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService, @Inject(CertificateService) private readonly certificates: CertificateService,
    @Inject(NationalNfseClient) private readonly client: NationalNfseClient, @Inject(R2StorageService) private readonly storage: R2StorageService) {}

  private async event(dps: Dps, action: string, message: string) {
    if (dps.emissionId) await this.database.db.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId, dpsId: dps.id, action, message });
  }

  async process(companyId: string, id: string): Promise<'DONE' | 'WAIT' | 'UNKNOWN'> {
    const token = randomUUID();
    const dps = await this.database.db.transaction(async tx => {
      const [candidate] = await tx.select().from(nfseDps).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.id, id))).limit(1);
      if (!candidate || !candidate.emissionId || ['AUTHORIZED', 'REJECTED'].includes(candidate.status)) return null;
      await tx.select({ id: nfseSeries.id }).from(nfseSeries).where(and(eq(nfseSeries.companyId, companyId), eq(nfseSeries.id, candidate.seriesId))).for('update');
      const [first] = await tx.select().from(nfseDps).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.seriesId, candidate.seriesId), inArray(nfseDps.status, ['RESERVED', 'READY', 'SENDING', 'UNKNOWN']))).orderBy(asc(nfseDps.dpsNumber)).limit(1);
      if (first?.id !== id || first.leaseExpiresAt && first.leaseExpiresAt > new Date()) return 'WAIT' as const;
      const [claimed] = await tx.update(nfseDps).set({ leaseToken: token, leaseExpiresAt: new Date(Date.now() + 180000), status: first.status === 'SENDING' ? 'UNKNOWN' : first.status }).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.id, id))).returning();
      return claimed;
    });
    if (!dps) return 'DONE';
    if (dps === 'WAIT') return 'WAIT';
    const owns = () => and(eq(nfseDps.companyId, companyId), eq(nfseDps.id, id), eq(nfseDps.leaseToken, token));
    try {
      if (dps.environment !== 'HOMOLOGATION') throw new Error('Emissão em produção ainda não está implementada.');
      return await this.certificates.withSigningCredential(companyId, async credential => {
        if (dps.status === 'UNKNOWN' || dps.sentAt) {
          const lookup = await this.attempt(dps, 'LOOKUP_DPS', () => this.client.call('GET', `/dps/${encodeURIComponent(dps.identifier!)}`, credential));
          if (lookup.status === 200 && typeof lookup.body.chaveAcesso === 'string') {
            const found = await this.attempt(dps, 'FETCH_NFSE', () => this.client.call('GET', `/nfse/${encodeURIComponent(lookup.body.chaveAcesso as string)}`, credential));
            const xml = extractOfficialXml(found.body);
            if (found.status >= 200 && found.status < 300 && xml) { await this.authorize(dps, xml, found.body); return 'DONE'; }
          }
          await this.database.db.update(nfseDps).set({ status: 'UNKNOWN', lastError: 'O resultado ainda não foi confirmado. A mesma DPS será consultada; uma nova nota não será enviada automaticamente.', updatedAt: new Date() }).where(owns());
          return 'UNKNOWN';
        }
        const [request] = await this.database.db.select().from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, companyId), eq(nfseEmissionRequests.id, dps.emissionId!))).limit(1);
        const [member] = request ? await this.database.db.select().from(companyUsers).where(and(eq(companyUsers.companyId, companyId), eq(companyUsers.userId, request.createdByUserId), eq(companyUsers.status, 'ACTIVE'))) : [];
        const [company] = await this.database.db.select({ status: companies.status }).from(companies).where(eq(companies.id, companyId)).limit(1);
        if (!member || !['OWNER', 'ADMIN'].includes(member.role) || company?.status !== 'ACTIVE') throw new Error('O solicitante não possui mais permissão fiscal na empresa ativa.');
        const snapshot = dps.snapshot as unknown as NfseSnapshot;
        const group = snapshot.groups.find(g => g.key === dps.groupKey);
        if (!group) throw new Error('Grupo fiscal não encontrado no snapshot.');
        let signed = dps.signedXml;
        if (!signed) {
          const profile = process.env.NFSE_SIGNATURE_PROFILE;
          if (process.env.NFSE_CONTRACT_CONFIRMED !== 'true' || profile !== 'RSA_SHA1' && profile !== 'RSA_SHA256') throw new Error('Confirme o contrato e configure o perfil de assinatura da homologação.');
          const prepared = buildDps(snapshot, group, dps.dpsNumber.toString(), emissionTimestamp(new Date(), group.competence));
          if (prepared.id !== dps.identifier) throw new Error('A identidade da declaração divergiu da reserva.');
          signed = signDps(prepared.xml, credential.key, credential.cert, profile);
          const validation = await validateFiscalXml(signed);
          if (!validation.valid) throw new Error(`A DPS assinada não passou na validação de estrutura: ${validation.errors.join(' ')}`);
          await this.database.db.update(nfseDps).set({ signedXml: signed, signedXmlSha256: hash(signed), certificateId: credential.certificateId, status: 'READY', lastError: null, updatedAt: new Date() }).where(owns());
          await this.event(dps, 'SIGNED', 'DPS assinada e conferida localmente.');
        } else if (dps.certificateId !== credential.certificateId) throw new Error('O certificado foi substituído após a preparação. Revise esta declaração antes de transmitir.');
        this.client.configuration();
        if (process.env.NFSE_HOMOLOGATION_ENABLED !== 'true' || process.env.NFSE_CONTRACT_CONFIRMED !== 'true') throw new Error('Envio em homologação desabilitado no servidor.');
        const [sending] = await this.database.db.update(nfseDps).set({ status: 'SENDING', sentAt: new Date(), updatedAt: new Date() }).where(and(owns(), eq(nfseDps.status, 'READY'))).returning({ id: nfseDps.id });
        if (!sending) throw new Error('A declaração mudou antes do envio.');
        await this.event(dps, 'SENDING', 'Envio iniciado ao ambiente nacional de homologação.');
        const response = await this.attempt(dps, 'SEND', () => this.client.call('POST', '/nfse', credential, signed!));
        const xml = extractOfficialXml(response.body);
        if (response.status >= 200 && response.status < 300 && xml) { await this.authorize(dps, xml, response.body); return 'DONE'; }
        const errors = nationalErrors(response.body);
        const verdict = classifyResponse(response.status);
        if (verdict === 'REJECTED') {
          const reason = errors ?? rawBodySummary(response.status, response.body);
          await this.database.db.update(nfseDps).set({ status: 'REJECTED', lastError: reason, updatedAt: new Date() }).where(owns());
          await this.event(dps, 'REJECTED', reason);
          return 'DONE';
        }
        if (verdict === 'NOT_PROCESSED') {
          // Refused at the gateway: nothing was processed, so the same signed declaration may be sent again once the setup is fixed.
          const reason = `${transportRefusal(response.status)}${errors ? `\n${errors}` : ''}`;
          await this.database.db.update(nfseDps).set({ status: 'READY', sentAt: null, lastError: reason, updatedAt: new Date() }).where(owns());
          await this.event(dps, 'TRANSPORT_REFUSED', reason);
          return 'DONE';
        }
        await this.database.db.update(nfseDps).set({ status: 'UNKNOWN', lastError: errors || 'O retorno não confirmou a autorização ou rejeição. O resultado será consultado.', updatedAt: new Date() }).where(owns());
        await this.event(dps, 'UNKNOWN', 'Envio sem resultado definitivo; consulta necessária.');
        return 'UNKNOWN';
      });
    } catch (error) {
      const [current] = await this.database.db.select({ status: nfseDps.status, sentAt: nfseDps.sentAt }).from(nfseDps).where(owns()).limit(1);
      if (current?.status === 'AUTHORIZED') return 'DONE';
      const uncertain = current?.status === 'SENDING' || current?.status === 'UNKNOWN' || !!current?.sentAt;
      const message = error instanceof Error ? error.message.slice(0, 1400) : 'Não foi possível processar esta declaração.';
      await this.database.db.update(nfseDps).set({ ...(uncertain ? { status: 'UNKNOWN' } : {}), lastError: message, updatedAt: new Date() }).where(owns());
      await this.event(dps, uncertain ? 'UNKNOWN' : 'PREPARATION_FAILED', message);
      return uncertain ? 'UNKNOWN' : 'DONE';
    } finally {
      await this.database.db.update(nfseDps).set({ leaseToken: null, leaseExpiresAt: null }).where(owns());
    }
  }

  private async attempt(dps: Dps, operation: 'SEND' | 'LOOKUP_DPS' | 'FETCH_NFSE', call: () => Promise<{ status: number; body: Record<string, unknown> }>) {
    const [attempt] = await this.database.db.insert(nfseTransmissionAttempts).values({ companyId: dps.companyId, dpsId: dps.id, operation }).returning({ id: nfseTransmissionAttempts.id });
    try {
      const response = await call();
      await this.database.db.update(nfseTransmissionAttempts).set({ outcome: 'RECEIVED', httpStatus: response.status, response: response.body, completedAt: new Date() }).where(eq(nfseTransmissionAttempts.id, attempt.id));
      return response;
    } catch (error) {
      await this.database.db.update(nfseTransmissionAttempts).set({ outcome: 'UNCERTAIN', message: error instanceof Error ? error.message.slice(0, 1400) : 'Falha de comunicação.', completedAt: new Date() }).where(eq(nfseTransmissionAttempts.id, attempt.id));
      throw error;
    }
  }

  private async authorize(dps: Dps, xml: string, response: Record<string, unknown>) {
    // The government's answer is the source of truth. A mismatch with the schema bundled here (a newer layout version, for example) must not
    // lose an authorized note: keep it and leave a warning. Malformed XML, wrong identity, issuer or values below are still refused.
    const validation = await validateFiscalXml(xml, 'NFSe');
    const schemaWarning = validation.valid ? null : `O XML autorizado difere do esquema fiscal instalado neste sistema: ${validation.errors.slice(0, 3).join(' ')}`.slice(0, 1400);
    const document = parseFiscalXml(xml);
    if (document.documentElement?.localName !== 'NFSe' || document.documentElement?.namespaceURI !== NS) throw new Error('O retorno não é uma NFS-e nacional.');
    const infos = document.getElementsByTagNameNS(NS, 'infNFSe');
    const declarations = document.getElementsByTagNameNS(NS, 'infDPS');
    if (infos.length !== 1 || declarations.length !== 1 || declarations[0].getAttribute('Id') !== dps.identifier) throw new Error('O documento retornado pertence a outra DPS.');
    const value = (name: string) => document.getElementsByTagNameNS(NS, name)[0]?.textContent?.trim() ?? '';
    const issuer = document.getElementsByTagNameNS(NS, 'prest')[0]?.getElementsByTagNameNS(NS, 'CNPJ')[0]?.textContent?.trim();
    const key = infos[0].getAttribute('Id')?.replace(/^NFS|^ID/, '') || response.chaveAcesso;
    const number = value('nNFSe');
    if (typeof key !== 'string' || key.length !== 50 || issuer !== dps.issuerTaxIdSnapshot || value('tpAmb') !== '2' || !number) throw new Error('Chave, ambiente ou prestador da NFS-e divergiu da solicitação.');
    const snapshot = dps.snapshot as unknown as NfseSnapshot;
    const group = snapshot.groups.find(g => g.key === dps.groupKey)!;
    // A substitute must reference exactly the note it replaces, otherwise the original must not be touched.
    const [emission] = dps.emissionId ? await this.database.db.select({ kind: nfseEmissionRequests.kind, substitutesDocumentId: nfseEmissionRequests.substitutesDocumentId }).from(nfseEmissionRequests).where(and(eq(nfseEmissionRequests.companyId, dps.companyId), eq(nfseEmissionRequests.id, dps.emissionId))).limit(1) : [];
    let substitutedId: string | null = null;
    if (emission?.kind === 'SUBSTITUTION') {
      const [original] = emission.substitutesDocumentId ? await this.database.db.select({ id: nfseDocuments.id, accessKey: nfseDocuments.accessKey }).from(nfseDocuments).where(and(eq(nfseDocuments.companyId, dps.companyId), eq(nfseDocuments.id, emission.substitutesDocumentId))).limit(1) : [];
      if (!original || document.getElementsByTagNameNS(NS, 'chSubstda')[0]?.textContent?.trim() !== original.accessKey) throw new Error('A NFS-e retornada não referencia a nota substituída. A nota original não foi alterada; consulte a declaração antes de reenviar.');
      substitutedId = original.id;
    }
    const monetary = (v: string) => { if (!/^\d+(?:\.\d{1,2})?$/.test(v)) throw new Error('Valor fiscal inválido.'); const [whole, fraction = ''] = v.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
    if (monetary(value('vServ')) !== monetary(group.grossAmount) || monetary(value('vDescIncond') || '0') !== monetary(group.discountAmount)) throw new Error('Os valores da nota retornada divergem da solicitação.');
    const processedAt = new Date(value('dhProc') || String(response.dataHoraProcessamento || ''));
    if (!Number.isFinite(processedAt.getTime())) throw new Error('O retorno não contém data de processamento válida.');
    await this.database.db.transaction(async tx => {
      const [current] = await tx.select({ status: nfseDps.status }).from(nfseDps).where(and(eq(nfseDps.companyId, dps.companyId), eq(nfseDps.id, dps.id))).for('update').limit(1);
      if (current?.status === 'AUTHORIZED') return;
      const [saved] = await tx.insert(nfseDocuments).values({ companyId: dps.companyId, dpsId: dps.id, environment: 'HOMOLOGATION', accessKey: key, number, officialXml: xml, xmlSha256: hash(xml), authorizedAt: processedAt }).returning({ id: nfseDocuments.id });
      await tx.update(nfseDps).set({ status: 'AUTHORIZED', lastError: null, nextActionAt: null, updatedAt: new Date() }).where(and(eq(nfseDps.companyId, dps.companyId), eq(nfseDps.id, dps.id)));
      await tx.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId!, dpsId: dps.id, action: 'AUTHORIZED', message: `NFS-e ${number} autorizada em homologação.` });
      if (schemaWarning) await tx.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId!, dpsId: dps.id, action: 'SCHEMA_WARNING', message: schemaWarning });
      if (substitutedId) {
        await tx.update(nfseDocuments).set({ status: 'SUBSTITUTED', substitutedAt: processedAt, substitutedByDocumentId: saved.id, substitutionReasonCode: null, substitutionReasonText: null, substitutionOpenedByUserId: null, substitutionOpenedAt: null, substitutionSaleVersion: null })
          .where(and(eq(nfseDocuments.companyId, dps.companyId), eq(nfseDocuments.id, substitutedId), eq(nfseDocuments.status, 'AUTHORIZED')));
        await tx.insert(nfseEvents).values({ companyId: dps.companyId, emissionId: dps.emissionId!, dpsId: dps.id, action: 'SUBSTITUTED', message: `NFS-e ${number} substituiu a nota anterior.` });
      }
      await tx.insert(integrationOutbox).values({ topic: 'nfse.archive', aggregateId: saved.id, payload: { companyId: dps.companyId, documentId: saved.id } });
    });
  }

  async archive(companyId: string, documentId: string) {
    const [document] = await this.database.db.select().from(nfseDocuments).where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId))).limit(1);
    if (!document || document.archiveStatus === 'ARCHIVED') return;
    if (!this.storage.config) throw new Error('R2 indisponível; o XML está preservado no banco.');
    const key = `fiscal/${companyId}/${document.environment}/${documentId}/nfse.xml`;
    await this.storage.put(this.storage.config.bucket, key, Buffer.from(document.officialXml, 'utf8'), 'application/xml', `nfse-${document.number}.xml`);
    await this.database.db.update(nfseDocuments).set({ archiveStatus: 'ARCHIVED', archiveKey: key }).where(and(eq(nfseDocuments.companyId, companyId), eq(nfseDocuments.id, documentId)));
  }
}
