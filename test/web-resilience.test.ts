// The web page survives a slow, restarting or updated server, and its own errors are reported, not lost.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startHttp, tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { createApp } from '../src/server/app.ts';
import { webBuildId } from '../src/server/routes/static.ts';
import { api, getConnection } from '../web/src/api.ts';
import { buildFromScriptSrc } from '../web/src/lib/build.ts';

test('a request the server never answers fails within its timeout and marks the connection down; an answer marks it up', async () => {
  const silent = await startHttp(() => { /* never answers */ });
  const fine = await startHttp((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"ok":true}');
  });
  try {
    const t = Date.now();
    await assert.rejects(api(`${silent.url}/api/overview`, { timeoutMs: 300 }), /没有响应/);
    assert.ok(Date.now() - t < 3000);
    assert.equal(getConnection(), 'down');
    assert.deepEqual(await api(`${fine.url}/api/health`), { ok: true });
    assert.equal(getConnection(), 'up');
  } finally {
    await silent.close();
    await fine.close();
  }
});

test('a server that is not there at all (restarting) also marks the connection down', async () => {
  const gone = await startHttp(() => {});
  const url = gone.url;
  await gone.close();
  await assert.rejects(api(`${url}/api/overview`, { timeoutMs: 1000 }), /连不上/);
  assert.equal(getConnection(), 'down');
});

test('the server tells which web build it serves; the page knows its own', () => {
  const dist = mkdtempSync(path.join(tmpdir(), 'dist-'));
  mkdirSync(path.join(dist, 'assets'));
  writeFileSync(path.join(dist, 'index.html'), '<!doctype html><script type="module" crossorigin src="/assets/index-AbC123_x.js"></script>');
  assert.equal(webBuildId(dist), 'index-AbC123_x');
  assert.equal(buildFromScriptSrc('http://127.0.0.1:4123/assets/index-AbC123_x.js'), 'index-AbC123_x');
  assert.equal(buildFromScriptSrc('/src/main.tsx'), null); // the dev server: no build to compare
  assert.equal(webBuildId(mkdtempSync(path.join(tmpdir(), 'nodist-'))), null);
});

test('errors in the web page are reported to the server and listed on the status page', async () => {
  tmpDataDir();
  const app = createApp(openDb());
  const post = (body: unknown, headers: Record<string, string> = { 'X-CourseHub': '1' }) => app.request('http://127.0.0.1:4123/api/client-error', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  assert.equal((await post({ message: 'x' }, {})).status, 403); // the usual guard
  assert.equal((await post({ message: "Cannot read properties of undefined (reading 'map')", path: '/study/a:1/3', stack: 'at StudyWeek' })).status, 204);
  const status = (await (await app.request('http://127.0.0.1:4123/api/status')).json()) as { clientErrors: { message: string; path: string }[] };
  assert.equal(status.clientErrors[0].path, '/study/a:1/3');
  assert.match(status.clientErrors[0].message, /reading 'map'/);
  const health = (await (await app.request('http://127.0.0.1:4123/api/health')).json()) as { build: string | null };
  assert.ok('build' in health);
});
