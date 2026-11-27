import { useId, useLayoutEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import type { MeetingConflict } from '../../api/client';
import { formatMeetingTime } from './meeting-time';

export type MeetingStatusAction = 'COMPLETED' | 'NO_SHOW' | 'CANCELED' | 'REOPEN';

const copy: Record<MeetingStatusAction, { title: string; text: string; confirm: string }> = {
  COMPLETED: { title: 'Concluir reunião?', text: 'Registre o resultado e os próximos passos, se quiser.', confirm: 'Concluir reunião' },
  NO_SHOW: { title: 'Marcar como não compareceu?', text: 'O compromisso será encerrado com o registro de que o lead não compareceu.', confirm: 'Confirmar' },
  CANCELED: { title: 'Cancelar reunião?', text: 'O compromisso será encerrado. Informe o motivo, se quiser.', confirm: 'Cancelar reunião' },
  REOPEN: { title: 'Reabrir reunião?', text: 'O compromisso volta a ficar agendado no mesmo horário.', confirm: 'Reabrir reunião' },
};

/** Confirmação da troca de situação, aberta sobre o modal da reunião (que fica inerte enquanto ela existe). */
export function MeetingStatusDialog({ action, busy, error, conflicts, confirmedConflict, timezone, result, nextSteps, cancelReason, onResult, onNextSteps, onCancelReason, onConfirmConflict, onConfirm, onBack }: {
  action: MeetingStatusAction; busy: boolean; error: string; conflicts: MeetingConflict[]; confirmedConflict: boolean; timezone: string;
  result: string; nextSteps: string; cancelReason: string;
  onResult: (value: string) => void; onNextSteps: (value: string) => void; onCancelReason: (value: string) => void;
  onConfirmConflict: () => void; onConfirm: () => void; onBack: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  const back = () => { if (!busy) onBack(); };
  const { title, text, confirm } = copy[action];
  return <dialog ref={ref} className="agenda-status-dialog" aria-labelledby={titleId} aria-describedby={textId} onCancel={(event) => { event.preventDefault(); back(); }} onKeyDown={(event) => { if (event.key !== 'Escape') return; event.preventDefault(); event.stopPropagation(); back(); }}>
    <h2 id={titleId}>{title}</h2>
    <p id={textId}>{text}</p>
    {action === 'COMPLETED' && <>
      <label className="field"><span>Resultado da reunião</span><textarea autoFocus value={result} onChange={(event) => onResult(event.target.value)} rows={3} maxLength={10000} /></label>
      <label className="field"><span>Próximos passos</span><textarea value={nextSteps} onChange={(event) => onNextSteps(event.target.value)} rows={3} maxLength={10000} /></label>
    </>}
    {action === 'CANCELED' && <label className="field"><span>Motivo do cancelamento</span><textarea autoFocus value={cancelReason} onChange={(event) => onCancelReason(event.target.value)} rows={3} maxLength={1000} /></label>}
    {conflicts.length > 0 && !confirmedConflict && <div className="agenda-conflicts" role="alert"><AlertCircle size={17} /><div><strong>Horário ocupado para este responsável</strong>{conflicts.map((item) => <p key={item.id}>{formatMeetingTime(item.startsAt, timezone)}–{formatMeetingTime(item.endsAt, timezone, { hour: '2-digit', minute: '2-digit' })}</p>)}<button type="button" onClick={onConfirmConflict}>Confirmar sobreposição</button></div></div>}
    {confirmedConflict && conflicts.length > 0 && <p className="agenda-conflict-accepted">Sobreposição confirmada. Clique em “{confirm}” para continuar.</p>}
    {error && !(conflicts.length > 0 && !confirmedConflict) && <p className="inline-error" role="alert">{error}</p>}
    <footer>
      <button type="button" className="button button--secondary" onClick={back} disabled={busy}>Voltar</button>
      <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy || (conflicts.length > 0 && !confirmedConflict)}>{busy ? 'Salvando...' : confirm}</button>
    </footer>
  </dialog>;
}
