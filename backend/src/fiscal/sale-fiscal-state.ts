import { and, eq, inArray } from 'drizzle-orm';
import { nfseDocumentEvents, nfseDocuments, nfseDps } from '@gestaonf/database/schema';
import type { DatabaseService } from '../database/database.module.js';
import type { NfseSnapshot } from './nfse.types.js';

type Db = DatabaseService['db'] | Parameters<Parameters<DatabaseService['db']['transaction']>[0]>[0];

export const DPS_IN_PROGRESS = ['RESERVED', 'READY', 'SENDING', 'UNKNOWN'] as const;
export const EVENT_IN_PROGRESS = ['PENDING', 'READY', 'SENDING', 'UNKNOWN'] as const;

export type ActiveFiscalDocument = {
  id: string; dpsId: string; number: string; accessKey: string; itemIds: string[];
  substitutionOpen: boolean; substitutionSaleVersion: number | null;
};
export type OpenSubstitution = { documentId: string; accessKey: string; number: string; reasonCode: string; reasonText: string | null; saleVersion: number };
export type SaleFiscalState = {
  /** A DPS or a document event is still being processed. */
  inProgress: boolean;
  /** Authorized (not cancelled, not substituted) documents. */
  activeDocuments: ActiveFiscalDocument[];
  /** Sale items already covered by an active document. */
  coveredItemIds: Set<string>;
  substitution: OpenSubstitution | null;
  canEditSale: boolean;
  canCancelSale: boolean;
  lockReason: string | null;
};

/**
 * Single source of truth for what a sale's fiscal history allows.
 * Call it inside the transaction that already holds the sale row lock so the answer cannot change underneath the caller.
 */
export async function saleFiscalState(db: Db, companyId: string, saleId: string): Promise<SaleFiscalState> {
  const dpsRows = await db.select({ id: nfseDps.id, status: nfseDps.status, groupKey: nfseDps.groupKey, snapshot: nfseDps.snapshot })
    .from(nfseDps).where(and(eq(nfseDps.companyId, companyId), eq(nfseDps.sourceSaleId, saleId)));
  const documents = dpsRows.length ? await db.select().from(nfseDocuments)
    .where(and(eq(nfseDocuments.companyId, companyId), inArray(nfseDocuments.dpsId, dpsRows.map(row => row.id)))) : [];
  const events = documents.length ? await db.select({ id: nfseDocumentEvents.id }).from(nfseDocumentEvents)
    .where(and(eq(nfseDocumentEvents.companyId, companyId), inArray(nfseDocumentEvents.documentId, documents.map(d => d.id)), inArray(nfseDocumentEvents.status, [...EVENT_IN_PROGRESS]))) : [];

  const inProgress = dpsRows.some(row => (DPS_IN_PROGRESS as readonly string[]).includes(row.status)) || events.length > 0;
  const dpsById = new Map(dpsRows.map(row => [row.id, row]));
  const activeDocuments: ActiveFiscalDocument[] = documents.filter(d => d.status === 'AUTHORIZED').map(d => {
    const dps = dpsById.get(d.dpsId)!;
    const group = (dps.snapshot as unknown as NfseSnapshot | null)?.groups?.find(g => g.key === dps.groupKey);
    return { id: d.id, dpsId: d.dpsId, number: d.number, accessKey: d.accessKey, itemIds: group?.items.map(item => item.id) ?? [],
      substitutionOpen: d.substitutionReasonCode !== null, substitutionSaleVersion: d.substitutionSaleVersion };
  });
  const open = documents.find(d => d.status === 'AUTHORIZED' && d.substitutionReasonCode !== null);
  const substitution: OpenSubstitution | null = open ? { documentId: open.id, accessKey: open.accessKey, number: open.number, reasonCode: open.substitutionReasonCode!, reasonText: open.substitutionReasonText, saleVersion: open.substitutionSaleVersion! } : null;

  const hasActive = activeDocuments.length > 0;
  const canEditSale = !inProgress && (!hasActive || substitution !== null);
  const canCancelSale = !inProgress && !hasActive;
  const lockReason = canEditSale && canCancelSale ? null
    : inProgress ? 'Há uma solicitação fiscal em andamento para esta venda. Aguarde o resultado da NFS-e antes de alterá-la.'
    : substitution ? 'Há uma NFS-e autorizada com substituição aberta. Corrija a venda e emita a substituta, ou desista da substituição, antes de cancelar a venda.'
    : 'Há uma NFS-e autorizada para esta venda. Cancele ou substitua a nota antes de alterar ou cancelar a venda.';
  return { inProgress, activeDocuments, coveredItemIds: new Set(activeDocuments.flatMap(d => d.itemIds)), substitution, canEditSale, canCancelSale, lockReason };
}
