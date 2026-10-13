import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir } from '../helpers.ts';
import { startMockCanvas } from '../../mock/server.ts';
import { openDb } from '../../src/db/index.ts';
import { createSchool, getSchool } from '../../src/db/schools.ts';
import { paths } from '../../src/config.ts';
import { loadAuth } from '../../src/auth/store.ts';
import { interactiveLogin, silentRelogin, getLoginState } from '../../src/auth/login.ts';
import { withChromeLock } from '../../src/auth/chrome.ts';
import { syncSchool } from '../../src/sync/index.ts';
import type { Page } from 'playwright-core';

async function fillLogin(page: Page) {
  await page.waitForSelector('#username', { timeout: 15_000 });
  await page.fill('#username', 'student');
  await page.fill('#password', 'password');
  await page.check('#remember');
  await page.click('#submit');
}

test('SSO login in Chrome saves a private session that the sync can use; silent re-login works with remember-me', { timeout: 120_000 }, async () => {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'alpha', idp: true });
  try {
    const school = createSchool(db, { name: 'Alpha', base_url: mock.baseUrl });
    const res = await interactiveLogin(db, school.id, { headless: true, onPage: fillLogin, timeoutMs: 60_000 });
    assert.equal(res.ok, true, res.message);
    assert.equal(getLoginState(school.id).status, 'success');

    const authFile = path.join(paths().auth, `${school.id}.json`);
    assert.equal(statSync(authFile).mode & 0o777, 0o600);
    const auth = loadAuth(school.id)!;
    assert.ok(auth.cookies.some((c) => c.name === 'canvas_session'));
    assert.ok(auth.cookies.some((c) => c.name === 'idp_remember'), 'identity-provider cookies are kept for silent re-login');
    assert.doesNotMatch(auth.userAgent, /Headless/);
    const after = getSchool(db, school.id)!;
    assert.equal(after.status, 'ok');
    assert.equal(after.ics_url, `${mock.baseUrl}/feeds/calendars/user_alpha-ics-token.ics`);

    assert.equal((await syncSchool(db, school.id, { reason: 'test', relogin: null })).mode, 'api');

    mock.expireSessions();
    assert.equal(await silentRelogin(db, school.id), true);
    assert.equal((await syncSchool(db, school.id, { reason: 'test', relogin: null })).mode, 'api');

    mock.expireSessions();
    mock.setRemember(false);
    const started = Date.now();
    assert.equal(await silentRelogin(db, school.id, { timeoutMs: 40_000 }), false);
    assert.ok(Date.now() - started < 30_000, 'gives up early once a password form is showing');
  } finally {
    await mock.close();
  }
});

test('withChromeLock runs one Chrome job at a time', async () => {
  const order: string[] = [];
  const job = (name: string) => withChromeLock(async () => {
    order.push(`${name}:start`);
    await new Promise((r) => setTimeout(r, 30));
    order.push(`${name}:end`);
  });
  await Promise.all([job('a'), job('b')]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b:start', 'b:end']);
});
