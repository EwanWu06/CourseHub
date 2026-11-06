import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT_DIR } from '../config.ts';

const version = (() => {
  try {
    return (JSON.parse(readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version?: string }).version ?? '0';
  } catch {
    return '0';
  }
})();

/** Identifies this Course Hub process (health checks, status page, single-instance probe). */
export const APP_INFO = { app: 'course-hub', version, pid: process.pid, startedAt: new Date().toISOString() } as const;
