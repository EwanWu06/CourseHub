import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByDay, sealFor, monthGrid, providerNote } from '../web/src/lib/tasks.ts';
import type { TaskView } from '../web/src/types.ts';

const NOW = new Date('2026-10-12T17:00:00Z'); // Mon 10:00 PDT
function t(id: string, dueAt: string | null, p: Partial<TaskView> = {}): TaskView {
  return { id, title: id, kind: 'assignment', provider: 'canvas', courseId: 'c', courseName: 'BIO 3', schoolId: 's', schoolName: 'S', color: '#00f', dueAt, htmlUrl: null, points: 10, status: 'todo', estMinutes: 45, source: 'api', localDone: false, ...p };
}

test('groupByDay orders local days and names today/tomorrow', () => {
  const groups = groupByDay([
    t('b', '2026-10-14T06:59:00Z'), // Tue 23:59 → tomorrow? no: Tue Oct 13 23:59 PDT
    t('a', '2026-10-13T06:59:00Z'), // Mon Oct 12 23:59 PDT → today
    t('c', '2026-11-02T07:59:00Z'), // Sun Nov 1 23:59 PST (after DST)
    t('d', '2026-11-01T08:30:00Z'), // Sun Nov 1 00:30 PDT? (01:30 PDT) → Nov 1 as well
    t('x', null),
  ], NOW);
  assert.deepEqual(groups.map((g) => g.key), ['2026-10-12', '2026-10-13', '2026-11-01']);
  assert.equal(groups[0].rel, '今天');
  assert.equal(groups[1].rel, '明天');
  assert.equal(groups[2].rel, '');
  assert.equal(groups[2].date, '11月1日 周日');
  assert.deepEqual(groups[2].tasks.map((x) => x.id), ['d', 'c']);
});

test('sealFor marks missing, overdue and due-within-24h work', () => {
  assert.equal(sealFor(t('m', '2026-10-10T06:59:00Z', { status: 'missing' }), NOW), '缺');
  assert.equal(sealFor(t('o', '2026-10-10T06:59:00Z', { status: 'overdue' }), NOW), '逾');
  assert.equal(sealFor(t('u', '2026-10-13T06:59:00Z'), NOW), '急');
  assert.equal(sealFor(t('l', '2026-10-15T06:59:00Z'), NOW), null);
  assert.equal(sealFor(t('d', '2026-10-13T06:59:00Z', { status: 'done' }), NOW), null);
  assert.equal(sealFor(t('e', '2026-10-13T06:59:00Z', { status: 'event', kind: 'event' }), NOW), null);
});

test('monthGrid is six Monday-first weeks', () => {
  const g = monthGrid(2026, 9); // October 2026
  assert.equal(g.length, 42);
  assert.equal(g[0].date, '2026-09-28');
  assert.equal(g[0].inMonth, false);
  assert.equal(g[3].date, '2026-10-01');
  assert.equal(g[3].inMonth, true);
  assert.equal(g[41].date, '2026-11-08');
});

test('providerNote reminds where publisher work really lives', () => {
  assert.equal(providerNote('macmillan'), 'Macmillan · 以 Achieve 为准');
  assert.equal(providerNote('webassign'), 'WebAssign · 以平台为准');
  assert.equal(providerNote('canvas'), null);
  assert.equal(providerNote('manual'), null);
});
