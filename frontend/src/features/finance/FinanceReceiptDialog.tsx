import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, ChevronDown, X } from 'lucide-react';
import { api, type FinancePayment, type FinanceSale, type PaymentMethod } from '../../api/client';
import { currency, methodOptions, moneyCents, normalizeMoney, today } from './finance-utils';

/** Atalho "Baixar" da lista: só os dados da baixa, preenchidos com o saldo em aberto e a forma prevista. */
export function FinanceReceiptDialog({ companyId, sale, payment, onClose, onDone }: {
  companyId: string; sale: FinanceSale; payment: FinancePayment; onClose: () => void; onDone: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const modalRef = useRef<HTMLElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const [amount, setAmount] = useState(() => payment.remainingAmount.replace('.', ','));
  const [method, setMethod] = useState<PaymentMethod>(payment.paymentMethod);
  const [receivedOn, setReceivedOn] = useState(today);
  const [reference, setReference] = useState('');
  /** Nova chave a cada alteração: reenviar os mesmos dados é idempotente; dados novos são outra baixa. */
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const change = <T,>(set: (value: T) => void) => (value: T) => { set(value); setKey(crypto.randomUUID()); };

  const receipt = useMutation({
    mutationFn: (value: string) => api.receiveSaleInstallment(companyId, sale.saleId, payment.installmentId, { amount: value, paymentMethod: method, receivedOn, reference: reference.trim() || null }, key),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finance-detail', companyId, sale.saleId] });
      void queryClient.invalidateQueries({ queryKey: ['sales', companyId] });
      void queryClient.invalidateQueries({ queryKey: ['sale', companyId, sale.saleId] });
      onDone(`Baixa registrada no pedido #${sale.orderCode}.`);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a baixa.'),
  });
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const busy = useRef(false);
  busy.current = receipt.isPending;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    amountRef.current?.focus();
    amountRef.current?.select();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { if (!busy.current) closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? []).filter((element) => element.getClientRects().length > 0);
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeMoney(amount);
    if (!normalized || moneyCents(normalized) <= 0n || moneyCents(normalized) > moneyCents(payment.remainingAmount)) {
      setError(`Informe um valor entre R$ 0,01 e ${currency(payment.remainingAmount)}.`);
      return;
    }
    setError('');
    receipt.mutate(normalized);
  }

  const title = payment.number === 1 ? 'Recebimento' : `Recebimento ${payment.number}`;
  return <div className="finance-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !receipt.isPending) onClose(); }}>
    <section ref={modalRef} className="finance-detail finance-detail--receipt" role="dialog" aria-modal="true" aria-labelledby="finance-receipt-dialog-title">
      <header className="finance-detail__header">
        <div><span>REGISTRAR BAIXA · PEDIDO #{sale.orderCode}</span><h2 id="finance-receipt-dialog-title">{title}</h2><p>{sale.customerName} · Código do pagamento {payment.paycode} · {currency(payment.remainingAmount)} em aberto</p></div>
        <button type="button" aria-label="Fechar baixa" onClick={onClose} disabled={receipt.isPending}><X size={20} /></button>
      </header>
      <form className="finance-detail__scroll finance-receipt-form" onSubmit={submit}>
        <div className="finance-receipt-form__fields">
          <label>Valor recebido<input ref={amountRef} type="text" inputMode="decimal" value={amount} onChange={(event) => change(setAmount)(event.target.value)} disabled={receipt.isPending} required /></label>
          <label>Forma de pagamento<span className="finance-native-select"><select value={method} onChange={(event) => change(setMethod)(event.target.value as PaymentMethod)} disabled={receipt.isPending}>{methodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} aria-hidden="true" /></span></label>
          <label>Data da baixa<input type="date" value={receivedOn} onChange={(event) => change(setReceivedOn)(event.target.value)} disabled={receipt.isPending} required /></label>
          <label>Referência opcional<input type="text" value={reference} maxLength={100} onChange={(event) => change(setReference)(event.target.value)} placeholder="Ex.: comprovante, transação" disabled={receipt.isPending} /></label>
        </div>
        {error && <p className="finance-detail__error" role="alert">{error}</p>}
        <footer className="finance-receipt-form__actions">
          <button type="button" className="button button--secondary" onClick={onClose} disabled={receipt.isPending}>Cancelar</button>
          <button type="submit" className="button button--primary" disabled={receipt.isPending}><ArrowDownToLine size={15} /> {receipt.isPending ? 'Registrando...' : 'Confirmar baixa'}</button>
        </footer>
      </form>
    </section>
  </div>;
}
