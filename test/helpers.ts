import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const created: string[] = [];

// Safety net: tests must never reach the real `claude` (it would spend the user's subscription quota).
process.env.COURSEHUB_CLAUDE_BIN ??= path.resolve(import.meta.dirname, 'fixtures/fake-claude.sh');
if (!process.env.FAKE_CLAUDE_DIR) {
  process.env.FAKE_CLAUDE_DIR = mkdtempSync(path.join(tmpdir(), 'fake-claude-default-'));
  created.push(process.env.FAKE_CLAUDE_DIR);
}
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

import http from 'node:http';
import type { AddressInfo } from 'node:net';

/** Starts a throwaway HTTP server on a random port. host 'localhost' gives a second hostname for cross-host tests. */
export async function startHttp(handler: http.RequestListener, host = '127.0.0.1'): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, host, resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}`,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
