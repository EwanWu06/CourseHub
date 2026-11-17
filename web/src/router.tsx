// Tiny history router: enough for a handful of pages, no dependency churn.
import { useSyncExternalStore } from 'react';
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { reducedMotion } from './lib/motion.ts';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

type TransitionDoc = Document & { startViewTransition?: (update: () => void) => unknown };

/** Page changes cross-fade where the browser can (View Transitions); instantly otherwise or with reduced motion. */
function withTransition(update: () => void): void {
  // the first page of a visit makes the one choreographed entrance; later pages only fade in (styles.css: data-fresh)
  delete document.documentElement.dataset.fresh;
  const doc = document as TransitionDoc;
  if (!doc.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  doc.startViewTransition(() => flushSync(update)); // the new page must be in the DOM when the callback returns
}

window.addEventListener('popstate', () => withTransition(notify));

export function navigate(to: string, opts: { replace?: boolean } = {}): void {
  if (to === location.pathname + location.search) return;
  withTransition(() => {
    if (opts.replace) history.replaceState(null, '', to);
    else history.pushState(null, '', to);
    window.scrollTo({ top: 0 });
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useLocation(): { path: string; query: URLSearchParams } {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  const url = new URL(href, location.origin);
  return { path: url.pathname, query: url.searchParams };
}

type LinkProps = { to: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>;

export function Link({ to, children, onClick, ...rest }: LinkProps) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest}>{children}</a>;
}
