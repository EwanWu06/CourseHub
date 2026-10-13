import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const created: string[] = [];
process.on('exit', () => {
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
});

/** Creates a throwaway data dir and points COURSEHUB_DATA_DIR at it. Removed on process exit. */
export function tmpDataDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'coursehub-test-'));
  created.push(dir);
  process.env.COURSEHUB_DATA_DIR = dir;
  return dir;
}

export function fixedNow(iso: string): Date {
  return new Date(iso);
}
