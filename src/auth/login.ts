// Interactive login (a visible Chrome window, any SSO/Duo flow) and silent re-login (headless Chrome,
// replaying saved identity-provider cookies so "remember me" signs straight back in).
import type { BrowserContext, Page } from 'playwright-core';
import { CanvasClient } from '../canvas/client.ts';
import { CookieJar } from '../canvas/cookies.ts';
import type { StoredCookie } from '../canvas/cookies.ts';
import type { CanvasProfile } from '../canvas/types.ts';
import type { DB } from '../db/index.ts';
import { getSchool, updateSchool } from '../db/schools.ts';
import { log } from '../util/log.ts';
import { launchChrome, withChromeLock } from './chrome.ts';
import { chooseLoginCookies, loadAuth, saveAuth } from './store.ts';

export interface LoginState { status: 'idle' | 'waiting' | 'success' | 'failed'; message: string; startedAt: string | null }

const states = new Map<string, LoginState>();
const cancels = new Map<string, () => void>();

/** Stops a login that is still waiting (its Chrome window is closed); returns whether one was running. */
export function cancelLogin(schoolId: string): boolean {
  const cancel = cancels.get(schoolId);
  cancel?.();
  return !!cancel;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getLoginState(schoolId: string): LoginState {
  return states.get(schoolId) ?? { status: 'idle', message: '', startedAt: null };
}

function setState(schoolId: string, s: Omit<LoginState, 'startedAt'>): void {
  states.set(schoolId, { ...s, startedAt: states.get(schoolId)?.startedAt ?? new Date().toISOString() });
}

function toStored(cookies: Awaited<ReturnType<BrowserContext['cookies']>>): StoredCookie[] {
  return cookies.map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path, expires: c.expires, httpOnly: c.httpOnly, secure: c.secure, sameSite: c.sameSite }));
}

/** Uses the browser's cookies from Node, exactly as the sync will — so success here means the sync works. */
export async function checkLoggedIn(context: BrowserContext, baseUrl: string, userAgent = 'Mozilla/5.0'): Promise<{ id: string; name: string } | null> {
  try {
    const jar = new CookieJar(toStored(await context.cookies(baseUrl)));
    if (!jar.headerFor(`${baseUrl}/api/v1/users/self`)) return null;
    const client = new CanvasClient({ baseUrl, auth: { kind: 'session', jar, userAgent }, sleep: async () => {} });
    const me = await client.get<{ id: string; name?: string }>('/api/v1/users/self');
    return me?.id ? { id: String(me.id), name: me.name ?? '' } : null;
  } catch {
    return null;
  }
}

/**
 * Hosts of the pages and frames a sign-in navigates through: Canvas, the school's SSO, its "remember me" hops.
 * Frames count only while the window is still signing in — not the tools a Canvas page embeds once it's reached
 * (a dashboard that embeds a chat tool: that has nothing to do with logging in).
 */
function trackLoginHosts(context: BrowserContext, canvasHost: string): Set<string> {
  const hosts = new Set<string>();
  const onCanvasPage = (url: string) => {
    try {
      const u = new URL(url);
      return u.hostname === canvasHost && !u.pathname.startsWith('/login');
    } catch {
      return false;
    }
  };
  const add = (url: string) => {
    try {
      const host = new URL(url).hostname;
      if (host) hosts.add(host);
    } catch {
      // about:blank, data: …
    }
  };
  // where the window already is (Chrome opened /login and followed its redirect before we attached) …
  for (const page of context.pages()) for (const frame of page.frames()) add(frame.url());
  // … and every page or frame it goes to from here
  context.on('request', (r) => {
    if (!r.isNavigationRequest()) return;
    try {
      const frame = r.frame();
      if (frame.parentFrame() && onCanvasPage(frame.page().url())) return;
    } catch {
      // no frame to ask about (a service worker's own fetch): count it
    }
    add(r.url());
  });
  return hosts;
}

async function saveSession(db: DB, schoolId: string, context: BrowserContext, userAgent: string, fallbackName: string, silent: boolean, login: { visited: Set<string>; signedIn: boolean }): Promise<void> {
  const school = getSchool(db, schoolId)!;
  const chosen = chooseLoginCookies({
    all: toStored(await context.cookies()), canvasHost: new URL(school.base_url).hostname, ...login, previousHosts: loadAuth(schoolId)?.loginHosts,
  });
  saveAuth({ schoolId, savedAt: new Date().toISOString(), userAgent, cookies: chosen.cookies, ...(chosen.loginHosts ? { loginHosts: chosen.loginHosts } : {}) });
  let profile: CanvasProfile | null = null;
  try {
    const jar = new CookieJar(toStored(await context.cookies(school.base_url)));
    profile = await new CanvasClient({ baseUrl: school.base_url, auth: { kind: 'session', jar, userAgent } }).get<CanvasProfile>('/api/v1/users/self/profile');
  } catch (err) {
    log('warn', `profile after login failed for ${schoolId}`, err);
  }
  const now = new Date().toISOString();
  updateSchool(db, schoolId, {
    auth_mode: 'session', status: 'ok', status_detail: null, alive_at: now,
    user_name: profile?.name ?? fallbackName ?? school.user_name, ics_url: profile?.calendar?.ics ?? school.ics_url,
    ...(silent ? { renewals: school.renewals + 1 } : { login_at: now, renewals: 0 }),
  });
}

export async function interactiveLogin(db: DB, schoolId: string, opts: { timeoutMs?: number; headless?: boolean; onPage?: (page: Page) => Promise<void> } = {}): Promise<{ ok: boolean; message: string }> {
  const school = getSchool(db, schoolId);
  if (!school) return { ok: false, message: '学校不存在' };
  cancelLogin(schoolId); // a newer click replaces an attempt that is still waiting
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
  };
  cancels.set(schoolId, cancel);
  states.set(schoolId, { status: 'waiting', message: '正在打开 Chrome 登录窗口…', startedAt: new Date().toISOString() });
  const finish = (ok: boolean, message: string) => {
    if (cancels.get(schoolId) === cancel) {
      cancels.delete(schoolId);
      setState(schoolId, { status: ok ? 'success' : 'failed', message });
    }
    return { ok, message };
  };
  try {
    return await withChromeLock(async () => {
      if (cancelled) return finish(false, '已取消');
      const session = await launchChrome({ url: `${school.base_url}/login`, headless: opts.headless ?? false });
      const visited = trackLoginHosts(session.context, new URL(school.base_url).hostname);
      if (cancels.get(schoolId) === cancel) setState(schoolId, { status: 'waiting', message: '已在 Chrome 打开登录窗口，请完成登录（SSO / Duo 照常）…' });
      let closed = false;
      let sawPage = session.context.pages().length > 0;
      void session.exited.then(() => {
        closed = true;
      });
      try {
        if (opts.onPage) {
          const page = session.context.pages()[0] ?? (await session.context.waitForEvent('page'));
          await opts.onPage(page);
        }
        const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
        let wasLoggedOut = false; // the user really signed in here (rather than the window being logged in already)
        while (Date.now() < deadline) {
          const me = await checkLoggedIn(session.context, school.base_url, session.userAgent);
          if (!me) wasLoggedOut = true;
          if (me) {
            await saveSession(db, schoolId, session.context, session.userAgent, me.name, false, { visited, signedIn: wasLoggedOut });
            return finish(true, `已登录${me.name ? `：${me.name}` : ''}`);
          }
          if (cancelled) return finish(false, '已取消（重新打开了登录窗口）');
          // On macOS closing the window doesn't quit Chrome, so "no pages left" also means the user gave up.
          const open = session.context.pages().length;
          if (open > 0) sawPage = true;
          if (closed || (sawPage && open === 0)) return finish(false, '登录窗口被关闭了，请重新点「登录」');
          await sleep(2000);
        }
        return finish(false, '等待登录超时，请重新点「登录」');
      } finally {
        await session.close();
      }
    });
  } catch (err) {
    log('error', `interactive login failed for ${schoolId}`, err);
    return finish(false, `登录失败：${(err as Error).message}`);
  }
}

const CANVAS_SESSION_COOKIES = new Set(['canvas_session', '_normandy_session', '_legacy_normandy_session']);

/**
 * Of the accounts on an identity provider's "Pick an account" page, the one that belongs to this school: its address
 * shares the most trailing labels with the Canvas host (student.example.edu ↔ canvas.example.edu), at least two, and no
 * other address shares as many. Anything less certain is left to the user.
 */
export function matchSchoolAccount(emails: string[], canvasHost: string): string | null {
  const labels = (h: string) => h.toLowerCase().split('.').reverse();
  const host = labels(canvasHost);
  const scored = emails.map((email) => {
    const d = labels(email.split('@')[1] ?? '');
    let n = 0;
    while (n < d.length && n < host.length && d[n] === host[n]) n++;
    return { email, n };
  }).filter((x) => x.n >= 2);
  const best = Math.max(0, ...scored.map((x) => x.n));
  const top = scored.filter((x) => x.n === best);
  return top.length === 1 ? top[0].email : null;
}

/**
 * Microsoft shows "Pick an account" when the saved login holds more than one signed-in school account (two schools
 * signed in through the same browser); without a pick, a silent renewal would wait there until it gave up. Picks this school's
 * account; returns its address, or null when the page isn't a picker or no account is clearly this school's.
 */
export async function pickSchoolAccount(page: Page, canvasHost: string): Promise<string | null> {
  const ids = await page.locator('[role=button][data-test-id*="@"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-test-id') ?? '')).catch(() => [] as string[]);
  const email = matchSchoolAccount(ids.filter((id) => /^[^@\s"]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(id)), canvasHost);
  if (!email) return null;
  const clicked = await page.locator(`[role=button][data-test-id="${email}"]`).first().click({ timeout: 5000 }).then(() => true, () => false);
  return clicked ? email : null;
}

/**
 * Proactive daily refresh: drop only the Canvas session cookie (inside the throwaway headless browser) so Canvas
 * sends us through the school's SSO, which refreshes the identity provider's "remember me" cookies and yields a
 * new Canvas session. If the SSO round trip doesn't complete, the saved (still working) login is left untouched.
 */
export function refreshSso(db: DB, schoolId: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  return silentRelogin(db, schoolId, { ...opts, forceSso: true });
}

export async function silentRelogin(db: DB, schoolId: string, opts: { timeoutMs?: number; forceSso?: boolean } = {}): Promise<boolean> {
  return (await silentReloginOutcome(db, schoolId, opts)) === 'renewed';
}

/** For keep-alive and sync: true = renewed, false = the user must log in, 'error' = couldn't try this time. */
export async function silentReloginResult(db: DB, schoolId: string): Promise<boolean | 'error'> {
  const o = await silentReloginOutcome(db, schoolId);
  return o === 'renewed' ? true : o === 'error' ? 'error' : false;
}

/**
 * 'renewed' — back in without the user; 'password' — the school wants the user (password / Duo);
 * 'error' — the attempt itself couldn't run (Chrome didn't start on a busy Mac, the page never loaded): try later.
 */
export async function silentReloginOutcome(db: DB, schoolId: string, opts: { timeoutMs?: number; forceSso?: boolean } = {}): Promise<'renewed' | 'password' | 'error'> {
  const school = getSchool(db, schoolId);
  const auth = loadAuth(schoolId);
  if (!school || !auth || school.auth_mode === 'token' || auth.cookies.length === 0) return 'password';
  try {
    return await withChromeLock(async () => {
      const session = await launchChrome({ url: 'about:blank', headless: true, userAgent: auth.userAgent });
      const canvasHost = new URL(school.base_url).hostname;
      const visited = trackLoginHosts(session.context, canvasHost);
      try {
        const now = Date.now() / 1000;
        const keep = auth.cookies.filter((c) => (c.expires === -1 || c.expires > now)
          && !(opts.forceSso && CANVAS_SESSION_COOKIES.has(c.name) && canvasHost.endsWith(c.domain.replace(/^\./, ''))));
        await session.context.clearCookies(); // the shared profile may hold older cookies; the saved set is the truth
        await session.context.addCookies(keep.map((c) => ({ ...c, sameSite: c.sameSite ?? 'Lax' })));
        const page = session.context.pages()[0] ?? (await session.context.newPage());
        const loaded = await page.goto(`${school.base_url}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).then(() => true, () => false);
        const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
        let passwordSince: number | null = null;
        let pickedAccount = false;
        while (Date.now() < deadline) {
          const me = await checkLoggedIn(session.context, school.base_url, session.userAgent);
          if (me) {
            // the Canvas session was expired or dropped, so getting back in proves these sites are enough
            await saveSession(db, schoolId, session.context, session.userAgent, me.name, true, { visited, signedIn: true });
            log('info', `silent re-login succeeded for ${schoolId}`);
            return 'renewed' as const;
          }
          if (!pickedAccount && (await pickSchoolAccount(page, canvasHost))) {
            pickedAccount = true; // once: if that account can't get in silently, it's the user's turn
            log('info', `silent re-login for ${schoolId}: picked the ${canvasHost.split('.').slice(-2).join('.')} account on the account picker`);
            await sleep(1500);
            continue;
          }
          const needsPassword = await page.locator('input[type=password]').first().isVisible().catch(() => false);
          passwordSince = needsPassword ? passwordSince ?? Date.now() : null;
          if (passwordSince && Date.now() - passwordSince > 10_000) break;
          await sleep(1500);
        }
        return loaded ? ('password' as const) : ('error' as const);
      } finally {
        await session.close();
      }
    });
  } catch (err) {
    log('warn', `silent re-login could not run for ${schoolId}`, err);
    return 'error';
  }
}
