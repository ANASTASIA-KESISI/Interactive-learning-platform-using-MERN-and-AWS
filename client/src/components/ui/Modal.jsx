import { useCallback, useEffect, useRef } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

// Dialog with a real focus trap (NFR5 / WCAG 2.1 AA): Esc closes, Tab cycles
// inside, and focus returns to whatever opened it. Used by the note detail
// modal and the admin delete confirmations.
export const Modal = ({ title, onClose, children, className = '' }) => {
  const panelRef = useRef(null);
  const openerRef = useRef(null);

  const close = useCallback(() => onClose?.(), [onClose]);

  useEffect(() => {
    openerRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector(FOCUSABLE);
    (first || panel)?.focus();

    return () => {
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus();
    };
  }, []);

  const handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const nodes = Array.from(panelRef.current?.querySelectorAll(FOCUSABLE) || []).filter(
      (el) => el.offsetParent !== null,
    );
    if (nodes.length === 0) {
      event.preventDefault();
      return;
    }

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Clicking the backdrop closes; it is not a control, so it stays out of
          the tab order and Esc is the keyboard equivalent. */}
      <div className="absolute inset-0 bg-slate-900/40" onClick={close} aria-hidden="true" />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        className={`relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-white shadow-xl focus:outline-none ${className}`.trim()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-3">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            type="button"
            onClick={close}
            aria-label="Close dialog"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ✕
          </button>
        </header>
        <div className="overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
};
