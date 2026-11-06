import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CookieJar } from '../src/canvas/cookies.ts';
import type { StoredCookie } from '../src/canvas/cookies.ts';

const future = Math.floor(Date.now() / 1000) + 3600;
const c = (p: Partial<StoredCookie>): StoredCookie => ({
  name: 'canvas_session', value: 'v', domain: 'smc.instructure.com', path: '/', expires: -1, httpOnly: true, secure: true, ...p,
});

test('host-only cookies are sent only to that exact host', () => {
  const jar = new CookieJar([c({})]);
  assert.equal(jar.headerFor('https://smc.instructure.com/api/v1/courses'), 'canvas_session=v');
  assert.equal(jar.headerFor('https://x.smc.instructure.com/api/v1/courses'), '');
});

test('domain cookies are sent to subdomains but never to other sites', () => {
  const jar = new CookieJar([c({ name: 'log_session_id', value: 'L', domain: '.instructure.com' })]);
  assert.equal(jar.headerFor('https://smc.instructure.com/'), 'log_session_id=L');
  assert.equal(jar.headerFor('https://instructure.com/'), 'log_session_id=L');
  assert.equal(jar.headerFor('https://inst-fs-iad-prod.inscloudgate.net/files/1'), '');
  assert.equal(jar.headerFor('https://evilinstructure.com/'), '');
});

test('expired cookies are not sent', () => {
  const jar = new CookieJar([c({ expires: 1000 }), c({ name: 'live', value: 'y', expires: future })]);
  assert.equal(jar.headerFor('https://smc.instructure.com/'), 'live=y');
});

test('secure cookies are not sent over plain http; path must prefix-match', () => {
  const jar = new CookieJar([c({}), c({ name: 'p', value: '1', secure: false, path: '/api' })]);
  assert.equal(jar.headerFor('http://smc.instructure.com/api/v1/x'), 'p=1');
  assert.equal(jar.headerFor('https://smc.instructure.com/courses/1'), 'canvas_session=v');
});

test('Set-Cookie replaces an existing value and marks the jar changed', () => {
  const jar = new CookieJar([c({})]);
  assert.equal(jar.changed, false);
  jar.setFromResponse('https://smc.instructure.com/api/v1/courses', ['canvas_session=new; path=/; secure; HttpOnly']);
  assert.equal(jar.changed, true);
  assert.equal(jar.headerFor('https://smc.instructure.com/'), 'canvas_session=new');
  assert.equal(jar.all().length, 1);
});

test('identical Set-Cookie leaves the jar unchanged', () => {
  const jar = new CookieJar([c({})]);
  jar.setFromResponse('https://smc.instructure.com/', ['canvas_session=v; path=/; secure; HttpOnly']);
  assert.equal(jar.changed, false);
});

test('Max-Age=0 and past Expires delete cookies', () => {
  const jar = new CookieJar([c({}), c({ name: 'b', value: '2' })]);
  jar.setFromResponse('https://smc.instructure.com/', [
    'canvas_session=; Max-Age=0; path=/',
    'b=; Expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/',
  ]);
  assert.equal(jar.headerFor('https://smc.instructure.com/'), '');
  assert.equal(jar.all().length, 0);
});

test('Domain attribute must match the responding host', () => {
  const jar = new CookieJar();
  jar.setFromResponse('https://smc.instructure.com/login', [
    'good=1; Domain=instructure.com; Path=/',
    'evil=1; Domain=example.com; Path=/',
  ]);
  assert.deepEqual(jar.all().map((x) => [x.name, x.domain]), [['good', '.instructure.com']]);
});

test('Max-Age and Expires set an absolute expiry', () => {
  const jar = new CookieJar();
  const before = Math.floor(Date.now() / 1000);
  jar.setFromResponse('https://smc.instructure.com/', ['a=1; Max-Age=60', 'b=2; Expires=Wed, 21 Oct 2099 07:28:00 GMT']);
  const [a, b] = jar.all();
  assert.ok(a.expires >= before + 59 && a.expires <= before + 61);
  assert.equal(b.expires, Date.parse('Wed, 21 Oct 2099 07:28:00 GMT') / 1000);
  assert.equal(a.domain, 'smc.instructure.com');
});
