import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { startHttp, scratchDir } from './helpers.ts';
import { rotateLog } from '../src/util/log.ts';
import { writeFileAtomic } from '../src/util/fs.ts';
import { waitForNetwork } from '../src/util/network.ts';
import { probeInstance } from '../src/server/instance.ts';

const tmp = (p: string) => scratchDir(p);

test('the log is rotated when it grows too big, keeping three old files', () => {
  const dir = tmp('log-');
  const file = path.join(dir, 'app.log');
  for (const ch of ['a', 'b', 'c', 'd']) {
    writeFileSync(file, ch.repeat(2000));
    rotateLog(file, 1000, 3);
  }
  assert.deepEqual(readdirSync(dir).sort(), ['app.log.1', 'app.log.2', 'app.log.3']);
  assert.equal(readFileSync(`${file}.1`, 'utf8')[0], 'd');
  assert.equal(readFileSync(`${file}.3`, 'utf8')[0], 'b');
  writeFileSync(file, 'small');
  rotateLog(file, 1000, 3);
  assert.ok(existsSync(file), 'a small log stays put');
});

test('writeFileAtomic replaces a file in one step, with the requested permissions', () => {
  const dir = tmp('atomic-');
  const file = path.join(dir, 'auth.json');
  writeFileAtomic(file, '{"a":1}', 0o600);
  writeFileAtomic(file, '{"a":2}', 0o600);
  assert.equal(readFileSync(file, 'utf8'), '{"a":2}');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['auth.json'], 'no temp files left behind');
});

test('waitForNetwork waits until a school host resolves, up to a limit', async () => {
  let n = 0;
  const lookup = async () => {
    if (++n < 3) throw new Error('getaddrinfo ENOTFOUND');
    return { address: '1.2.3.4', family: 4 };
  };
  assert.equal(await waitForNetwork(['ilearn.laccd.edu'], { lookup, timeoutMs: 2000, stepMs: 1 }), true);
  assert.equal(n, 3);
  assert.equal(await waitForNetwork(['x.example'], { lookup: async () => { throw new Error('offline'); }, timeoutMs: 30, stepMs: 5 }), false);
  assert.equal(await waitForNetwork([], {}), true, 'nothing to wait for');
});

test('probeInstance tells our own server from a stranger and from a free port', async () => {
  const ours = await startHttp((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, app: 'course-hub' })); });
  const other = await startHttp((_req, res) => { res.writeHead(404); res.end('nope'); });
  const gone = await startHttp((_req, res) => res.end());
  await gone.close();
  try {
    assert.equal(await probeInstance(ours.url), 'ours');
    assert.equal(await probeInstance(other.url), 'other');
    assert.equal(await probeInstance(gone.url), 'free');
  } finally {
    await ours.close();
    await other.close();
  }
});
