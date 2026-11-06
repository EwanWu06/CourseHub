// Minimal RFC 6265 cookie jar. The stored shape matches Playwright's cookie objects, so cookies captured
// from Chrome after login can be loaded directly and written back after every request.

export interface StoredCookie {
  name: string;
  value: string;
  domain: string; // leading '.' = domain cookie, otherwise host-only
  path: string;
  expires: number; // unix seconds, -1 = session cookie
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

function domainMatches(host: string, cookieDomain: string): boolean {
  if (!cookieDomain.startsWith('.')) return host === cookieDomain;
  const bare = cookieDomain.slice(1);
  return host === bare || host.endsWith(cookieDomain);
}

function pathMatches(reqPath: string, cookiePath: string): boolean {
  if (reqPath === cookiePath) return true;
  if (!reqPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith('/') || reqPath[cookiePath.length] === '/';
}

const nowSec = () => Date.now() / 1000;
const isLive = (c: StoredCookie) => c.expires === -1 || c.expires > nowSec();
const sameKey = (a: StoredCookie, b: StoredCookie) => a.name === b.name && a.domain === b.domain && a.path === b.path;

export class CookieJar {
  private cookies: StoredCookie[];
  changed = false;

  constructor(cookies: StoredCookie[] = []) {
    this.cookies = cookies.map((c) => ({ ...c }));
  }

  all(): StoredCookie[] {
    return this.cookies.filter(isLive).map((c) => ({ ...c }));
  }

  headerFor(url: string | URL): string {
    const u = typeof url === 'string' ? new URL(url) : url;
    const host = u.hostname;
    return this.cookies
      .filter((c) => isLive(c) && domainMatches(host, c.domain) && pathMatches(u.pathname, c.path) && (!c.secure || u.protocol === 'https:'))
      .sort((a, b) => b.path.length - a.path.length)
      .map((c) => `${c.name}=${c.value}`)
      .join('; ');
  }

  setFromResponse(url: string | URL, setCookie: string[]): void {
    const u = typeof url === 'string' ? new URL(url) : url;
    for (const header of setCookie) {
      const parsed = parseSetCookie(header, u);
      if (!parsed) continue;
      const { cookie, remove } = parsed;
      const idx = this.cookies.findIndex((c) => sameKey(c, cookie));
      if (remove) {
        if (idx >= 0) {
          this.cookies.splice(idx, 1);
          this.changed = true;
        }
        continue;
      }
      if (idx >= 0) {
        const old = this.cookies[idx];
        const same = old.value === cookie.value && old.expires === cookie.expires && old.secure === cookie.secure && old.httpOnly === cookie.httpOnly;
        if (same) continue;
        this.cookies[idx] = cookie;
      } else {
        this.cookies.push(cookie);
      }
      this.changed = true;
    }
  }
}

function parseSetCookie(header: string, url: URL): { cookie: StoredCookie; remove: boolean } | null {
  const [pair, ...attrs] = header.split(';');
  const eq = pair.indexOf('=');
  if (eq <= 0) return null;
  const cookie: StoredCookie = {
    name: pair.slice(0, eq).trim(),
    value: pair.slice(eq + 1).trim(),
    domain: url.hostname,
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: false,
  };
  let maxAge: number | null = null;
  let expiresAt: number | null = null;
  for (const raw of attrs) {
    const i = raw.indexOf('=');
    const key = (i < 0 ? raw : raw.slice(0, i)).trim().toLowerCase();
    const val = i < 0 ? '' : raw.slice(i + 1).trim();
    if (key === 'domain' && val) {
      const d = val.replace(/^\./, '').toLowerCase();
      if (!(url.hostname === d || url.hostname.endsWith('.' + d))) return null; // not allowed to set for another site
      cookie.domain = '.' + d;
    } else if (key === 'path' && val.startsWith('/')) {
      cookie.path = val;
    } else if (key === 'max-age') {
      maxAge = Number(val);
    } else if (key === 'expires') {
      const t = Date.parse(val);
      if (!Number.isNaN(t)) expiresAt = t / 1000;
    } else if (key === 'secure') {
      cookie.secure = true;
    } else if (key === 'httponly') {
      cookie.httpOnly = true;
    } else if (key === 'samesite') {
      const v = val.toLowerCase();
      cookie.sameSite = v === 'strict' ? 'Strict' : v === 'none' ? 'None' : 'Lax';
    }
  }
  if (maxAge !== null && !Number.isNaN(maxAge)) {
    if (maxAge <= 0) return { cookie, remove: true };
    cookie.expires = Math.floor(nowSec()) + maxAge;
  } else if (expiresAt !== null) {
    if (expiresAt <= nowSec()) return { cookie, remove: true };
    cookie.expires = expiresAt;
  }
  return { cookie, remove: false };
}
