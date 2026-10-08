import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CalendarDays, Check, ChevronDown, RotateCcw, Save, X } from 'lucide-react';
import { api, type FinancePayment, type PaymentMethod } from '../../api/client';
import { currency, methodName, methodOptions, moneyCents, normalizeMoney, shortDate, today } from './finance-utils';

function paymentLabel(payment: FinancePayment): string {
  if (payment.isOverdue) return 'Vencido';
  return payment.settlement === 'PAID' ? 'Recebido' : payment.settlement === 'PARTIAL' ? 'Parcial' : 'Pendente';
}

export function FinancePaymentModal({ companyId, saleId, installmentId, onClose, onChanged }: {
  companyId: string; saleId: string; installmentId: string; onClose: () => void; onChanged: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const detail = useQuery({ queryKey: ['finance-detail', companyId, saleId], queryFn: () => api.financeDetail(companyId, saleId) });
  const sale = detail.data;
  const payment = sale?.payments.find((entry) => entry.installmentId === installmentId);
  const [soldOn, setSoldOn] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [showReceipt, setShowReceipt] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptMethod, setReceiptMethod] = useState<PaymentMethod>('PIX');
  const [receiptDate, setReceiptDate] = useState(today);
  const [receiptReference, setReceiptReference] = useState('');
  const [receiptKey, setReceiptKey] = useState(() => crypto.randomUUID());
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseKey, setReverseKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sale || !payment) return;
    setSoldOn(sale.soldOn);
    setDueOn(payment.dueOn ?? '');
  }, [sale?.soldOn, payment?.dueOn, installmentId]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])
        .filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, []);

  function refresh(message: string) {
    queryClient.invalidateQueries({ queryKey: ['finance-detail', companyId, saleId] });
    queryClient.invalidateQueries({ queryKey: ['sales', companyId] });
    queryClient.invalidateQueries({ queryKey: ['sale', companyId, saleId] });
    setShowReceipt(false);
    setReverseId(null);
    setError('');
    onChanged(message);
  }

  const datesMutation = useMutation({
    mutationFn: () => api.updateFinanceDates(companyId, saleId, installmentId, {
      expectedVersion: sale!.version, soldOn, dueOn: payment!.initialReceivedOn ? null : dueOn,
    }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['finance-detail', companyId, saleId], updated);
      refresh('Datas do lançamento atualizadas.');
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível atualizar as datas.'),
  });
  const receiptMutation = useMutation({
    mutationFn: ({ amount }: { amount: string }) => api.receiveSaleInstallment(companyId, saleId, installmentId, {
      amount, paymentMethod: receiptMethod, receivedOn: receiptDate, reference: receiptReference.trim() || null,
    }, receiptKey),
    onSuccess: () => refresh('Baixa registrada no financeiro.'),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a baixa.'),
  });
  const reverseMutation = useMutation({
    mutationFn: () => api.reverseSaleReceipt(companyId, saleId, reverseId!, reverseReason.trim(), reverseKey),
    onSuccess: () => refresh('Recebimento estornado.'),
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível estornar o recebimento.'),
  });

  function submitDates(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sale || !payment) return;
    if (!soldOn || (!payment.initialReceivedOn && !dueOn)) {
      setError('Informe a data de lançamento e o vencimento deste recebimento.');
      return;
    }
    setError('');
    datesMutation.mutate();
  }

  function openReceipt() {
    if (!payment) return;
    setShowReceipt(true);
    setReverseId(null);
    setReceiptAmount(payment.remainingAmount.replace('.', ','));
    setReceiptMethod(payment.paymentMethod);
    setReceiptDate(today());
    setReceiptReference('');
    setReceiptKey(crypto.randomUUID());
    setError('');
  }

  function submitReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!payment) return;
    const normalized = normalizeMoney(receiptAmount);
    if (!normalized || moneyCents(normalized) <= 0n || moneyCents(normalized) > moneyCents(payment.remainingAmount)) {
      setError(`Informe um valor entre R$ 0,01 e ${currency(payment.remainingAmount)}.`);
      return;
    }
    receiptMutation.mutate({ amount: normalized });
  }

  const dateChanged = !!sale && !!payment && (soldOn !== sale.soldOn || dueOn !== (payment.dueOn ?? ''));
  const received = payment?.movements.filter((movement) => movement.kind === 'RECEIPT') ?? [];

  return <div className="finance-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={modalRef} className="finance-detail" role="dialog" aria-modal="true" aria-labelledby="finance-detail-title">
      <header className="finance-detail__header">
        <div><span>FINANCEIRO · {sale ? `PEDIDO #${sale.orderCode}` : 'RECEBIMENTO'}</span><h2 id="finance-detail-title">{payment ? payment.number === 1 ? 'Recebimento' : `Recebimento ${payment.number}` : 'Carregando recebimento'}</h2><p>{sale?.customerName ?? 'Detalhes da parcela'}{payment && ` · Código do pagamento ${payment.paycode}`}</p></div>
        <button type="button" aria-label="Fechar detalhes" onClick={onClose}><X size={20} /></button>
      </header>
      {detail.isPending ? <div className="finance-detail__state">Carregando recebimento...</div> : detail.isError ? <div className="finance-detail__state" role="alert">Não foi possível carregar o recebimento. <button type="button" onClick={() => detail.refetch()}>Tentar novamente</button></div> : !sale || !payment ? <div className="finance-detail__state" role="alert">Este recebimento não foi encontrado no pedido.</div> : <div className="finance-detail__scroll">
        <div className="finance-detail__payment-summary"><div><span className="finance-detail__payment-number">{String(payment.number).padStart(2, '0')}</span><div><strong>{methodName(payment.paymentMethod)}</strong><small>Código do pagamento {payment.paycode}</small></div></div><span className={`finance-status finance-status--${payment.isOverdue ? 'overdue' : payment.settlement.toLowerCase()}`}>{paymentLabel(payment)}</span></div>
        <div className="finance-detail__totals">
          <div><span>Valor do recebimento</span><strong>{currency(payment.originalAmount)}</strong></div>
          <div><span>Baixado</span><strong>{currency(payment.paidAmount)}</strong></div>
          <div><span>Em aberto</span><strong>{currency(payment.remainingAmount)}</strong></div>
        </div>
        <div className="finance-detail__meta"><span>Pedido #{sale.orderCode} · Total {currency(sale.totalAmount)}</span><span>OS {sale.workOrderNumber || 'não informada'}</span></div>
        {error && <p className="finance-detail__error" role="alert">{error}</p>}

        <section className="finance-detail__dates" aria-labelledby="finance-dates-title">
          <div className="finance-detail__section-heading"><h3 id="finance-dates-title"><CalendarDays size={17} /> Datas</h3></div>
          <form onSubmit={submitDates}>
            <div className="finance-detail__date-fields">
              <label>Data de lançamento<input type="date" value={soldOn} onChange={(event) => { setSoldOn(event.target.value); setError(''); }} required /><small>Data da venda, compartilhada por todos os recebimentos do pedido.</small></label>
              <label>Data de vencimento<input type="date" value={dueOn} onChange={(event) => { setDueOn(event.target.value); setError(''); }} disabled={!!payment.initialReceivedOn} required={!payment.initialReceivedOn} /><small>{payment.initialReceivedOn ? `Recebido na venda em ${shortDate(payment.initialReceivedOn)}; sem vencimento.` : 'Vencimento deste recebimento.'}</small></label>
            </div>
            <div className="finance-detail__date-actions">{dateChanged && <button type="button" className="button button--secondary" disabled={datesMutation.isPending} onClick={() => { setSoldOn(sale.soldOn); setDueOn(payment.dueOn ?? ''); setError(''); }}>Desfazer</button>}<button type="submit" className="button button--primary" disabled={!dateChanged || datesMutation.isPending}><Save size={14} /> {datesMutation.isPending ? 'Salvando...' : 'Salvar datas'}</button></div>
          </form>
        </section>

        {moneyCents(payment.remainingAmount) > 0n && <section className="finance-detail__section" aria-labelledby="finance-receipt-title">
          <div className="finance-detail__section-heading"><h3 id="finance-receipt-title">Registrar baixa</h3><span>{currency(payment.remainingAmount)} em aberto</span></div>
          <button type="button" className="finance-detail__receive-trigger" onClick={() => showReceipt ? setShowReceipt(false) : openReceipt()}><ArrowDownToLine size={15} /> {showReceipt ? 'Fechar formulário' : 'Registrar recebimento'}</button>
          {showReceipt && <form className="finance-detail__receive-form" onSubmit={submitReceipt}>
            <label>Valor recebido<input type="text" inputMode="decimal" value={receiptAmount} onChange={(event) => { setReceiptAmount(event.target.value); setReceiptKey(crypto.randomUUID()); }} required /></label>
            <label>Forma de pagamento<span className="finance-native-select"><select value={receiptMethod} onChange={(event) => { setReceiptMethod(event.target.value as PaymentMethod); setReceiptKey(crypto.randomUUID()); }}>{methodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
            <label>Data da baixa<input type="date" value={receiptDate} onChange={(event) => { setReceiptDate(event.target.value); setReceiptKey(crypto.randomUUID()); }} required /></label>
            <label>Referência opcional<input type="text" value={receiptReference} maxLength={100} onChange={(event) => { setReceiptReference(event.target.value); setReceiptKey(crypto.randomUUID()); }} placeholder="Ex.: comprovante, transação" /></label>
            <button type="submit" className="button button--primary" disabled={receiptMutation.isPending}>{receiptMutation.isPending ? 'Registrando...' : 'Confirmar baixa'}</button>
          </form>}
        </section>}

        {received.length > 0 && <section className="finance-detail__history" aria-label="Histórico de baixas"><h5>Histórico de baixas</h5>{payment.movements.map((movement) => {
          const reversed = movement.kind === 'RECEIPT' && payment.movements.some((entry) => entry.reversesMovementId === movement.id);
          return <div key={movement.id} className={`finance-detail__movement${movement.kind === 'REVERSAL' ? ' is-reversal' : ''}`}><span className="finance-detail__movement-icon">{movement.kind === 'RECEIPT' ? <Check size={13} /> : <RotateCcw size={13} />}</span><div><strong>{movement.kind === 'RECEIPT' ? 'Baixa' : 'Estorno'} de {currency(movement.amount)}</strong><span>{shortDate(movement.effectiveOn)}{movement.kind === 'RECEIPT' && movement.paymentMethod ? ` · ${methodName(movement.paymentMethod)}` : ''}{movement.reference ? ` · ${movement.reference}` : ''}</span></div>{reversed ? <span className="finance-detail__reversed">Estornado</span> : movement.kind === 'RECEIPT' ? <button type="button" aria-label={`Estornar baixa de ${currency(movement.amount)}`} title="Estornar baixa" onClick={() => { setReverseId(movement.id); setReverseReason(''); setReverseKey(crypto.randomUUID()); setShowReceipt(false); setError(''); }}><RotateCcw size={15} /></button> : null}</div>;
        })}</section>}
        {reverseId && payment.movements.some((movement) => movement.id === reverseId) && <form className="finance-detail__reverse-form" onSubmit={(event) => { event.preventDefault(); if (reverseReason.trim().length >= 3) reverseMutation.mutate(); }}><label>Motivo do estorno<input value={reverseReason} onChange={(event) => { setReverseReason(event.target.value); setReverseKey(crypto.randomUUID()); }} minLength={3} maxLength={100} required placeholder="Descreva a correção" /></label><div><button type="button" className="button button--secondary" onClick={() => setReverseId(null)}>Cancelar</button><button type="submit" className="button button--danger" disabled={reverseMutation.isPending}>{reverseMutation.isPending ? 'Estornando...' : 'Confirmar estorno'}</button></div></form>}
      </div>}
    </section>
  </div>;
}
