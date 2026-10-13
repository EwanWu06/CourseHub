import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');
export const PORT = Number(process.env.COURSEHUB_PORT ?? 4123);

/** Read at call time so tests (and the CLI) can point at another data dir. */
export function dataDir(): string {
  return process.env.COURSEHUB_DATA_DIR ?? path.join(ROOT_DIR, 'data');
}

export function paths() {
  const d = dataDir();
  return {
    db: path.join(d, 'coursehub.sqlite'),
    text: path.join(d, 'text'),
    tmp: path.join(d, 'tmp'),
    auth: path.join(d, 'auth'),
    profile: path.join(d, 'browser-profile'),
    logs: path.join(d, 'logs'),
    notify: path.join(d, 'notify'),
    aiWork: path.join(d, 'ai-work'),
  };
}

export function ensureDataDirs(): void {
  const p = paths();
  for (const dir of [p.text, p.tmp, p.profile, p.logs, p.notify, p.aiWork]) mkdirSync(dir, { recursive: true });
  mkdirSync(p.auth, { recursive: true, mode: 0o700 });
}

export function chromeBin(): string {
  return process.env.COURSEHUB_CHROME_BIN ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
}

export function claudeBin(): string {
  return process.env.COURSEHUB_CLAUDE_BIN ?? path.join(os.homedir(), '.local/bin/claude');
}
