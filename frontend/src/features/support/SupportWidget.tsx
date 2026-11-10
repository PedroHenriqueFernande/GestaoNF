import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LifeBuoy, X } from 'lucide-react';
import { SupportPanel } from './SupportPanel';
import './support.css';

const EXIT_MS = 180;

export function SupportWidget({ companyId, userId }: { companyId: string; userId: string }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  // Mantém o painel montado durante a animação de saída.
  useEffect(() => {
    if (open) { setMounted(true); return; }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // No celular o botão fica oculto com o painel aberto; o foco volta a ele só depois de reaparecer.
  const close = useCallback(() => {
    setOpen(false);
    window.requestAnimationFrame(() => fabRef.current?.focus());
  }, []);

  function onFabKeyDown(event: KeyboardEvent) {
    if (open && event.key === 'Escape' && !event.defaultPrevented) close();
  }

  return <>
    {mounted && <SupportPanel key={`${userId}:${companyId}`} userId={userId} companyId={companyId} closing={!open} onClose={close} />}
    <button ref={fabRef} type="button" className="support-fab" data-open={open} aria-label={open ? 'Fechar ajuda' : 'Abrir ajuda'} aria-expanded={open} aria-controls={mounted ? 'support-panel' : undefined} title={open ? 'Fechar ajuda' : 'Ajuda'} onKeyDown={onFabKeyDown} onClick={() => setOpen((value) => !value)}>
      <LifeBuoy className="support-fab__icon support-fab__icon--open" size={24} aria-hidden="true" />
      <X className="support-fab__icon support-fab__icon--close" size={24} aria-hidden="true" />
    </button>
  </>;
}
