import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { killOrphans } from '../src/watchdog.ts';
import { scratchDir } from './helpers.ts';

const CHILD = path.join(import.meta.dirname, 'fixtures', 'watchdog-child.ts');

function runChild(mode: 'hang' | 'idle' | 'sleepy', onReady?: (pid: number) => void) {
  const note = path.join(scratchDir('wd-'), 'watchdog.json');
  const child = fork(CHILD, [mode, note], { execArgv: ['--disable-warning=ExperimentalWarning'], stdio: 'ignore' });
  child.on('message', () => onReady?.(child.pid!));
  const done = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  return { note, done, child };
}

test('a main thread stuck for longer than the limit is killed (so launchd restarts it) and leaves a note why', { timeout: 30_000 }, async () => {
  const { note, done } = runChild('hang');
  const { signal } = await done;
  assert.equal(signal, 'SIGKILL');
  const n = JSON.parse(readFileSync(note, 'utf8')) as { reason: string; stuckSeconds: number; at: string };
  assert.equal(n.reason, 'hang');
  assert.ok(n.stuckSeconds >= 1.5);
});

test('a healthy process is left alone', { timeout: 30_000 }, async () => {
  const { note, done } = runChild('idle');
  assert.deepEqual(await done, { code: 0, signal: null });
  assert.equal(existsSync(note), false);
});

test('the whole process frozen (the Mac asleep) is not a hang', { timeout: 30_000 }, async () => {
  const { note, done } = runChild('sleepy', (pid) => {
    setTimeout(() => process.kill(pid, 'SIGSTOP'), 500);
    setTimeout(() => process.kill(pid, 'SIGCONT'), 3500); // 3 s frozen, twice the hang limit
  });
  assert.deepEqual(await done, { code: 0, signal: null });
  assert.equal(existsSync(note), false);
});

test('Chromes left behind by an earlier Course Hub (orphaned, ours) are stopped; nobody else\'s', () => {
  const procs = [
    { pid: 101, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/u/CourseHub/data/browser-profile --remote-debugging-port=9333' },
    { pid: 102, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --user-data-dir=/Users/u/CourseHub/data/tmp/achieve-chrome' },
    { pid: 103, ppid: 1, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' }, // the user's own Chrome
    { pid: 104, ppid: 555, command: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/u/CourseHub/data/browser-profile' }, // a live login
    { pid: 105, ppid: 1, command: 'node /Users/u/remotion/render.js --user-data-dir=/tmp/remotion' },
    { pid: 106, ppid: 1, command: '/Users/u/CourseHub/data/tmp/achieve-chrome/helper --type=renderer' }, // not Chrome
  ];
  const killed: number[] = [];
  const n = killOrphans(['/Users/u/CourseHub/data/browser-profile', '/Users/u/CourseHub/data/tmp/achieve-chrome'], {
    list: () => procs, kill: (pid) => void killed.push(pid),
  });
  assert.equal(n, 2);
  assert.deepEqual(killed, [101, 102]);
});

test('after a watchdog restart the reason is kept in the notice history, once', async () => {
  const { tmpDataDir } = await import('./helpers.ts');
  const { openDb } = await import('../src/db/index.ts');
  const { listNotices } = await import('../src/db/notices.ts');
  const { consumeWatchdogNote } = await import('../src/watchdog.ts');
  const { writeFileSync } = await import('node:fs');
  tmpDataDir();
  const db = openDb();
  const note = path.join(scratchDir('wd-'), 'watchdog.json');
  writeFileSync(note, JSON.stringify({ reason: 'hang', stuckSeconds: 121.4, at: '2026-10-13T10:12:00.000Z' }));
  assert.equal(consumeWatchdogNote(db, note), true);
  const n = listNotices(db, 10)[0];
  assert.equal(n.kind, 'system');
  assert.match(n.body, /卡住 121 秒.*自动重启/);
  assert.equal(existsSync(note), false);
  assert.equal(consumeWatchdogNote(db, note), false);
});
