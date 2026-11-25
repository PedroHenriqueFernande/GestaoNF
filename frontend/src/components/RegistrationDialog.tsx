import { useCallback, useEffect, useId, useLayoutEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

type Props = {
  eyebrow: string;
  title: string;
  description?: string;
  panelClassName: string;
  initialFocus?: string;
  dismissDisabled?: boolean;
  closeOnSuccess?: boolean;
  overlay?: ReactNode;
  onClose: () => void;
  children: (requestClose: () => void) => ReactNode;
};

export function RegistrationDialog({
  eyebrow, title, description, panelClassName, dismissDisabled, closeOnSuccess, overlay, onClose, children,
  initialFocus = '.drawer__body :is(input, select):not(:disabled)',
}: Props) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement;
    dialog.showModal();
    dialog.querySelector<HTMLElement>(initialFocus)?.focus({ preventScroll: true });
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  const close = useCallback(() => {
    const dialog = dialogRef.current;
    if (!dialog?.open || dialog.dataset.closing) return;
    dialog.dataset.closing = 'true';
    dialog.inert = true;
    const animation = panelRef.current?.getAnimations().find(
      (item) => 'animationName' in item && item.animationName === 'modal-exit',
    );
    if (!animation) {
      onClose();
      return;
    }
    const finish = () => { if (dialog.open) onClose(); };
    void animation.finished.then(finish, finish);
  }, [onClose]);

  useEffect(() => { if (closeOnSuccess) close(); }, [closeOnSuccess, close]);

  const requestClose = () => { if (!dismissDisabled && !overlay) close(); };

  return (
    <dialog
      ref={dialogRef}
      className="drawer-backdrop registration-dialog"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => { if (overlay && event.key === 'Escape') event.preventDefault(); }}
      onCancel={(event) => { event.preventDefault(); requestClose(); }}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <div ref={panelRef} className={`drawer ${panelClassName}`} inert={!!overlay}>
        <header className="drawer__header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
            {description && <p id={descriptionId}>{description}</p>}
          </div>
          <button type="button" className="icon-button" onClick={requestClose} disabled={dismissDisabled} aria-label="Fechar"><X size={20} /></button>
        </header>
        {children(requestClose)}
      </div>
      {overlay}
    </dialog>
  );
}
