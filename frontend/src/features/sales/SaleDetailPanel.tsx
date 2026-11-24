import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CalendarDays, CheckCircle2, CreditCard, FileText, RotateCcw, X } from 'lucide-react';
import { api, type PaymentMethod, type SaleDetail } from '../../api/client';
import { SaleActionsMenu } from './SaleActionsMenu';
import { SaleDeleteDialog } from './SaleDeleteDialog';
import { saleActions } from './sale-permissions';
import { usePermissions } from '../permissions/usePermissions';
import { SaleDropdown } from './SaleDropdown';
import { NfseSaleActions } from '../fiscal/NfseSaleActions';

const currency = (value: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
const date = (value: string | null) => value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(new Date(`${value}T12:00:00Z`)) : 'Não informada';
const today = () => new Intl.DateTimeFormat('sv-SE').format(new Date());
const methods: { value: PaymentMethod; label: string }[] = [
  { value: 'PIX', label: 'PIX' }, { value: 'CASH', label: 'Dinheiro' }, { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' }, { value: 'BOLETO', label: 'Boleto' }, { value: 'TRANSFER', label: 'Transferência' }, { value: 'OTHER', label: 'Outra' },
];
const methodName = (value: PaymentMethod) => methods.find((item) => item.value === value)?.label ?? value;
const paymentName = { DRAFT: 'A confirmar', PENDING: 'Pendente', PARTIALLY_PAID: 'Parcial', PAID: 'Recebida', OVERDUE: 'Vencida' };

export function SaleDetailPanel({ companyId, saleId, onClose, onChanged, onEdit }: { companyId: string; saleId: string; onClose: () => void; onChanged: (message: string) => void; onEdit: (sale: SaleDetail) => void }) {
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const queryClient = useQueryClient();
  const sale = useQuery({ queryKey: ['sale', companyId, saleId], queryFn: () => api.sale(companyId, saleId) });
  const access = usePermissions(companyId);
  const actions = sale.data ? saleActions(sale.data.status, access) : { edit: false, remove: false };
  const [activePayment, setActivePayment] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('PIX');
  const [receivedOn, setReceivedOn] = useState(today());
  const [deleteTrigger, setDeleteTrigger] = useState<HTMLButtonElement | null | undefined>(undefined);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const oldOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
      if (event.key === 'Escape') { closeRef.current(); return; }
      if (event.key !== 'Tab') return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled])') ?? [])
        .filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'));
      if (!focusable.length) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', close);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', close); previousFocus?.focus(); };
  }, []);

  function updated(detail: SaleDetail, message: string) {
    queryClient.setQueryData(['sale', companyId, saleId], detail);
    queryClient.invalidateQueries({ queryKey: ['sales', companyId] });
    setActivePayment(null); setReverseId(null); setError('');
    onChanged(message);
  }
  const paymentMutation = useMutation({ mutationFn: ({ installmentId, value }: { installmentId: string; value: string }) =>
    api.receiveSaleInstallment(companyId, saleId, installmentId, { amount: value, paymentMethod: method, receivedOn }, crypto.randomUUID()),
    onSuccess: (detail) => updated(detail, 'Recebimento registrado no pedido.'), onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível registrar a baixa.') });
  const reverseMutation = useMutation({ mutationFn: () => api.reverseSaleReceipt(companyId, saleId, reverseId!, reverseReason.trim(), crypto.randomUUID()),
    onSuccess: (detail) => updated(detail, 'Recebimento estornado.'), onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível estornar.') });

  return <div className="sale-detail-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside ref={panelRef} className="sale-detail" role="dialog" aria-modal="true" aria-labelledby="sale-detail-title">
    <header className="sale-detail__header"><div><span>PEDIDO DE SERVIÇOS</span><h2 id="sale-detail-title">{sale.data ? `#${sale.data.orderCode}` : 'Carregando pedido'}</h2></div>{sale.data && <SaleActionsMenu orderCode={sale.data.orderCode} actions={actions} onEdit={() => onEdit(sale.data!)} onDelete={setDeleteTrigger} />}<button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar detalhes"><X size={20} /></button></header>
    {sale.isPending ? <div className="sale-detail__loading">Carregando dados do pedido...</div> : sale.isError ? <div className="sale-detail__loading">Não foi possível carregar o pedido. <button onClick={() => sale.refetch()}>Tentar novamente</button></div> : <div className="sale-detail__scroll">
      <div className="sale-detail__intro"><div><span>{sale.data.customerNameSnapshot}</span><strong>{currency(sale.data.totalAmount)}</strong></div><span className={`sale-status sale-status--${sale.data.status.toLowerCase()}`}>{sale.data.status === 'CONFIRMED' ? 'Confirmado' : sale.data.status === 'DRAFT' ? 'Rascunho' : 'Excluída'}</span></div>
      {sale.data.status === 'DRAFT' && actions.edit && <button type="button" className="button button--primary sale-detail__resume" onClick={() => onEdit(sale.data!)}>Continuar lançamento</button>}
      {sale.data.status === 'CONFIRMED' && <NfseSaleActions companyId={companyId} saleId={saleId} saleVersion={sale.data.version} />}
      <div className="sale-detail__facts"><div><CalendarDays size={15} /><span>Venda em <strong>{date(sale.data.soldOn)}</strong></span></div><div><FileText size={15} /><span>OS <strong>{sale.data.workOrderNumber || 'Não informada'}</strong></span></div></div>
      <section className="sale-detail__section"><h3>Serviços <small>{sale.data.items.length}</small></h3>{sale.data.items.map((item) => <div key={item.id} className="sale-detail__item"><div><strong>{item.serviceNameSnapshot}</strong><span>{Number(item.quantity).toLocaleString('pt-BR')} × {currency(item.unitPrice)}{Number(item.discountAmount) > 0 ? ` · desconto ${currency(item.discountAmount)}` : ''}</span></div><strong>{currency(item.totalAmount)}</strong></div>)}</section>
      <section className="sale-detail__section"><h3>Formas de pagamento <small>{sale.data.installments.length}</small></h3>{sale.data.installments.map((part) => <div key={part.id} className="sale-detail__payment"><div className="sale-detail__payment-head"><div><CreditCard size={16} /><strong>{part.number === 1 ? 'Recebimento' : `Recebimento ${part.number}`}</strong><code title="Código do pagamento">{part.paycode ? `Código do pagamento: ${part.paycode}` : 'Sem código do pagamento'}</code></div><span className={`sale-payment-state sale-payment-state--${part.paymentStatus.toLowerCase()}`}>{paymentName[part.paymentStatus]}</span></div><div className="sale-detail__payment-amount"><strong>{currency(part.amount)}</strong><span>{methodName(part.paymentMethod)}{part.dueOn ? ` · Vencimento: ${date(part.dueOn)}` : part.initialReceivedOn && sale.data?.status === 'DRAFT' ? ` · Recebido em: ${date(part.initialReceivedOn)}` : ''}</span></div>{sale.data?.status === 'CONFIRMED' && <div className="sale-detail__payment-bottom"><span>Recebido: {currency(part.paidAmount)} · saldo: {currency(part.remainingAmount)}</span>{access.can('finance.receive') && Number(part.remainingAmount) > 0 && <button type="button" onClick={() => { setActivePayment(part.id); setAmount(part.remainingAmount); setMethod(part.paymentMethod); setError(''); }}><ArrowDownToLine size={14} /> Registrar baixa</button>}</div>}
        {activePayment === part.id && <form className="sale-detail__receive" onSubmit={(event: FormEvent) => { event.preventDefault(); const value = Number(amount).toFixed(2); if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setError('Informe um valor válido.'); return; } paymentMutation.mutate({ installmentId: part.id, value }); }}><label>Valor recebido<input type="number" min="0.01" max={part.remainingAmount} step="0.01" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label><div className="sale-detail__receive-field"><span>Forma efetiva</span><SaleDropdown label="Forma efetiva" value={method} options={methods} onChange={setMethod} disabled={paymentMutation.isPending} /></div><label>Data da baixa<input type="date" value={receivedOn} onChange={(event) => setReceivedOn(event.target.value)} required /></label><button type="submit" className="button button--primary" disabled={paymentMutation.isPending}>Confirmar baixa</button></form>}
        {part.movements.filter((entry) => entry.kind === 'RECEIPT').map((entry) => {
          const reversed = part.movements.some((movement) => movement.kind === 'REVERSAL' && movement.reversesMovementId === entry.id);
          return <div key={entry.id} className="sale-detail__movement"><CheckCircle2 size={13} /><span>{currency(entry.amount)} · Baixado em: {date(entry.effectiveOn)} · {methodName(entry.paymentMethod!)}</span>{reversed ? <small>Estornado</small> : sale.data?.status === 'CONFIRMED' && access.can('finance.reverse') ? <button type="button" title="Corrigir recebimento" onClick={() => { setReverseId(entry.id); setReverseReason(''); setError(''); }}><RotateCcw size={13} /></button> : null}</div>;
        })}
        {reverseId && part.movements.some((entry) => entry.id === reverseId) && <form className="sale-detail__reverse" onSubmit={(event) => { event.preventDefault(); if (reverseReason.trim().length >= 3) reverseMutation.mutate(); }}><input aria-label="Motivo do estorno" placeholder="Motivo da correção" value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} maxLength={100} required minLength={3} /><button type="submit" disabled={reverseMutation.isPending}>Estornar</button><button type="button" onClick={() => setReverseId(null)}>Fechar</button></form>}
      </div>)}</section>
      {sale.data.notes && <section className="sale-detail__section"><h3>Observações</h3><p>{sale.data.notes}</p></section>}
      {error && <p className="sale-detail__error" role="alert">{error}</p>}
    </div>}
  {deleteTrigger !== undefined && sale.data && <SaleDeleteDialog companyId={companyId} sale={sale.data} onClose={() => { deleteTrigger?.focus(); setDeleteTrigger(undefined); }} onDeleted={(detail) => { setDeleteTrigger(undefined); closeButtonRef.current?.focus(); updated(detail, 'Pedido excluído.'); }} />}
  </aside></div>;
}
