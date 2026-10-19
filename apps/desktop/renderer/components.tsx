import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ArrowRight, CheckCircle2, LoaderCircle, X } from 'lucide-react';

export function Button({ children, variant = 'primary', busy, className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; busy?: boolean;
}) {
  return <button type="button" className={`button button-${variant} ${className}`} {...props} aria-busy={busy || undefined} disabled={props.disabled || busy}>
    {busy && <LoaderCircle size={16} className="spin" />}{children}
  </button>;
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'green' | 'blue' | 'amber' | 'red' }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function EmptyState({ icon, title, description, action, compact = false }: {
  icon: ReactNode; title: string; description: string; action?: ReactNode; compact?: boolean;
}) {
  return <div className={`empty-state ${compact ? 'compact' : ''}`}>
    <div className="empty-icon">{icon}</div><h3>{title}</h3><p>{description}</p>{action && <div className="empty-action">{action}</div>}
  </div>;
}

export function Modal({ title, description, children, footer, onClose, wide = false }: {
  title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void; wide?: boolean;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const element = dialog.current;
    const elements = () => [...(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [])];
    (elements().find(item => item.tagName !== 'BUTTON') ?? elements()[0])?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close.current(); }
      if (event.key === 'Tab') {
        const items = elements(); const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    element?.addEventListener('keydown', keydown);
    return () => { element?.removeEventListener('keydown', keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialog} className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
      <div className="modal-heading"><div><h2 id="dialog-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="关闭"><X size={20} /></button></div>
      <div className="modal-body">{children}</div>{footer && <div className="modal-footer">{footer}</div>}
    </section>
  </div>;
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return <label className="field"><span className="field-label">{label}{required && <span className="required"> *</span>}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}

export function SectionHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'success' | 'warning' }) {
  return <div className={`notice notice-${tone}`}>{tone === 'success' && <CheckCircle2 size={17} />}{children}</div>;
}

export function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="text-link" onClick={onClick}>{children}<ArrowRight size={14} /></button>;
}

export function ErrorMessage({ message }: { message?: string }) {
  return message ? <div className="inline-error" role="alert">{message}</div> : null;
}
