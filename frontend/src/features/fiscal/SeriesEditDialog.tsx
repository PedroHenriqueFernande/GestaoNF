import { useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';

const MAX_DPS = '999999999999999';

export function SeriesEditDialog({ companyId, seriesId, onClose, onSaved }: {
  companyId: string;
  seriesId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const detail = useQuery({
    queryKey: ['fiscal-series-detail', companyId, seriesId],
    queryFn: () => api.fiscalSeriesDetail(companyId, seriesId),
    refetchOnWindowFocus: false,
  });
  const series = detail.data;
  const [seriesNumber, setSeriesNumber] = useState<string>();
  const [nextNumber, setNextNumber] = useState<string>();
  const [validation, setValidation] = useState('');
  const save = useMutation({
    mutationFn: (input: { expectedVersion: number; seriesNumber?: number; nextNumber?: string }) =>
      api.editFiscalSeries(companyId, seriesId, input),
    onSuccess: onSaved,
  });

  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const currentSeriesNumber = seriesNumber ?? String(series?.seriesNumber ?? '');
  const currentNextNumber = nextNumber ?? series?.nextNumber ?? '';
  const changedSeriesNumber = Number(currentSeriesNumber) !== series?.seriesNumber;
  const changedNextNumber = currentNextNumber !== series?.nextNumber;
  const canChangeNextNumber = !!series && (!series.locked || BigInt(series.nextNumber) < BigInt(MAX_DPS));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!series || save.isPending || detail.isFetching || (!changedSeriesNumber && !changedNextNumber)) return;
    if (series.locked && changedNextNumber && BigInt(currentNextNumber) < BigInt(series.nextNumber)) {
      setValidation('O próximo número da DPS deve ser maior que o atual.');
      return;
    }
    setValidation('');
    save.mutate({
      expectedVersion: series.version,
      ...(changedSeriesNumber ? { seriesNumber: Number(currentSeriesNumber) } : {}),
      ...(changedNextNumber ? { nextNumber: currentNextNumber } : {}),
    });
  }

  return <dialog ref={dialog} className="fiscal-series-dialog" aria-labelledby="fiscal-series-dialog-title"
    onCancel={event => { event.preventDefault(); if (!save.isPending) onClose(); }}>
    <h2 id="fiscal-series-dialog-title">Editar série</h2>
    {detail.isPending && <p role="status">Carregando série...</p>}
    {detail.isError && <p className="fiscal-alert fiscal-alert--error" role="alert">Não foi possível carregar a série.</p>}
    {series && !detail.isError ? <form onSubmit={submit}>
      <dl className="fiscal-series-dialog__info">
        <div><dt>Ambiente</dt><dd>{series.environment === 'PRODUCTION' ? 'Produção' : 'Homologação'}</dd></div>
        <div><dt>Município (IBGE)</dt><dd>{series.municipalityIbgeCode}</dd></div>
        <div><dt>Número inicial</dt><dd>{series.initialNumber}</dd></div>
      </dl>
      <fieldset className="fiscal-form fiscal-series-dialog__fields" disabled={save.isPending || detail.isFetching}>
        <label>Número da série<input type="number" min="1" max="49999" required value={currentSeriesNumber}
          disabled={series.locked} onChange={event => setSeriesNumber(event.target.value)} /></label>
        <label>Próximo número da DPS<input inputMode="numeric" pattern="[1-9][0-9]{0,14}" required value={currentNextNumber}
          disabled={!canChangeNextNumber} onChange={event => { setNextNumber(event.target.value); setValidation(''); }} /></label>
      </fieldset>
      {series.locked && <p className="fiscal-series-dialog__hint">Esta série tem vínculos ou histórico fiscal. O próximo número da DPS só pode aumentar.</p>}
      {!canChangeNextNumber && <p className="fiscal-series-dialog__hint">A numeração chegou ao limite desta série.</p>}
      {series.adjustments.length > 0 && <details className="fiscal-history">
        <summary>Histórico da numeração</summary>
        {series.adjustments.map(entry => <p key={entry.id}>
          <strong>{entry.oldNextNumber} → {entry.newNextNumber}</strong> · {entry.reason} · {entry.actorName} · {new Date(entry.createdAt).toLocaleString('pt-BR')}
        </p>)}
      </details>}
      {(validation || save.isError) && <p className="fiscal-alert fiscal-alert--error" role="alert">
        {validation || (save.error instanceof Error ? save.error.message : 'Não foi possível salvar a série.')}
      </p>}
      <footer>
        <button type="button" className="button button--secondary" disabled={save.isPending} onClick={onClose}>Cancelar</button>
        <button type="submit" className="button button--primary"
          disabled={save.isPending || detail.isFetching || (!changedSeriesNumber && !changedNextNumber)}>
          {save.isPending ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </footer>
    </form> : <footer><button type="button" className="button button--secondary" onClick={onClose}>Fechar</button></footer>}
  </dialog>;
}
