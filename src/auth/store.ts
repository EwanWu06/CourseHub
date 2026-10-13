// Saved login state per school: cookies captured from Chrome (all domains, so SSO cookies survive too)
// or a personal access token for the few schools that still allow one. Files are chmod 600.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';
import { CanvasClient } from '../canvas/client.ts';
import type { ClientOptions } from '../canvas/client.ts';
import { CookieJar } from '../canvas/cookies.ts';
import type { StoredCookie } from '../canvas/cookies.ts';
import type { SchoolRow } from '../db/types.ts';

export interface AuthFile { schoolId: string; savedAt: string; userAgent: string; cookies: StoredCookie[]; token?: string }

const authPath = (schoolId: string) => path.join(paths().auth, `${schoolId}.json`);

export function loadAuth(schoolId: string): AuthFile | null {
  try {
    return JSON.parse(readFileSync(authPath(schoolId), 'utf8')) as AuthFile;
  } catch {
    return null;
  }
}

export function saveAuth(a: AuthFile): void {
  mkdirSync(paths().auth, { recursive: true, mode: 0o700 });
  const file = authPath(a.schoolId);
  writeFileSync(file, JSON.stringify(a, null, 2), { mode: 0o600 });
  chmodSync(file, 0o600);
}

export function deleteAuth(schoolId: string): void {
  rmSync(authPath(schoolId), { force: true });
}

export function makeClient(school: SchoolRow, opts: Partial<ClientOptions> = {}): CanvasClient | null {
  const auth = loadAuth(school.id);
  if (!auth) return null;
  if (school.auth_mode === 'token') {
    if (!auth.token) return null;
    return new CanvasClient({ ...opts, baseUrl: school.base_url, auth: { kind: 'token', token: auth.token } });
  }
  if (auth.cookies.length === 0) return null;
  return new CanvasClient({ ...opts, baseUrl: school.base_url, auth: { kind: 'session', jar: new CookieJar(auth.cookies), userAgent: auth.userAgent } });
}

/** Writes rotated session cookies back so the next sync starts from the freshest session. */
export function persistClientCookies(schoolId: string, client: CanvasClient): void {
  if (client.auth.kind !== 'session' || !client.auth.jar.changed) return;
  const current = loadAuth(schoolId);
  if (!current) return;
  saveAuth({ ...current, cookies: client.auth.jar.all(), savedAt: new Date().toISOString() });
  client.auth.jar.changed = false;
}
