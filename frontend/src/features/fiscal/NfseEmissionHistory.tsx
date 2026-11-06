import { CheckCircle2, RefreshCw } from 'lucide-react';
import type { NfseEmission, NfseSaleState } from '../../api/nfse.types';
import { NfseDocumentActions } from './NfseDocumentActions';

const statusName: Record<string, string> = { RESERVED: 'Preparando', READY: 'Pronta para envio', SENDING: 'Enviando', UNKNOWN: 'Consultando resultado', REJECTED: 'Rejeitada', AUTHORIZED: 'Autorizada', PROCESSING: 'Processando', PARTIAL: 'Parcialmente concluída' };

/** Every attempt for the sale, oldest first, each linked to the one it follows. */
export function NfseEmissionHistory({ companyId, saleId, emissions, state, canManage, resuming, onResume, onXml, onError }: {
  companyId: string; saleId: string; emissions: NfseEmission[]; state: NfseSaleState | undefined; canManage: boolean; resuming: boolean;
  onResume: (dpsId: string) => void; onXml: (id: string, number: string) => void; onError: (message: string) => void;
}) {
  return <>{emissions.map((emission, index) => {
    const rejected = emission.status === 'REJECTED';
    return <section className="nfse-emission" key={emission.id}>
      <h3><CheckCircle2 size={18} /> {emission.kind === 'SUBSTITUTION' ? 'Substituição' : index === 0 ? 'Emissão' : `Nova emissão (tentativa ${index + 1})`} em {emission.environment === 'HOMOLOGATION' ? 'homologação' : 'produção'} <span>{statusName[emission.status] || emission.status}</span></h3>
      {rejected && <p className="nfse-emission__hint">A nota foi rejeitada. Corrija a venda ou os cadastros indicados abaixo e emita novamente; um novo número será usado.</p>}
      {emission.items.map(item => <div className="nfse-emission__item" key={item.id}>
        <div><strong>DPS {item.seriesNumber}/{item.number}</strong><span>{statusName[item.status] || item.status}</span></div>
        {item.document && <NfseDocumentActions companyId={companyId} saleId={saleId} document={item.document} state={state} canManage={canManage} onXml={onXml} onError={onError} />}
        {item.lastError && <p className="nfse-emission__error">{item.lastError}</p>}
        {canManage && !['AUTHORIZED', 'REJECTED'].includes(item.status) && <button className="button button--secondary" type="button" disabled={resuming} onClick={() => onResume(item.id)}><RefreshCw size={14} />{item.status === 'UNKNOWN' ? 'Consultar resultado' : 'Retomar processamento'}</button>}
      </div>)}
      <details><summary>Histórico da emissão</summary>{emission.events.map(event => <p key={event.id}>{new Date(event.createdAt).toLocaleString('pt-BR')} · {event.message}</p>)}</details>
    </section>;
  })}</>;
}
