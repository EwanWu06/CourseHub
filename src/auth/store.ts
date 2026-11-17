// Saved login state per school: cookies captured from Chrome — those of Canvas and of the sites its sign-in goes
// through (the school's SSO), so "remember me" survives — or a personal access token for the few schools that still
// allow one. Files are chmod 600.
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';
import { writeFileAtomic } from '../util/fs.ts';
import { CanvasClient } from '../canvas/client.ts';
import type { ClientOptions } from '../canvas/client.ts';
import { CookieJar } from '../canvas/cookies.ts';
import type { StoredCookie } from '../canvas/cookies.ts';
import type { SchoolRow } from '../db/types.ts';

export interface AuthFile {
  schoolId: string;
  savedAt: string;
  userAgent: string;
  cookies: StoredCookie[];
  token?: string;
  /**
   * Sites a real sign-in went through (Canvas, the school's SSO pages and frames). Once known, only their cookies
   * are kept: the shared login browser also picks up sessions for unrelated sites (YouTube, Office, the other
   * schools), and those have no business sitting in this file.
   */
  loginHosts?: string[];
}

const MAX_LOGIN_HOSTS = 60;

/** Cookies a host on the list would be sent — its own, or a parent domain's (.microsoftonline.com for login.microsoftonline.com). */
export function cookiesForHosts(cookies: StoredCookie[], hosts: string[]): StoredCookie[] {
  const list = hosts.map((h) => h.toLowerCase());
  return cookies.filter((c) => {
    const d = c.domain.replace(/^\./, '').toLowerCase();
    return list.some((h) => h === d || h.endsWith('.' + d));
  });
}

/** Per-file download hosts (a1234-567.cluster37.canvas-user-content.com): one-off, never part of a sign-in. */
const isFileHost = (h: string) => /(^|\.)canvas-user-content\.com$|(^|\.)instructure-uploads[^.]*\.s3[.-]/i.test(h);

/**
 * What to store after a sign-in. `signedIn` = this browser started logged out and got back in, so the sites it
 * navigated through were enough (a school on Canvas's own login never leaves its Canvas site; one on SSO passes
 * through the identity provider). Those sites are added to the ones seen before. With nothing learned yet (the
 * browser was still logged in) every cookie is kept, as before — never drop what might be needed.
 */
export function chooseLoginCookies(input: { all: StoredCookie[]; canvasHost: string; visited: Iterable<string>; signedIn: boolean; previousHosts?: string[] }): { cookies: StoredCookie[]; loginHosts?: string[] } {
  const canvasHost = input.canvasHost.toLowerCase();
  const visited = [...input.visited].map((h) => h.toLowerCase()).filter((h) => h && !isFileHost(h));
  const learned = input.signedIn || visited.some((h) => h !== canvasHost);
  if (!learned && !input.previousHosts?.length) return { cookies: input.all };
  const loginHosts = [...new Set([canvasHost, ...(input.previousHosts ?? []), ...visited])].slice(0, MAX_LOGIN_HOSTS);
  return { cookies: cookiesForHosts(input.all, loginHosts), loginHosts };
}

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
  writeFileAtomic(file, JSON.stringify(a, null, 2), 0o600);
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
  // file downloads leave a cookie per download host behind; only the sign-in's sites are worth keeping
  const all = client.auth.jar.all();
  const cookies = current.loginHosts?.length ? cookiesForHosts(all, [new URL(client.baseUrl).hostname, ...current.loginHosts]) : all;
  saveAuth({ ...current, cookies, savedAt: new Date().toISOString() });
  client.auth.jar.changed = false;
}
