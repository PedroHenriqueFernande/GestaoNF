import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, CircleX, LoaderCircle, Plug, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../api/client';
import type { NfseReadinessCheck } from '../../api/nfse.types';

const ICON = { OK: CheckCircle2, WARNING: TriangleAlert, ERROR: CircleX } as const;
const STATUS_NAME = { OK: 'Conferido', WARNING: 'Atenção', ERROR: 'Pendente' } as const;

/** Shows what still blocks a homologation emission and lets an administrator probe the national environment without using a DPS number. */
export function NfseReadinessCard({ companyId }: { companyId: string }) {
  const readiness = useQuery({ queryKey: ['nfse-readiness', companyId], queryFn: () => api.nfseReadiness(companyId), enabled: !!companyId, staleTime: 0 });
  const connection = useMutation({ mutationFn: () => api.nfseConnectionTest(companyId) });
  const checks: NfseReadinessCheck[] = readiness.data?.checks ?? [];
  const pending = checks.filter(check => check.status === 'ERROR').length;

  return <section className="fiscal-card nfse-readiness" aria-labelledby="nfse-readiness-title">
    <div className="fiscal-card__head"><h2 id="nfse-readiness-title"><Plug size={18} /> Prontidão para emitir em homologação</h2>
      <button type="button" onClick={() => void readiness.refetch()} disabled={readiness.isFetching} aria-label="Verificar novamente">{readiness.isFetching ? <LoaderCircle size={15} className="is-spinning" /> : <RefreshCw size={15} />}</button></div>
    {readiness.isPending ? <p role="status">Verificando...</p> : readiness.isError ? <p className="fiscal-alert fiscal-alert--error" role="alert">Não foi possível verificar a prontidão. Tente novamente.</p> : <>
      <p className={`nfse-readiness__summary ${readiness.data.ready ? 'is-ready' : 'is-blocked'}`} role="status">
        {readiness.data.ready ? 'Tudo configurado para emitir em homologação.' : `${pending} ${pending === 1 ? 'pendência impede' : 'pendências impedem'} a emissão.`}</p>
      <ul className="nfse-readiness__list">{checks.map(check => { const Icon = ICON[check.status]; return <li key={check.code} className={`is-${check.status.toLowerCase()}`}>
        <Icon size={17} aria-hidden="true" /><div><strong>{check.label}<span className="sr-only"> — {STATUS_NAME[check.status]}</span></strong><p>{check.message}</p></div></li>; })}</ul>
    </>}
    <div className="nfse-readiness__probe">
      <button type="button" className="button button--secondary" onClick={() => connection.mutate()} disabled={connection.isPending || !readiness.data}>
        {connection.isPending ? <LoaderCircle size={15} className="is-spinning" /> : <Plug size={15} />} Testar conexão com o ambiente nacional</button>
      <small>Consulta uma DPS que ainda não existe. Não emite nota e não consome numeração.</small>
      {connection.isError && <p className="fiscal-alert fiscal-alert--error" role="alert">{connection.error instanceof Error ? connection.error.message : 'Não foi possível executar o teste.'}</p>}
      {connection.data && <p className={`fiscal-alert ${connection.data.ok ? 'fiscal-alert--success' : 'fiscal-alert--error'}`} role="status">{connection.data.message}{connection.data.httpStatus !== null ? ` (HTTP ${connection.data.httpStatus})` : ''}</p>}
    </div>
  </section>;
}
