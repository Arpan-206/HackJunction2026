import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastTone = 'info' | 'ok' | 'error';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

interface ToastApi {
  /** Shows a toast for `ms` milliseconds (default 5000). */
  show: (message: string, tone?: ToastTone, ms?: number) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
let counter = 0;

/** Mount once near the root. Toasts are announced politely to screen readers. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (message: string, tone: ToastTone = 'info', ms = 5000) => {
      const id = ++counter;
      setItems((l) => [...l, { id, message, tone }]);
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.tone === 'info' ? '' : `toast--${t.tone}`}`}>
            <span className="toast__msg">{t.message}</span>
            <button type="button" className="btn btn--ghost" onClick={() => dismiss(t.id)} aria-label="Dismiss">
              {'×'}
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Returns { show(message, tone?, ms?) }. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
