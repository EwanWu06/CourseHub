import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir } from './helpers.ts';
import { dataDir, paths, ensureDataDirs } from '../src/config.ts';
import { sha256 } from '../src/util/hash.ts';
import { log } from '../src/util/log.ts';

test('dataDir follows COURSEHUB_DATA_DIR at call time', () => {
  const dir = tmpDataDir();
  assert.equal(dataDir(), dir);
  assert.equal(paths().db, path.join(dir, 'coursehub.sqlite'));
});

test('ensureDataDirs creates every data folder and keeps auth private', () => {
  tmpDataDir();
  ensureDataDirs();
  const p = paths();
  for (const d of [p.text, p.tmp, p.auth, p.profile, p.logs, p.notify, p.aiWork]) assert.ok(existsSync(d), d);
  assert.equal(statSync(p.auth).mode & 0o777, 0o700);
});

test('sha256 returns the hex digest', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('log appends a JSON line to logs/app.log', () => {
  tmpDataDir();
  log('warn', 'hello', { a: 1 });
  const lines = readFileSync(path.join(paths().logs, 'app.log'), 'utf8').trim().split('\n');
  const last = JSON.parse(lines.at(-1)!);
  assert.equal(last.level, 'warn');
  assert.equal(last.msg, 'hello');
  assert.deepEqual(last.meta, { a: 1 });
});
