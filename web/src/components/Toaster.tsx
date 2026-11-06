import { dismissToast, useToast } from '../lib/toast.ts';

/** The slot is always there (a polite live region), so screen readers hear each message as it comes. */
export function Toaster() {
  const t = useToast();
  return (
    <div className="toast-slot" role="status" aria-live="polite">
      {t ? (
        <div key={t.id} className={`toast ${t.closing ? 'is-closing' : ''}`}>
          <span className="toast-text">{t.text}</span>
          {t.action ? (
            <button type="button" className="toast-action" onClick={() => { t.action!.run(); dismissToast(); }}>{t.action.label}</button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
