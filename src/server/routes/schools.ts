import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { paths } from '../../config.ts';
import { DEFAULT_USER_AGENT } from '../../canvas/client.ts';
import type { DB } from '../../db/index.ts';
import { recentSyncRuns } from '../../db/runs.ts';
import { createSchool, deleteSchool, getSchool, listSchools, updateSchool } from '../../db/schools.ts';
import type { SchoolRow } from '../../db/types.ts';
import { deleteAuth, loadAuth, saveAuth } from '../../auth/store.ts';
import { getLoginState, interactiveLogin } from '../../auth/login.ts';
import { log } from '../../util/log.ts';
import { HttpError, isUrl, readJson } from './util.ts';
import type { SyncStarter } from './sync.ts';

function failStreak(db: DB, schoolId: string): number {
  let n = 0;
  for (const run of recentSyncRuns(db, 10, schoolId)) {
    if (run.status === 'running') continue;
    if (run.status === 'ok') break;
    n++;
  }
  return n;
}

export function schoolView(db: DB, s: SchoolRow) {
  const auth = loadAuth(s.id);
  return {
    ...s,
    links: JSON.parse(s.links) as { label: string; url: string }[],
    failStreak: failStreak(db, s.id),
    loginState: getLoginState(s.id),
    hasAuth: !!auth && (auth.cookies.length > 0 || !!auth.token),
    hasToken: !!auth?.token,
  };
}

export function registerSchools(app: Hono, db: DB, deps: { startLogin?: typeof interactiveLogin; startSync: SyncStarter }): void {
  const startLogin = deps.startLogin ?? interactiveLogin;
  const requireSchool = (id: string) => {
    const s = getSchool(db, id);
    if (!s) throw new HttpError(404, '学校不存在');
    return s;
  };

  app.get('/api/schools', (c) => c.json(listSchools(db).map((s) => schoolView(db, s))));

  app.post('/api/schools', async (c) => {
    const body = await readJson<{ name?: string; baseUrl?: string }>(c);
    try {
      return c.json(schoolView(db, createSchool(db, { name: body.name ?? '', base_url: body.baseUrl ?? '' })), 201);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
  });

  app.patch('/api/schools/:id', async (c) => {
    const school = requireSchool(c.req.param('id'));
    const body = await readJson<{ name?: string; color?: string; icsUrl?: string | null; links?: { label: string; url: string }[]; token?: string }>(c);
    const patch: Partial<SchoolRow> = {};
    if (body.name !== undefined) {
      if (!body.name.trim()) throw new HttpError(400, '学校名称不能为空');
      patch.name = body.name.trim();
    }
    if (body.color !== undefined) {
      if (!/^#[0-9a-f]{6}$/i.test(body.color)) throw new HttpError(400, '颜色格式应为 #RRGGBB');
      patch.color = body.color;
    }
    if (body.icsUrl !== undefined) {
      const v = body.icsUrl?.trim() || null;
      if (v && !isUrl(v)) throw new HttpError(400, '日历订阅链接格式不对');
      patch.ics_url = v;
    }
    if (body.links !== undefined) {
      if (!Array.isArray(body.links) || body.links.length > 10 || body.links.some((l) => !l?.label?.trim() || !isUrl(l.url))) throw new HttpError(400, '常用链接格式不对');
      patch.links = JSON.stringify(body.links.map((l) => ({ label: l.label.trim(), url: l.url.trim() })));
    }
    if (body.token !== undefined) {
      const existing = loadAuth(school.id);
      const token = body.token.trim();
      if (token) {
        saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: existing?.userAgent ?? DEFAULT_USER_AGENT, cookies: existing?.cookies ?? [], token });
        patch.auth_mode = 'token';
        patch.status = 'new';
      } else if (existing) {
        saveAuth({ ...existing, token: undefined });
        patch.auth_mode = 'session';
      }
    }
    updateSchool(db, school.id, patch);
    return c.json(schoolView(db, getSchool(db, school.id)!));
  });

  app.delete('/api/schools/:id', (c) => {
    const school = requireSchool(c.req.param('id'));
    deleteAuth(school.id);
    deleteSchool(db, school.id);
    try {
      for (const f of readdirSync(paths().text)) if (f.startsWith(`${school.id}_f_`)) rmSync(path.join(paths().text, f), { force: true });
    } catch {
      // no text dir yet
    }
    return c.json({ ok: true });
  });

  app.post('/api/schools/:id/login', (c) => {
    const school = requireSchool(c.req.param('id'));
    // Clicking again while a login is waiting replaces it (e.g. the window was closed or hidden).
    void (async () => {
      const res = await startLogin(db, school.id);
      if (res.ok) deps.startSync({ schoolId: school.id, reason: 'after-login' });
    })().catch((err) => log('error', 'login job failed', err));
    return c.json({ status: 'waiting' }, 202);
  });

  app.get('/api/schools/:id/login', (c) => c.json(getLoginState(requireSchool(c.req.param('id')).id)));
}
