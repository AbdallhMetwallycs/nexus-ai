import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToastKind = 'success' | 'warning' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastContextValue {
  toast: (message: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastKind, ReactNode> = {
  success: <CheckCircle2 size={15} className="text-state-ok" />,
  warning: <AlertTriangle size={15} className="text-state-warn" />,
  error: <XCircle size={15} className="text-state-err" />,
  info: <Info size={15} className="text-state-info" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = ++seq.current;
      setItems((prev) => [...prev.slice(-3), { id, kind, message }]);
      setTimeout(() => dismiss(id), 3200);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed bottom-4 right-4 z-[70] flex w-80 flex-col gap-2" aria-live="polite">
          {items.map((t) => (
            <div
              key={t.id}
              className="pointer-events-auto flex items-start gap-2.5 rounded-card border border-surface-line bg-surface-overlay px-3.5 py-3 shadow-pop animate-slide-up"
            >
              <span className="mt-0.5">{icons[t.kind]}</span>
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-ink-secondary">{t.message}</p>
              <button
                aria-label="Dismiss notification"
                onClick={() => dismiss(t.id)}
                className={cn('text-ink-faint hover:text-ink-primary')}
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
