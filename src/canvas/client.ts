// Read-only Canvas REST client. Authenticates either with browser session cookies (schools that block
// personal tokens) or a bearer token. Only ever issues GET requests.
import type { CookieJar } from './cookies.ts';

export class SessionExpiredError extends Error {
  constructor(message = '登录已过期') {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

export class CanvasForbiddenError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string) {
    super(`没有权限访问 (${status}): ${url}`);
    this.name = 'CanvasForbiddenError';
    this.status = status;
    this.url = url;
  }
}

export class CanvasNotFoundError extends Error {
  url: string;
  constructor(url: string) {
    super(`不存在: ${url}`);
    this.name = 'CanvasNotFoundError';
    this.url = url;
  }
}

export class CanvasHttpError extends Error {
  status: number;
  url: string;
  constructor(status: number, url: string, detail: string) {
    super(`Canvas 请求失败 (${status}) ${url}: ${detail}`);
    this.name = 'CanvasHttpError';
    this.status = status;
    this.url = url;
  }
}

export type CanvasAuth = { kind: 'session'; jar: CookieJar; userAgent: string } | { kind: 'token'; token: string };

export interface ClientOptions {
  baseUrl: string;
  auth: CanvasAuth;
  concurrency?: number;
  maxPages?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export type Params = Record<string, string | number | boolean | string[] | undefined>;

export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

export function stripWhile1(body: string): string {
  return body.startsWith('while(1);') ? body.slice('while(1);'.length) : body;
}

export function parseLinkNext(link: string | null): string | null {
  if (!link) return null;
  for (const part of link.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/);
    if (m) return m[1];
  }
  return null;
}

class Semaphore {
  private active = 0;
  private waiting: (() => void)[] = [];
  private max: number;
  constructor(max: number) {
    this.max = max;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.max) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}

const RETRY_5XX = [500, 1500];

export class CanvasClient {
  readonly baseUrl: string;
  requestCount = 0;
  readonly auth: CanvasAuth;
  private fetchImpl: typeof fetch;
  private sleep: (ms: number) => Promise<void>;
  private maxPages: number;
  private sem: Semaphore;
  private slowDown = false;

  constructor(opts: ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.auth = opts.auth;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.maxPages = opts.maxPages ?? 50;
    this.sem = new Semaphore(opts.concurrency ?? 3);
  }

  url(path: string, params?: Params): string {
    const u = new URL(path.startsWith('http') ? path : this.baseUrl + path);
    if (u.origin !== new URL(this.baseUrl).origin) throw new Error(`refusing to call another origin: ${u.origin}`);
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) for (const v of value) u.searchParams.append(key, v);
      else u.searchParams.set(key, String(value));
    }
    return u.toString();
  }

  async get<T>(path: string, params?: Params): Promise<T> {
    return (await this.request<T>(this.url(path, params))).data;
  }

  async getAll<T>(path: string, params?: Params): Promise<T[]> {
    let next: string | null = this.url(path, { per_page: 100, ...params });
    const out: T[] = [];
    for (let page = 0; next && page < this.maxPages; page++) {
      const res: { data: T[]; next: string | null } = await this.request<T[]>(next);
      if (!Array.isArray(res.data)) throw new CanvasHttpError(200, next, 'expected a JSON array');
      out.push(...res.data);
      next = res.next;
    }
    return out;
  }

  /** Raw GET for downloads: follows redirects by hand so cookies only go where they belong. */
  async fetchRaw(url: string): Promise<Response> {
    return this.sem.run(async () => {
      let current = url;
      for (let hop = 0; hop < 6; hop++) {
        const res = await this.send(current);
        this.requestCount++;
        this.absorbCookies(current, res);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) throw new CanvasHttpError(res.status, current, 'redirect without location');
          const nextUrl = new URL(loc, current);
          if (this.isLoginUrl(nextUrl)) throw new SessionExpiredError();
          await res.body?.cancel();
          current = nextUrl.toString();
          continue;
        }
        if (!res.ok) {
          await res.body?.cancel();
          if (res.status === 401) throw new SessionExpiredError();
          if (res.status === 403) throw new CanvasForbiddenError(403, current);
          if (res.status === 404) throw new CanvasNotFoundError(current);
          throw new CanvasHttpError(res.status, current, 'download failed');
        }
        return res;
      }
      throw new CanvasHttpError(310, url, 'too many redirects');
    });
  }

  private isLoginUrl(u: URL): boolean {
    return u.origin === new URL(this.baseUrl).origin && u.pathname.startsWith('/login');
  }

  private send(url: string): Promise<Response> {
    const headers: Record<string, string> = { Accept: 'application/json+canvas-string-ids, application/json' };
    const sameOrigin = new URL(url).origin === new URL(this.baseUrl).origin;
    if (this.auth.kind === 'session') {
      headers['User-Agent'] = this.auth.userAgent;
      const cookie = this.auth.jar.headerFor(url);
      if (cookie) headers.Cookie = cookie;
    } else {
      headers['User-Agent'] = DEFAULT_USER_AGENT;
      if (sameOrigin) headers.Authorization = `Bearer ${this.auth.token}`;
    }
    return this.fetchImpl(url, { method: 'GET', headers, redirect: 'manual', signal: AbortSignal.timeout(60_000) });
  }

  private absorbCookies(url: string, res: Response): void {
    if (this.auth.kind !== 'session') return;
    const setCookie = res.headers.getSetCookie();
    if (setCookie.length) this.auth.jar.setFromResponse(url, setCookie);
  }

  private request<T>(url: string): Promise<{ data: T; next: string | null }> {
    return this.sem.run(async () => {
      let rateRetries = 0;
      let serverRetries = 0;
      for (;;) {
        if (this.slowDown) {
          this.slowDown = false;
          await this.sleep(1000);
        }
        let res: Response;
        try {
          res = await this.send(url);
        } catch (err) {
          if (serverRetries < RETRY_5XX.length) {
            await this.sleep(RETRY_5XX[serverRetries++]);
            continue;
          }
          throw new CanvasHttpError(0, url, `网络错误: ${(err as Error).message}`);
        }
        this.requestCount++;
        this.absorbCookies(url, res);
        const remaining = res.headers.get('x-rate-limit-remaining');
        if (remaining !== null && Number(remaining) < 50) this.slowDown = true;

        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location') ?? '';
          if (this.isLoginUrl(new URL(loc, url))) throw new SessionExpiredError();
          throw new CanvasHttpError(res.status, url, `unexpected redirect to ${loc}`);
        }
        const body = await res.text();
        if (res.status === 401) {
          const status = parseStatus(body);
          if (status === 'unauthorized') throw new CanvasForbiddenError(401, url);
          throw new SessionExpiredError();
        }
        if (res.status === 403) {
          if (/rate limit exceeded/i.test(body) && rateRetries < 3) {
            await this.sleep(2000 * 2 ** rateRetries++);
            continue;
          }
          throw new CanvasForbiddenError(403, url);
        }
        if (res.status === 404) throw new CanvasNotFoundError(url);
        if (res.status >= 500) {
          if (serverRetries < RETRY_5XX.length) {
            await this.sleep(RETRY_5XX[serverRetries++]);
            continue;
          }
          throw new CanvasHttpError(res.status, url, body.slice(0, 200));
        }
        if (!res.ok) throw new CanvasHttpError(res.status, url, body.slice(0, 200));
        if ((res.headers.get('content-type') ?? '').includes('text/html')) throw new SessionExpiredError();
        const text = stripWhile1(body).trim();
        const data = (text ? JSON.parse(text) : null) as T;
        return { data, next: parseLinkNext(res.headers.get('link')) };
      }
    });
  }
}

function parseStatus(body: string): string | null {
  try {
    const parsed = JSON.parse(stripWhile1(body)) as { status?: string };
    return parsed.status ?? null;
  } catch {
    return null;
  }
}
