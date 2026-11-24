import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, type SaleDetail } from '../../api/client';

/** Confirmação de "Excluir" (D15): motivo obrigatório; a venda fica no histórico como Excluída. */
export function SaleDeleteDialog({ companyId, sale, onClose, onDeleted }: {
  companyId: string; sale: { id: string; orderCode: string; version: number }; onClose: () => void; onDeleted: (detail: SaleDetail) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  /** Trava síncrona: o `isPending` do Query só atualiza num tick posterior, e um duplo clique enviaria duas vezes. */
  const sending = useRef(false);
  useEffect(() => { ref.current?.showModal(); }, []);
  const remove = useMutation({
    mutationFn: () => api.cancelSale(companyId, sale.id, sale.version, reason.trim()),
    onSuccess: (detail) => { ref.current?.close(); onDeleted(detail); },
    onSettled: () => { sending.current = false; },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível excluir a venda.'),
  });
  /** Fecha antes de avisar o pai, que devolve o foco ao ⋯ (inerte enquanto o diálogo está aberto). */
  const cancel = () => { if (remove.isPending) return; ref.current?.close(); onClose(); };
  const submit = (event: FormEvent) => { event.preventDefault(); if (reason.trim().length < 3 || sending.current) return; sending.current = true; remove.mutate(); };
  return <dialog ref={ref} className="sale-delete-dialog" aria-labelledby="sale-delete-title" aria-describedby="sale-delete-text" onCancel={(event) => { event.preventDefault(); cancel(); }}>
    <form onSubmit={submit}>
      <h2 id="sale-delete-title">Excluir venda #{sale.orderCode}</h2>
      <p id="sale-delete-text">A venda ficará no histórico como Excluída. Recebimentos ou NFS-e ativos impedem a exclusão.</p>
      <label className="field"><span>Motivo <b>*</b></span><textarea autoFocus required minLength={3} maxLength={500} value={reason} onChange={(event) => { setReason(event.target.value); setError(''); }} /></label>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <footer><button type="button" className="button button--secondary" onClick={cancel}>Voltar</button>
        <button type="submit" className="button button--danger" disabled={remove.isPending}>{remove.isPending ? 'Excluindo...' : 'Excluir venda'}</button></footer>
    </form>
  </dialog>;
}
