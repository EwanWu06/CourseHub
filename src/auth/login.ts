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
import { loadAuth, saveAuth } from './store.ts';

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

async function saveSession(db: DB, schoolId: string, context: BrowserContext, userAgent: string, fallbackName: string, silent = false): Promise<void> {
  saveAuth({ schoolId, savedAt: new Date().toISOString(), userAgent, cookies: toStored(await context.cookies()) });
  const school = getSchool(db, schoolId)!;
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
        while (Date.now() < deadline) {
          const me = await checkLoggedIn(session.context, school.base_url, session.userAgent);
          if (me) {
            await saveSession(db, schoolId, session.context, session.userAgent, me.name);
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
 * Proactive daily refresh: drop only the Canvas session cookie (inside the throwaway headless browser) so Canvas
 * sends us through the school's SSO, which refreshes the identity provider's "remember me" cookies and yields a
 * new Canvas session. If the SSO round trip doesn't complete, the saved (still working) login is left untouched.
 */
export function refreshSso(db: DB, schoolId: string, opts: { timeoutMs?: number } = {}): Promise<boolean> {
  return silentRelogin(db, schoolId, { ...opts, forceSso: true });
}

export async function silentRelogin(db: DB, schoolId: string, opts: { timeoutMs?: number; forceSso?: boolean } = {}): Promise<boolean> {
  const school = getSchool(db, schoolId);
  const auth = loadAuth(schoolId);
  if (!school || !auth || school.auth_mode === 'token' || auth.cookies.length === 0) return false;
  try {
    return await withChromeLock(async () => {
      const session = await launchChrome({ url: 'about:blank', headless: true, userAgent: auth.userAgent });
      try {
        const now = Date.now() / 1000;
        const canvasHost = new URL(school.base_url).hostname;
        const keep = auth.cookies.filter((c) => (c.expires === -1 || c.expires > now)
          && !(opts.forceSso && CANVAS_SESSION_COOKIES.has(c.name) && canvasHost.endsWith(c.domain.replace(/^\./, ''))));
        await session.context.clearCookies(); // the shared profile may hold older cookies; the saved set is the truth
        await session.context.addCookies(keep.map((c) => ({ ...c, sameSite: c.sameSite ?? 'Lax' })));
        const page = session.context.pages()[0] ?? (await session.context.newPage());
        await page.goto(`${school.base_url}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
        const deadline = Date.now() + (opts.timeoutMs ?? 45_000);
        let passwordSince: number | null = null;
        while (Date.now() < deadline) {
          const me = await checkLoggedIn(session.context, school.base_url, session.userAgent);
          if (me) {
            await saveSession(db, schoolId, session.context, session.userAgent, me.name, true);
            log('info', `silent re-login succeeded for ${schoolId}`);
            return true;
          }
          const needsPassword = await page.locator('input[type=password]').first().isVisible().catch(() => false);
          passwordSince = needsPassword ? passwordSince ?? Date.now() : null;
          if (passwordSince && Date.now() - passwordSince > 10_000) break;
          await sleep(1500);
        }
        return false;
      } finally {
        await session.close();
      }
    });
  } catch (err) {
    log('warn', `silent re-login failed for ${schoolId}`, err);
    return false;
  }
}
