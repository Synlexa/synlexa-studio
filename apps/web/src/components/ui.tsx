/**
 * Small, consistent UI primitives for Synlexa Studio.
 * One accent color (sky), neutral slate surfaces, 8px rhythm, rem-based type
 * so the whole interface follows the UI-scale setting.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const variantCls: Record<Variant, string> = {
  primary: 'bg-sky-500 text-slate-950 hover:bg-sky-400 font-semibold shadow-sm shadow-sky-950/40',
  secondary: 'border border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08] hover:border-white/20',
  ghost: 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
  danger: 'border border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
};

const sizeCls: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
};

export function Button({
  variant = 'secondary',
  size = 'md',
  className,
  icon,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <button
      type="button"
      {...rest}
      className={cx(
        'inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:pointer-events-none disabled:opacity-40',
        variantCls[variant],
        sizeCls[size],
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  active,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cx(
        'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 disabled:opacity-40',
        active ? 'bg-sky-500/15 text-sky-300' : 'text-slate-400 hover:bg-white/[0.07] hover:text-slate-100',
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...rest}
      className={cx(
        'h-9 w-full rounded-lg border border-white/10 bg-black/30 px-3 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-400/20',
        className,
      )}
    />
  );
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...rest}
      className={cx(
        'w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 outline-none transition focus:border-sky-400/70 focus:ring-2 focus:ring-sky-400/20',
        className,
      )}
    />
  );
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...rest}
      className={cx(
        'h-9 w-full rounded-lg border border-white/10 bg-[#121722] px-2.5 text-sm text-slate-100 outline-none focus:border-sky-400/70',
        className,
      )}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60',
        checked ? 'bg-sky-500' : 'bg-slate-700',
      )}
    >
      <span
        className={cx(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad';
  children: ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: 'bg-white/[0.06] text-slate-300 border-white/10',
    accent: 'bg-sky-500/10 text-sky-300 border-sky-500/25',
    good: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/25',
    warn: 'bg-amber-500/10 text-amber-300 border-amber-500/25',
    bad: 'bg-rose-500/10 text-rose-300 border-rose-500/25',
  };
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.6875rem] font-medium leading-none',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-white/15 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[0.6875rem] text-slate-400">
      {children}
    </kbd>
  );
}

export function Card({
  title,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('rounded-xl border border-white/[0.08] bg-white/[0.02]', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-slate-100">{title}</h3>}
            {description && <p className="mt-0.5 text-xs text-slate-400">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className="p-4">{children}</div>}
    </section>
  );
}

export function FieldRow({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 py-3 @xl:flex-row @xl:items-center @xl:justify-between @xl:gap-6">
      <div className="min-w-0">
        <div className="text-sm text-slate-200">{label}</div>
        {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
      </div>
      <div className="min-w-0 @xl:max-w-[60%] @xl:shrink-0">{children}</div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="mb-1 text-slate-500">{icon}</div>}
      <div className="text-sm font-medium text-slate-200">{title}</div>
      {description && <div className="max-w-sm text-xs leading-relaxed text-slate-400">{description}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cx('w-full overflow-hidden rounded-2xl border border-white/10 bg-[#121722] shadow-2xl', width)}>
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-3.5">
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </IconButton>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-white/[0.06] px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- Confirm dialog (promise based) ----------

interface ConfirmRequest {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}

// ---------- Toasts ----------

type ToastTone = 'info' | 'success' | 'warn' | 'error';
interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
  action?: { label: string; run: () => void };
}

interface FeedbackApi {
  toast: (message: ReactNode, tone?: ToastTone, action?: Toast['action']) => void;
  confirm: (opts: Omit<ConfirmRequest, 'resolve'>) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi>({
  toast: () => {},
  confirm: async () => true,
});

export function useFeedback(): FeedbackApi {
  return useContext(FeedbackContext);
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmReq, setConfirmReq] = useState<ConfirmRequest | null>(null);
  const idRef = useRef(1);

  const toast = useCallback<FeedbackApi['toast']>((message, tone = 'info', action) => {
    const id = idRef.current++;
    setToasts((t) => [...t.slice(-3), { id, tone, message, action }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4000);
  }, []);

  const confirm = useCallback<FeedbackApi['confirm']>(
    (opts) => new Promise<boolean>((resolve) => setConfirmReq({ ...opts, resolve })),
    [],
  );

  const close = (ok: boolean) => {
    confirmReq?.resolve(ok);
    setConfirmReq(null);
  };

  const icons: Record<ToastTone, ReactNode> = {
    info: <Info className="h-4 w-4 text-sky-300" />,
    success: <CheckCircle2 className="h-4 w-4 text-emerald-300" />,
    warn: <AlertTriangle className="h-4 w-4 text-amber-300" />,
    error: <XCircle className="h-4 w-4 text-rose-300" />,
  };

  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-10 z-[90] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2.5 rounded-xl border border-white/10 bg-[#161c28]/95 px-3.5 py-3 text-sm text-slate-200 shadow-xl backdrop-blur"
          >
            <span className="mt-0.5 shrink-0">{icons[t.tone]}</span>
            <div className="min-w-0 flex-1 leading-snug">{t.message}</div>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action!.run();
                  setToasts((x) => x.filter((y) => y.id !== t.id));
                }}
                className="shrink-0 text-xs font-semibold text-sky-300 hover:text-sky-200"
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <Modal
        open={Boolean(confirmReq)}
        onClose={() => close(false)}
        title={confirmReq?.title ?? ''}
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant={confirmReq?.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
              {confirmReq?.confirmLabel ?? 'Confirm'}
            </Button>
          </>
        }
      >
        <div className="text-sm leading-relaxed text-slate-300">{confirmReq?.message}</div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export type MenuItem =
    | {
        label: string;
        icon?: ReactNode;
        onSelect: () => void;
        danger?: boolean;
        disabled?: boolean;
        hint?: string;
        /** Second line under the label. */
        description?: string;
        /** React key when labels repeat (e.g. the same model under two providers). */
        key?: string;
        selected?: boolean;
      }
    | { heading: string }
    | 'divider';

/** Lightweight anchored popover menu. */
export function Menu({
  trigger,
  items,
  align = 'right',
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The popover is portalled and fixed-positioned so panels with overflow:hidden
  // never crop it; it is clamped to stay inside the window.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const margin = 8;
      const width = panel.offsetWidth;
      const preferred = align === 'right' ? anchor.right - width : anchor.left;
      const left = Math.min(Math.max(margin, preferred), window.innerWidth - width - margin);
      const top = anchor.bottom + 4;
      setPos({ top, left, maxHeight: Math.max(160, window.innerHeight - top - margin) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, align]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger(open, () => setOpen((v) => !v))}
      {open &&
        createPortal(
        <div
          ref={panelRef}
          style={
            pos
              ? { position: 'fixed', top: pos.top, left: pos.left, maxHeight: Math.min(pos.maxHeight, 480) }
              : { position: 'fixed', top: 0, left: 0, visibility: 'hidden' }
          }
          className="z-[90] max-w-[calc(100vw-1rem)] min-w-52 overflow-y-auto rounded-xl border border-white/10 bg-[#161c28] py-1 shadow-2xl"
        >
          {items.map((it, i) =>
            it === 'divider' ? (
              <div key={`d${i}`} className="my-1 h-px bg-white/[0.06]" />
            ) : 'heading' in it ? (
              <div
                key={`h${i}`}
                className="px-3 pt-2.5 pb-1 text-[0.6875rem] font-semibold tracking-wide text-slate-500 uppercase"
              >
                {it.heading}
              </div>
            ) : (
              <button
                key={it.key ?? it.label}
                type="button"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cx(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:opacity-40',
                  it.danger ? 'text-rose-300 hover:bg-rose-500/10' : 'text-slate-200 hover:bg-white/[0.06]',
                  it.selected && 'bg-white/[0.05]',
                )}
              >
                {it.icon && <span className="shrink-0 text-slate-400">{it.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block">{it.label}</span>
                  {it.description && <span className="block truncate text-xs text-slate-500">{it.description}</span>}
                </span>
                {it.hint && <span className="text-xs text-slate-500">{it.hint}</span>}
              </button>
            ),
          )}
        </div>,
          document.body,
        )}
    </div>
  );
}
