import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { getJob } from '../src/db/runs.ts';
import { DEFAULT_SETTINGS } from '../src/db/settings.ts';
import { parseHHMM, lastSlotAtOrBefore, isSlotDue, isIntervalDue, createScheduler } from '../src/scheduler.ts';
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
