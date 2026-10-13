import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool, getSchool, updateSchool } from '../src/db/schools.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';

async function setup() {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'alpha' });
  const school = createSchool(db, { name: 'Alpha', base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  return { db, mock, id: school.id };
}

test('failed re-login marks the school and signals login-needed once', async () => {
  const { db, mock, id } = await setup();
  try {
    await syncSchool(db, id, { reason: 'test', relogin: null });
    mock.expireSessions();
    let reloginCalls = 0;
    const needed: string[] = [];
    await syncSchool(db, id, { reason: 'test', relogin: async () => { reloginCalls++; return false; }, onLoginNeeded: (s) => needed.push(s.id) });
    assert.equal(reloginCalls, 1);
    assert.deepEqual(needed, [id]);
    const s = getSchool(db, id)!;
    assert.equal(s.status, 'needs_login');
    assert.equal(s.status_detail, '登录已过期，请重新登录');

    await syncSchool(db, id, {
      reason: 'test',
      relogin: async () => {
        saveAuth({ schoolId: id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
        return true;
      },
    });
    const ok = getSchool(db, id)!;
    assert.equal(ok.status, 'ok');
    assert.equal(ok.status_detail, null);
  } finally {
    await mock.close();
  }
});

test('token schools never try a browser re-login', async () => {
  const { db, mock, id } = await setup();
  try {
    updateSchool(db, id, { auth_mode: 'token' });
    saveAuth({ schoolId: id, savedAt: new Date().toISOString(), userAgent: 'x', cookies: [], token: 'mock-token' });
    assert.equal((await syncSchool(db, id, { reason: 'test', relogin: null })).mode, 'api');
    saveAuth({ schoolId: id, savedAt: new Date().toISOString(), userAgent: 'x', cookies: [], token: 'revoked' });
    let reloginCalls = 0;
    const stats = await syncSchool(db, id, { reason: 'test', relogin: async () => { reloginCalls++; return true; } });
    assert.equal(reloginCalls, 0);
    assert.equal(stats.mode, 'ics');
    assert.equal(getSchool(db, id)!.status, 'needs_login');
    assert.match(getSchool(db, id)!.status_detail!, /令牌/);
  } finally {
    await mock.close();
  }
});
