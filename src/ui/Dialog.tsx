/**
 * Modal dialog: a bottom sheet on small screens, a centred panel above 640px.
 * Focus moves into the panel on open and returns to the opener on close; body
 * scrolling is locked while it is open.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton, useEscape } from './primitives';
import { createPortal } from 'react-dom';

export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  wide
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEscape(open, onClose);

  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelector<HTMLElement>(
        'textarea, input:not([type="hidden"]), select, button, [tabindex]:not([tabindex="-1"])'
      );
      (focusable ?? panel).focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      restoreRef.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className="dialog"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="dialog__panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={panelRef}
        tabIndex={-1}
        style={wide ? { maxWidth: '52rem' } : undefined}
      >
        <div className="dialog__grip" aria-hidden="true" />
        <div className="dialog__header">
          <h2 style={{ fontSize: 'var(--font-size-lg)' }}>{title}</h2>
          <IconButton name="close" label="Close" onClick={onClose} />
        </div>
        <div className="dialog__body">{children}</div>
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
