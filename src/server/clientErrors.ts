// Errors the web page ran into (a page that crashed while rendering): kept in memory for the status page and
// written to the log, so a broken page is noticed and fixable instead of just looking blank.
import { log } from '../util/log.ts';

export interface ClientError { at: string; message: string; path: string; stack: string | null }

const MAX = 20;
const recent: ClientError[] = [];

export function recordClientError(e: { message?: unknown; path?: unknown; stack?: unknown }, now = new Date()): void {
  const err: ClientError = {
    at: now.toISOString(), message: String(e.message ?? '').slice(0, 500) || '(no message)', path: String(e.path ?? '').slice(0, 200),
    stack: e.stack ? String(e.stack).slice(0, 2000) : null,
  };
  const same = recent.find((x) => x.message === err.message && x.path === err.path && now.getTime() - Date.parse(x.at) < 60_000);
  if (same) return; // a page re-rendering into the same error
  recent.unshift(err);
  recent.length = Math.min(recent.length, MAX);
  log('error', `web page error on ${err.path}: ${err.message}`, err.stack ?? undefined);
}

export function recentClientErrors(): ClientError[] {
  return [...recent];
}
