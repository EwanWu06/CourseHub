import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';

type Level = 'info' | 'warn' | 'error';

function serialize(meta: unknown): unknown {
  if (meta instanceof Error) return { name: meta.name, message: meta.message, stack: meta.stack };
  return meta;
}

export function log(level: Level, msg: string, meta?: unknown): void {
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.meta = serialize(meta);
  try {
    const dir = paths().logs;
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, 'app.log'), JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never take the app down.
  }
  if (process.env.COURSEHUB_QUIET === '1') return;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(`[${level}] ${msg}`, meta === undefined ? '' : meta);
}
