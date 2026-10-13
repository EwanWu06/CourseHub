import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool, getSchool, updateSchool } from '../src/db/schools.ts';
import { saveAuth } from '../src/auth/store.ts';
import { keepAlive, keepAliveAll } from '../src/auth/keepalive.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup(idleTimeoutMs?: number) {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'alpha', idleTimeoutMs });
  const school = createSchool(db, { name: 'Alpha', base_url: mock.baseUrl });
  updateSchool(db, school.id, { status: 'ok' });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  return { db, mock, id: school.id };
}

test('regular keep-alives stop an idle timeout from ending the session', async () => {
  const { db, mock, id } = await setup(400);
  try {
    for (let i = 0; i < 6; i++) {
      assert.equal(await keepAlive(db, id, { relogin: null }), 'ok');
      await sleep(150);
    }
    assert.ok(getSchool(db, id)!.alive_at, 'records when the session was last confirmed');
    assert.ok(getSchool(db, id)!.login_at, 'logins from before this feature get their login time back-filled');
  } finally {
    await mock.close();
  }
});

test('an expired session is renewed silently and counted', async () => {
  const { db, mock, id } = await setup(200);
  try {
    await sleep(350);
    let calls = 0;
    const result = await keepAlive(db, id, {
      relogin: async (schoolId) => {
        calls++;
        saveAuth({ schoolId, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
        return true;
      },
    });
    assert.equal(result, 'renewed');
    assert.equal(calls, 1);
    assert.equal(getSchool(db, id)!.renewals, 1);
    assert.equal(getSchool(db, id)!.status, 'ok');
  } finally {
    await mock.close();
  }
});

test('when silent renewal fails the user is told once', async () => {
  const { db, mock, id } = await setup();
  try {
    mock.expireSessions();
    const told: string[] = [];
    assert.equal(await keepAlive(db, id, { relogin: async () => false, onLoginNeeded: (s) => told.push(s.id) }), 'expired');
    assert.equal(getSchool(db, id)!.status, 'needs_login');
    assert.equal(await keepAlive(db, id, { relogin: async () => false, onLoginNeeded: (s) => told.push(s.id) }), 'expired');
    assert.deepEqual(told, [id], 'no repeated alerts while still logged out');
  } finally {
    await mock.close();
  }
});

test('a working session clears a stale needs_login status', async () => {
  const { db, mock, id } = await setup();
  try {
    updateSchool(db, id, { status: 'needs_login', status_detail: '登录已过期，请重新登录' });
    assert.equal(await keepAlive(db, id, { relogin: null }), 'ok');
    assert.equal(getSchool(db, id)!.status, 'ok');
    assert.equal(getSchool(db, id)!.status_detail, null);
  } finally {
    await mock.close();
  }
});

test('token schools and schools without a login are skipped', async () => {
  const { db, mock, id } = await setup();
  try {
    updateSchool(db, id, { auth_mode: 'token' });
    assert.equal(await keepAlive(db, id, { relogin: null }), 'skipped');
    const other = createSchool(db, { name: 'No login', base_url: 'nologin.instructure.com' });
    const all = await keepAliveAll(db, { relogin: null });
    assert.equal(all[other.id], 'skipped');
  } finally {
    await mock.close();
  }
});

test('when Chrome itself could not run, the renewal is retried later instead of asking the user to log in', async () => {
  const { db, mock, id } = await setup();
  try {
    mock.expireSessions();
    const told: string[] = [];
    const broken = { relogin: async () => 'error' as const, onLoginNeeded: (s: { id: string }) => { told.push(s.id); } };
    assert.equal(await keepAlive(db, id, broken), 'error');
    assert.equal(await keepAlive(db, id, broken), 'error');
    assert.equal(getSchool(db, id)!.status, 'ok', 'two failures to start Chrome are not a lost login');
    assert.deepEqual(told, []);
    assert.equal(await keepAlive(db, id, broken), 'expired', 'the third in a row is reported');
    assert.equal(getSchool(db, id)!.status, 'needs_login');
    assert.deepEqual(told, [id]);
  } finally {
    await mock.close();
  }
});

test('a successful renewal resets the count of Chrome failures', async () => {
  const { db, mock, id } = await setup();
  try {
    mock.expireSessions();
    assert.equal(await keepAlive(db, id, { relogin: async () => 'error' as const }), 'error');
    assert.equal(await keepAlive(db, id, { relogin: async () => 'error' as const }), 'error');
    assert.equal(await keepAlive(db, id, { relogin: async () => true }), 'renewed');
    mock.expireSessions();
    assert.equal(await keepAlive(db, id, { relogin: async () => 'error' as const }), 'error', 'counting starts again');
  } finally {
    await mock.close();
  }
});
