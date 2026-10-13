// Keeps a stuck Course Hub from staying stuck. launchd restarts a process that exits, but not one whose main
// thread is wedged (a runaway loop, a synchronous call that never returns). A tiny worker thread — it keeps
// running while the main thread is blocked — watches a heartbeat; after `hangMs` without one it writes a note
// and kills the process, and launchd starts a fresh one. The whole process frozen (the Mac asleep) shows up as
// the worker's own clock jumping, and is not a hang.
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import type { DB } from './db/index.ts';
import { recordNotice } from './db/notices.ts';

export interface WatchdogOptions { notePath: string; hangMs?: number; checkMs?: number }
export interface WatchdogNote { reason: 'hang'; stuckSeconds: number; at: string }

const WORKER = `
const { workerData } = require('node:worker_threads');
const { writeFileSync } = require('node:fs');
const { beat, hangMs, checkMs, notePath, pid } = workerData;
const view = new BigInt64Array(beat);
let last = Date.now();
let graceUntil = 0;
setInterval(() => {
  const now = Date.now();
  const gap = now - last;
  last = now;
  if (gap > checkMs * 4) { graceUntil = now + hangMs; return; } // frozen as a whole (asleep): let the main thread catch up
  if (now < graceUntil) return;
  const stuck = now - Number(Atomics.load(view, 0));
  if (stuck <= hangMs) return;
  try { writeFileSync(notePath, JSON.stringify({ reason: 'hang', stuckSeconds: Math.round(stuck / 100) / 10, at: new Date(now).toISOString() })); } catch {}
  process.kill(pid, 'SIGKILL');
}, checkMs);
`;

export function startWatchdog(opts: WatchdogOptions): { stop(): void } {
  const hangMs = opts.hangMs ?? 120_000;
  const checkMs = opts.checkMs ?? 5_000;
  const beat = new SharedArrayBuffer(8);
  const view = new BigInt64Array(beat);
  const tick = () => void Atomics.store(view, 0, BigInt(Date.now()));
  tick();
  const timer = setInterval(tick, checkMs);
  timer.unref();
  const worker = new Worker(WORKER, { eval: true, workerData: { beat, hangMs, checkMs, notePath: opts.notePath, pid: process.pid } });
  worker.unref();
  return {
    stop: () => {
      clearInterval(timer);
      void worker.terminate();
    },
  };
}

export interface Proc { pid: number; ppid: number; command: string }

export function listProcesses(): Proc[] {
  const out = execFileSync('/bin/ps', ['-axo', 'pid=,ppid=,command='], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return out.split('\n').flatMap((line) => {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    return m ? [{ pid: Number(m[1]), ppid: Number(m[2]), command: m[3] }] : [];
  });
}

/** Stops Chromes an earlier Course Hub started and left behind (parent gone → re-parented to launchd, pid 1). */
export function killOrphans(profileDirs: string[], deps: { list?: () => Proc[]; kill?: (pid: number) => void } = {}): number {
  const kill = deps.kill ?? ((pid: number) => {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  });
  let n = 0;
  for (const p of (deps.list ?? listProcesses)()) {
    if (p.ppid !== 1 || !/Google Chrome|Chromium|chrome-headless-shell/.test(p.command)) continue;
    if (!profileDirs.some((dir) => p.command.includes(`--user-data-dir=${dir}`))) continue;
    kill(p.pid);
    n++;
  }
  return n;
}

/** After a restart the watchdog caused: keep the reason in the notice history (no banner), once. */
export function consumeWatchdogNote(db: DB, notePath: string): boolean {
  let note: WatchdogNote;
  try {
    note = JSON.parse(readFileSync(notePath, 'utf8')) as WatchdogNote;
  } catch {
    return false;
  }
  rmSync(notePath, { force: true });
  const at = new Date(note.at);
  const when = `${at.getMonth() + 1}/${at.getDate()} ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  recordNotice(db, { kind: 'system', title: 'Course Hub 自动恢复', body: `${when} 后台程序卡住 ${Math.round(note.stuckSeconds)} 秒，已自动重启，数据不受影响。` });
  return true;
}
