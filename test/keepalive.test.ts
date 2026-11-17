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

test('only cookies of the sites a sign-in went through are kept (not YouTube, Office or the other schools)', async () => {
  const { chooseLoginCookies, cookiesForHosts } = await import('../src/auth/store.ts');
  const c = (domain: string, name = 'x') => ({ name, value: 'v', domain, path: '/', expires: -1, httpOnly: true, secure: true });
  const all = [
    c('online.smc.edu', 'canvas_session'), c('.login.microsoftonline.com', 'ESTSAUTHPERSISTENT'), c('.microsoftonline.com'),
    c('autologon.microsoftazuread-sso.com'), c('.youtube.com'), c('www.office.com'), c('ilearn.laccd.edu', 'canvas_session'),
    c('a2340-1.cluster37.canvas-user-content.com'), c('.google.com', 'SID'),
  ];
  const visited = ['online.smc.edu', 'login.microsoftonline.com', 'autologon.microsoftazuread-sso.com', 'a2340-1.cluster37.canvas-user-content.com'];
  const chosen = chooseLoginCookies({ all, canvasHost: 'online.smc.edu', visited, signedIn: true });
  assert.deepEqual(chosen.cookies.map((x) => x.domain), ['online.smc.edu', '.login.microsoftonline.com', '.microsoftonline.com', 'autologon.microsoftazuread-sso.com']);
  assert.deepEqual(chosen.loginHosts, ['online.smc.edu', 'login.microsoftonline.com', 'autologon.microsoftazuread-sso.com']);

  // still logged in, so the browser went nowhere: with nothing learned yet, everything is kept as before
  assert.equal(chooseLoginCookies({ all, canvasHost: 'online.smc.edu', visited: ['online.smc.edu'], signedIn: false }).cookies.length, all.length);
  // … but what an earlier sign-in taught is still applied
  const again = chooseLoginCookies({ all, canvasHost: 'online.smc.edu', visited: [], signedIn: false, previousHosts: chosen.loginHosts });
  assert.equal(again.cookies.length, 4);
  // a site seen in either sign-in is kept
  assert.ok(chooseLoginCookies({ all, canvasHost: 'online.smc.edu', visited: ['accounts.google.com'], signedIn: true, previousHosts: chosen.loginHosts }).cookies.some((x) => x.name === 'SID'));
  // Canvas's own login (no SSO): getting back in without leaving the Canvas site proves only its cookies are needed
  const own = chooseLoginCookies({ all, canvasHost: 'online.smc.edu', visited: ['online.smc.edu'], signedIn: true });
  assert.deepEqual(own.cookies.map((x) => x.domain), ['online.smc.edu']);
  assert.deepEqual(own.loginHosts, ['online.smc.edu']);
  assert.deepEqual(cookiesForHosts([c('login.microsoftonline.com')], ['microsoftonline.com']), [], 'a parent host does not get a subdomain\'s cookie');
});

test('cookies picked up while syncing are trimmed to the sign-in sites once those are known', async () => {
  const { db, mock, id } = await setup();
  try {
    const { loadAuth, saveAuth: save } = await import('../src/auth/store.ts');
    const host = new URL(mock.baseUrl).hostname;
    const auth = loadAuth(id)!;
    const junk = { name: 'yt', value: 'v', domain: '.youtube.com', path: '/', expires: -1, httpOnly: true, secure: false };
    save({ ...auth, cookies: [...auth.cookies, junk], loginHosts: [host] });
    assert.equal(await keepAlive(db, id, { relogin: null }), 'ok');
    const { makeClient, persistClientCookies } = await import('../src/auth/store.ts');
    const client = makeClient((await import('../src/db/schools.ts')).getSchool(db, id)!)!;
    if (client.auth.kind === 'session') client.auth.jar.changed = true;
    persistClientCookies(id, client);
    const after = loadAuth(id)!;
    assert.ok(!after.cookies.some((x) => x.domain === '.youtube.com'));
    assert.ok(after.cookies.length > 0, 'the Canvas session itself is kept');
    assert.equal(await keepAlive(db, id, { relogin: null }), 'ok', 'and still works');
  } finally {
    await mock.close();
  }
});

test("on Microsoft's account picker, the school's own account is the one whose address matches its Canvas site", async () => {
  const { matchSchoolAccount } = await import('../src/auth/login.ts');
  // made-up schools on the reserved .example domain (real school domains could be someone's real address)
  const both = ['jdoe7@student.alpha.example', 'JDOE01@student.beta.example'];
  assert.equal(matchSchoolAccount(both, 'ilearn.alpha.example'), 'jdoe7@student.alpha.example');
  assert.equal(matchSchoolAccount(both, 'online.beta.example'), 'JDOE01@student.beta.example');
  assert.equal(matchSchoolAccount(both, 'my.gamma.example'), null, 'only the top-level domain in common: not this school\'s');
  assert.equal(matchSchoolAccount(['a@one.ac.example', 'b@two.ac.example'], 'canvas.one.ac.example'), 'a@one.ac.example');
  assert.equal(matchSchoolAccount(['a@student.alpha.example', 'b@alpha.example'], 'ilearn.alpha.example'), null, 'two accounts of the same school: the user picks');
  assert.equal(matchSchoolAccount([], 'ilearn.alpha.example'), null);
});
