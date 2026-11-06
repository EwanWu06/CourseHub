// Keeps school logins alive: a tiny authenticated request every ~30 minutes resets inactivity timeouts;
// an expired session is renewed silently (SSO "remember me"); the user is only asked when that fails.
import { SessionExpiredError } from '../canvas/client.ts';
import type { DB } from '../db/index.ts';
import { getSchool, listSchools, updateSchool } from '../db/schools.ts';
import type { SchoolRow } from '../db/types.ts';
import { syncRunning } from '../sync/index.ts';
import { log } from '../util/log.ts';
import { silentReloginResult } from './login.ts';
import { loadAuth, makeClient, persistClientCookies } from './store.ts';

export type KeepAliveResult = 'ok' | 'renewed' | 'expired' | 'skipped' | 'error';

const couldNotTry = new Map<string, number>();
const MAX_COULD_NOT_TRY = 3; // ≈ 1.5 h of keep-alive rounds before telling the user

export interface KeepAliveOptions {
  /** true = renewed, false = the user must log in, 'error' = the attempt couldn't run this time */
  relogin?: ((schoolId: string) => Promise<boolean | 'error'>) | null;
  onLoginNeeded?: (school: SchoolRow) => void;
}

export async function keepAlive(db: DB, schoolId: string, opts: KeepAliveOptions = {}): Promise<KeepAliveResult> {
  const school = getSchool(db, schoolId);
  if (!school || school.auth_mode === 'token') return 'skipped';
  if (syncRunning() === schoolId) return 'skipped'; // the running sync is keeping it alive
  const client = makeClient(school);
  if (!client) return 'skipped';
  try {
    await client.get('/api/v1/users/self');
    persistClientCookies(schoolId, client);
    const now = new Date().toISOString();
    updateSchool(db, schoolId, {
      alive_at: now,
      ...(school.login_at ? {} : { login_at: loadAuth(schoolId)?.savedAt ?? now }),
      ...(school.status === 'needs_login' ? { status: 'ok' as const, status_detail: null } : {}),
    });
    return 'ok';
  } catch (err) {
    if (!(err instanceof SessionExpiredError)) {
      log('warn', `keep-alive ${schoolId} failed`, err);
      return 'error';
    }
  }
  const relogin = opts.relogin === undefined ? (id: string) => silentReloginResult(db, id) : opts.relogin;
  const outcome = relogin ? await relogin(schoolId) : false;
  if (outcome === 'error') {
    // Chrome didn't start / the page never loaded (busy Mac, network blip): not a lost login — try again next round
    const n = (couldNotTry.get(schoolId) ?? 0) + 1;
    couldNotTry.set(schoolId, n);
    if (n < MAX_COULD_NOT_TRY) {
      log('warn', `silent renewal for ${schoolId} could not run (${n} in a row); retrying later`);
      return 'error';
    }
  }
  couldNotTry.delete(schoolId);
  if (outcome === true) {
    const fresh = getSchool(db, schoolId)!;
    // silentRelogin already counted itself; injected relogins (tests, other flows) are counted here
    if (fresh.renewals === school.renewals) updateSchool(db, schoolId, { renewals: school.renewals + 1 });
    updateSchool(db, schoolId, { status: 'ok', status_detail: null, alive_at: new Date().toISOString() });
    log('info', `session for ${schoolId} renewed silently`);
    return 'renewed';
  }
  if (school.status !== 'needs_login') {
    updateSchool(db, schoolId, { status: 'needs_login', status_detail: '登录已过期，自动续期失败，请重新登录' });
    opts.onLoginNeeded?.(getSchool(db, schoolId)!);
  }
  return 'expired';
}

export async function keepAliveAll(db: DB, opts: KeepAliveOptions = {}): Promise<Record<string, KeepAliveResult>> {
  const out: Record<string, KeepAliveResult> = {};
  for (const s of listSchools(db)) out[s.id] = await keepAlive(db, s.id, opts);
  return out;
}
