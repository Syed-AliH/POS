import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@mama-babi/ui';

interface ModalProps {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Override panel width/height — use for fixed-size dialogs */
  panelClassName?: string;
  bodyClassName?: string;
  /** Alert modals portal to document.body with the highest z-index */
  priority?: 'default' | 'alert';
}

export function Modal({
  open,
  title,
  children,
  onClose,
  footer,
  size = 'md',
  panelClassName,
  bodyClassName,
  priority = 'default',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || priority !== 'alert') return;

    const focusTarget = panelRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusTarget?.focus();

    const blockUnderlyingKeys = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', blockUnderlyingKeys, true);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', blockUnderlyingKeys, true);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, priority, onClose]);

  if (!open) return null;

  const width = size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-2xl' : size === 'xl' ? 'max-w-4xl' : 'max-w-md';
  const panelSize = panelClassName ?? `w-full ${width}`;
  const zIndex = priority === 'alert' ? 'z-[300]' : 'z-[150]';
  const overlayTone = priority === 'alert' ? 'bg-black/60' : 'bg-black/50';

  const content = (
    <div
      className={`fixed inset-0 ${overlayTone} flex items-center justify-center ${zIndex} p-4`}
      onClick={priority === 'alert' ? undefined : onClose}
      aria-hidden={false}
    >
      <div
        ref={panelRef}
        role={priority === 'alert' ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="modal-title"
        className={`bg-white dark:bg-slate-900 rounded-xl shadow-2xl flex flex-col ${panelSize} ${priority === 'alert' ? 'ring-2 ring-danger-200' : ''}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-4 border-b shrink-0">
          <h3 id="modal-title" className="font-semibold text-lg">{title}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none" aria-label="Close">×</button>
        </div>
        <div className={`p-4 flex-1 min-h-0 overflow-hidden ${bodyClassName ?? ''}`}>{children}</div>
        {footer && <div className="p-4 border-t flex gap-2 justify-end shrink-0">{footer}</div>}
      </div>
    </div>
  );

  if (priority === 'alert') {
    return createPortal(content, document.body);
  }

  return content;
}

export function ModalActions({ onCancel, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel', confirmVariant = 'primary' as const, loading = false }: {
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmVariant?: 'primary' | 'danger' | 'secondary';
  loading?: boolean;
}) {
  return (
    <>
      <Button variant="ghost" onClick={onCancel}>{cancelLabel}</Button>
      <Button variant={confirmVariant} onClick={onConfirm} disabled={loading}>{loading ? 'Please wait…' : confirmLabel}</Button>
    </>
  );
}
