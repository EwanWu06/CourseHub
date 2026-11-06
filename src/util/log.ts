import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';

type Level = 'info' | 'warn' | 'error';

function serialize(meta: unknown): unknown {
  if (meta instanceof Error) return { name: meta.name, message: meta.message, stack: meta.stack };
  return meta;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** app.log → app.log.1 → … → app.log.<keep> once it passes maxBytes. */
export function rotateLog(file: string, maxBytes = MAX_BYTES, keep = 3): void {
  try {
    if (!existsSync(file) || statSync(file).size < maxBytes) return;
    rmSync(`${file}.${keep}`, { force: true });
    for (let i = keep - 1; i >= 1; i--) if (existsSync(`${file}.${i}`)) renameSync(`${file}.${i}`, `${file}.${i + 1}`);
    renameSync(file, `${file}.1`);
  } catch {
    // never let logging break anything
  }
}

let writes = 0;

export function log(level: Level, msg: string, meta?: unknown): void {
  const entry: Record<string, unknown> = { t: new Date().toISOString(), level, msg };
  if (meta !== undefined) entry.meta = serialize(meta);
  try {
    const dir = paths().logs;
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'app.log');
    if (writes++ % 200 === 0) rotateLog(file);
    appendFileSync(file, JSON.stringify(entry) + '\n');
  } catch {
    // Logging must never take the app down.
  }
  if (process.env.COURSEHUB_QUIET === '1') return;
  const out = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  out(`[${level}] ${msg}`, meta === undefined ? '' : meta);
}
