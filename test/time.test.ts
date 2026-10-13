import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localDateStr, mondayOf, addDays, daysBetween, atLocal, parseDateStr } from '../src/util/time.ts';

test('localDateStr uses the local (Los Angeles) calendar date', () => {
  assert.equal(localDateStr(new Date('2026-10-13T06:30:00Z')), '2026-10-12');
});

test('mondayOf returns the Monday of the same week for a date string', () => {
  assert.equal(mondayOf('2026-10-15'), '2026-10-12');
  assert.equal(mondayOf('2026-10-12'), '2026-10-12');
});

test('mondayOf treats Sunday as the last day of the week', () => {
  assert.equal(mondayOf('2026-10-18'), '2026-10-12');
});

test('mondayOf uses local time for Dates and ISO timestamps', () => {
  // 2026-10-19T06:00Z is Sunday 2026-10-18 23:00 PDT
  assert.equal(mondayOf(new Date('2026-10-19T06:00:00Z')), '2026-10-12');
  assert.equal(mondayOf('2026-10-19T06:00:00Z'), '2026-10-12');
});

test('addDays does calendar arithmetic across month and DST boundaries', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2026-03-08', -1), '2026-03-07');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
});

test('daysBetween counts calendar days across DST', () => {
  assert.equal(daysBetween('2026-10-26', '2026-11-02'), 7);
  assert.equal(daysBetween('2026-11-02', '2026-10-26'), -7);
});

test('atLocal builds PST wall-clock time after DST ends', () => {
  assert.equal(atLocal('2026-11-01', 23, 59).toISOString(), '2026-11-02T07:59:00.000Z');
});

test('atLocal builds PDT wall-clock time before DST ends', () => {
  assert.equal(atLocal('2026-10-31', 23, 59).toISOString(), '2026-11-01T06:59:00.000Z');
});

test('parseDateStr splits YYYY-MM-DD', () => {
  assert.deepEqual(parseDateStr('2026-01-05'), { y: 2026, m: 1, d: 5 });
});
