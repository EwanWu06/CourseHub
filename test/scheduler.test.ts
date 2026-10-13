import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { getJob, setJob } from '../src/db/runs.ts';
import { DEFAULT_SETTINGS } from '../src/db/settings.ts';
import { saveReport } from '../src/db/reports.ts';
import { listBackups } from '../src/db/backup.ts';
import { parseHHMM, lastSlotAtOrBefore, isSlotDue, isIntervalDue, createScheduler, defaultJobs } from '../src/scheduler.ts';
import type { Job } from '../src/scheduler.ts';

const at = (iso: string) => new Date(iso);

test('parseHHMM', () => {
  assert.deepEqual(parseHHMM('07:05'), { hour: 7, minute: 5 });
});

test('daily and weekly slots look back to the most recent occurrence (local time)', () => {
  // 2026-10-12 is a Monday; 06:00 PDT = 13:00Z
  assert.equal(lastSlotAtOrBefore(at('2026-10-12T13:00:00Z'), { hour: 7, minute: 0 }).toISOString(), '2026-10-11T14:00:00.000Z');
  assert.equal(lastSlotAtOrBefore(at('2026-10-12T15:00:00Z'), { hour: 7, minute: 0 }).toISOString(), '2026-10-12T14:00:00.000Z');
  assert.equal(lastSlotAtOrBefore(at('2026-10-12T15:00:00Z'), { hour: 20, minute: 0, weekday: 0 }).toISOString(), '2026-10-12T03:00:00.000Z');
  // across the DST change: Sunday Nov 1 20:00 PST = 04:00Z Monday
  assert.equal(lastSlotAtOrBefore(at('2026-11-02T16:00:00Z'), { hour: 20, minute: 0, weekday: 0 }).toISOString(), '2026-11-02T04:00:00.000Z');
});

test('isSlotDue fires once per slot and catches up after sleep', () => {
  const slot = { hour: 7, minute: 0 };
  assert.equal(isSlotDue(at('2026-10-12T16:30:00Z'), null, slot), true); // never ran
  assert.equal(isSlotDue(at('2026-10-12T16:30:00Z'), at('2026-10-12T16:30:00Z'), slot), false);
  assert.equal(isSlotDue(at('2026-10-12T16:30:00Z'), at('2026-10-11T15:00:00Z'), slot), true); // asleep at 7:00, woke at 9:30
  assert.equal(isSlotDue(at('2026-10-12T13:59:00Z'), at('2026-10-11T15:00:00Z'), slot), false); // before today's 7:00
});

test('isIntervalDue respects the interval and the time window', () => {
  const day = { start: 7, end: 24 };
  assert.equal(isIntervalDue(at('2026-10-12T15:00:00Z'), null, 2, day), true); // 08:00
  assert.equal(isIntervalDue(at('2026-10-12T15:00:00Z'), at('2026-10-12T14:00:00Z'), 2, day), false);
  assert.equal(isIntervalDue(at('2026-10-12T16:01:00Z'), at('2026-10-12T14:00:00Z'), 2, day), true);
  assert.equal(isIntervalDue(at('2026-10-13T08:00:00Z'), null, 2, day), false); // 01:00 — outside the window
  assert.equal(isIntervalDue(at('2026-10-13T06:30:00Z'), at('2026-10-13T04:00:00Z'), 2, day), true); // 23:30 is inside
  assert.equal(isIntervalDue(at('2026-10-13T08:00:00Z'), at('2026-10-13T07:20:00Z'), 0.5, { start: 0, end: 24 }), true);
});

test('scheduler runs due jobs once, records results, and survives a failing job', async () => {
  tmpDataDir();
  const db = openDb();
  let now = at('2026-10-12T16:30:00Z');
  const ran: string[] = [];
  const jobs: Job[] = [
    { name: 'daily', isDue: (n, last) => isSlotDue(n, last, { hour: 7, minute: 0 }), run: async () => { ran.push('daily'); } },
    { name: 'broken', isDue: () => true, run: async () => { throw new Error('boom'); } },
    { name: 'pulse', isDue: (n, last) => isIntervalDue(n, last, 0.5, { start: 0, end: 24 }), run: async () => { ran.push('pulse'); } },
  ];
  const s = createScheduler(db, jobs, { clock: () => now, settings: () => DEFAULT_SETTINGS });
  await s.tick();
  assert.deepEqual(ran, ['daily', 'pulse']);
  assert.match(getJob(db, 'broken')!.last_error!, /boom/);
  assert.equal(getJob(db, 'daily')!.last_status, 'ok');
  now = at('2026-10-12T16:45:00Z');
  await s.tick();
  assert.deepEqual(ran, ['daily', 'pulse'], 'nothing due 15 minutes later');
  now = at('2026-10-12T17:05:00Z');
  await s.tick();
  assert.deepEqual(ran, ['daily', 'pulse', 'pulse']);
});

test('a tick never overlaps a still-running tick', async () => {
  tmpDataDir();
  const db = openDb();
  let runs = 0;
  let release: () => void = () => {};
  const jobs: Job[] = [{ name: 'slow', isDue: () => true, run: () => { runs++; return new Promise<void>((r) => { release = r; }); } }];
  const s = createScheduler(db, jobs, { clock: () => new Date(), settings: () => DEFAULT_SETTINGS });
  const first = s.tick();
  await s.tick();
  assert.equal(runs, 1);
  release();
  await first;
});

test('default jobs: after a night asleep the daily report syncs first and runs once, the weekly catches up, reminders keep going', async () => {
  tmpDataDir();
  const db = openDb();
  const calls: string[] = [];
  const jobs = defaultJobs(db, {
    runSync: async () => { calls.push('sync'); },
    onLoginNeeded: () => {},
    generateDaily: async () => { calls.push('daily'); },
    generateWeekly: async () => { calls.push('weekly'); },
    runReminders: async () => { calls.push('reminders'); },
    flushChanges: async () => { calls.push('changes'); },
  }).filter((j) => ['daily', 'weekly', 'sync', 'reminders'].includes(j.name));
  // last runs before the Mac went to sleep on Sunday Oct 11 at 18:00 PDT
  setJob(db, 'daily', { last_run_at: '2026-10-11T14:00:00.000Z', last_status: 'ok' }); // Sun 07:00
  setJob(db, 'weekly', { last_run_at: '2026-10-05T03:00:00.000Z', last_status: 'ok' }); // Sun Oct 4, 20:00
  setJob(db, 'sync', { last_run_at: '2026-10-12T00:00:00.000Z', last_status: 'ok' }); // Sun 17:00
  setJob(db, 'reminders', { last_run_at: '2026-10-12T00:55:00.000Z', last_status: 'ok' }); // Sun 17:55
  let now = at('2026-10-12T16:30:00Z'); // wakes Mon 09:30
  const s = createScheduler(db, jobs, { clock: () => now, settings: () => DEFAULT_SETTINGS });
  await s.tick();
  assert.deepEqual(calls, ['sync', 'changes', 'daily', 'weekly', 'reminders', 'changes']);
  now = at('2026-10-12T16:31:00Z');
  await s.tick();
  assert.equal(calls.length, 6, 'nothing again at 09:31 — the daily sync counts as the scheduled one');
  now = at('2026-10-12T16:46:00Z');
  await s.tick();
  assert.deepEqual(calls.slice(6), ['reminders', 'changes']);
  calls.length = 0;
  now = at('2026-10-13T08:00:00Z'); // Tue 01:00: reminders yes, sync no
  await s.tick();
  assert.deepEqual(calls, ['reminders', 'changes']);
  now = at('2026-10-13T14:00:00Z'); // Tue 07:00
  await s.tick();
  assert.deepEqual(calls.slice(2), ['sync', 'changes', 'daily', 'reminders', 'changes']);
});

test('the scheduled sync alerts on changes and keeps guides queued', async () => {
  tmpDataDir();
  const db = openDb();
  const calls: string[] = [];
  const sync = defaultJobs(db, {
    runSync: async () => { calls.push('sync'); },
    onLoginNeeded: () => {},
    flushChanges: async () => { calls.push('changes'); },
  }).find((j) => j.name === 'sync')!;
  await sync.run(at('2026-10-12T17:00:00Z'));
  assert.deepEqual(calls, ['sync', 'changes']);
});

test('the schedule does not remake a report that already exists for its day or week', async () => {
  tmpDataDir();
  const db = openDb();
  saveReport(db, { type: 'daily', period: '2026-10-12', content: '{}' });
  saveReport(db, { type: 'weekly', period: '2026-10-12', content: '{}' });
  const calls: string[] = [];
  const jobs = defaultJobs(db, {
    runSync: async () => { calls.push('sync'); },
    onLoginNeeded: () => {},
    generateDaily: async () => { calls.push('daily'); },
    generateWeekly: async () => { calls.push('weekly'); },
    flushChanges: async () => {},
  }).filter((j) => j.name === 'daily' || j.name === 'weekly');
  const s = createScheduler(db, jobs, { clock: () => at('2026-10-13T03:30:00Z'), settings: () => DEFAULT_SETTINGS }); // Mon 20:30, never ran
  await s.tick();
  assert.deepEqual(calls, []);
  const sunday = createScheduler(db, jobs, { clock: () => at('2026-10-19T03:30:00Z'), settings: () => DEFAULT_SETTINGS }); // Sun Oct 18, 20:30
  await sunday.tick();
  assert.deepEqual(calls, ['sync', 'daily', 'weekly'], 'Sunday evening makes next week\'s report');
});

test('a job that hangs is cut off at its time limit; the rest of the tick and later ticks still run', { timeout: 5000 }, async () => {
  tmpDataDir();
  const db = openDb();
  const ran: string[] = [];
  const jobs: Job[] = [
    { name: 'stuck', timeoutMs: 50, isDue: () => true, run: () => new Promise<void>(() => {}) },
    { name: 'after', isDue: () => true, run: async () => { ran.push('after'); } },
  ];
  const s = createScheduler(db, jobs, { clock: () => new Date(), settings: () => DEFAULT_SETTINGS });
  await s.tick();
  assert.deepEqual(ran, ['after']);
  assert.equal(getJob(db, 'stuck')!.last_status, 'error');
  assert.match(getJob(db, 'stuck')!.last_error!, /超时/);
  await s.tick();
  assert.deepEqual(ran, ['after', 'after'], 'the scheduler is not wedged');
});

test('the backup job snapshots the database at 03:30, catching up after sleep', async () => {
  tmpDataDir();
  const db = openDb();
  const job = defaultJobs(db, { runSync: async () => {}, onLoginNeeded: () => {} }).find((j) => j.name === 'backup')!;
  assert.equal(job.isDue(at('2026-10-12T16:30:00Z'), at('2026-10-11T11:00:00Z'), DEFAULT_SETTINGS), true, 'Mac was asleep at 03:30');
  assert.equal(job.isDue(at('2026-10-12T16:30:00Z'), at('2026-10-12T10:31:00Z'), DEFAULT_SETTINGS), false);
  await job.run(at('2026-10-12T16:30:00Z'));
  assert.deepEqual(listBackups().map((b) => b.date), ['2026-10-12']);
});

test('a report-ai job tries every 15 minutes to fill in a missing AI part', async () => {
  tmpDataDir();
  const db = openDb();
  const calls: string[] = [];
  const job = defaultJobs(db, { runSync: async () => {}, onLoginNeeded: () => {}, fillMissingAi: async () => { calls.push('fill'); } }).find((j) => j.name === 'report-ai')!;
  assert.equal(job.isDue(at('2026-10-12T17:00:00Z'), at('2026-10-12T16:50:00Z'), DEFAULT_SETTINGS), false);
  assert.equal(job.isDue(at('2026-10-12T17:00:00Z'), at('2026-10-12T16:44:00Z'), DEFAULT_SETTINGS), true);
  await job.run(at('2026-10-12T17:00:00Z'));
  assert.deepEqual(calls, ['fill']);
});
