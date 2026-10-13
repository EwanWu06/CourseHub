import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examCountdown, examScope, examUrgency, homeworkDays } from '../web/src/lib/today.ts';
import type { TaskView } from '../web/src/types.ts';

const NOW = new Date('2026-10-12T22:00:00-07:00'); // Mon 22:00 PDT

function t(id: string, dueAt: string, p: Partial<TaskView> = {}): TaskView {
  return {
    id, title: id, kind: 'assignment', provider: 'canvas', courseId: 'c', courseName: 'BIO 3', schoolId: 's', schoolName: 'S', color: '#00f',
    dueAt, htmlUrl: null, points: 10, status: 'todo', estMinutes: 45, source: 'api', localDone: false, category: 'homework',
    categorySource: 'group', syllabusNote: null, dueFromSyllabus: false, dueDateOnly: false, note: null, ...p,
  };
}

test('exam countdowns read like people talk', () => {
  assert.equal(examCountdown('2026-10-13T06:59:00Z', NOW), '今天'); // Mon 23:59 PDT
  assert.equal(examCountdown('2026-10-14T06:59:00Z', NOW), '明天');
  assert.equal(examCountdown('2026-10-14T01:30:00Z', NOW), '明天', 'Tue 18:30 PDT is tomorrow');
  assert.equal(examCountdown('2026-10-14T20:00:00Z', NOW), '后天', 'Wed 13:00 PDT');
  assert.equal(examCountdown('2026-10-21T01:30:00Z', NOW), '8 天后');
});

test('the scope of an exam is taken from its syllabus note', () => {
  assert.equal(examScope('日期来自大纲「Knowledge Check 2, covering Chapters 17–18」 · 范围：Chapters 17–18'), 'Chapters 17–18');
  assert.equal(examScope('日期来自大纲「Midterm 1 (100 Points)」'), null);
  assert.equal(examScope(null), null);
});

test('exams get louder as they get closer', () => {
  assert.equal(examUrgency('2026-10-14T06:59:00Z', NOW), 'hot');
  assert.equal(examUrgency('2026-10-19T01:30:00Z', NOW), 'soon');
  assert.equal(examUrgency('2026-11-11T02:30:00Z', NOW), 'later');
});

test('homework is grouped by local day with its workload; finished work is set aside', () => {
  const r = homeworkDays([
    t('a', '2026-10-16T06:59:00Z', { estMinutes: 30 }), // Thu 10/15
    t('b', '2026-10-17T06:59:00Z'), // Fri 10/16
    t('c', '2026-10-16T02:00:00Z', { estMinutes: 60 }), // Thu 10/15 19:00
    t('done', '2026-10-16T06:59:00Z', { status: 'done' }),
    t('late', '2026-10-10T06:59:00Z', { status: 'overdue' }),
  ], NOW);
  assert.deepEqual(r.overdue.map((x) => x.id), ['late']);
  assert.deepEqual(r.days.map((d) => [d.label, d.tasks.map((x) => x.id), d.minutes]), [['周四 10/15', ['c', 'a'], 90], ['周五 10/16', ['b'], 45]]);
  assert.deepEqual(r.done.map((x) => x.id), ['done']);
});

test('the header counts come from the same work list (exams counted on their own)', async () => {
  const { homeworkCounts } = await import('../web/src/lib/today.ts');
  const c = homeworkCounts([
    t('late', '2026-10-10T06:59:00Z', { status: 'missing' }),
    t('tonight', '2026-10-13T06:59:00Z'), // Mon 23:59 — today
    t('tue', '2026-10-14T06:59:00Z'),
    t('thu', '2026-10-16T06:59:00Z'), // Thu 10/15 — within 3 days
    t('fri', '2026-10-17T06:59:00Z'), // Fri 10/16 — day 4
    t('done', '2026-10-14T06:59:00Z', { status: 'done' }),
  ], NOW);
  assert.deepEqual(c, { overdue: 1, today: 1, next3: 2 });
});

test('three or more same-kind items from one course due together fold into one row', async () => {
  const { bundleTasks } = await import('../web/src/lib/today.ts');
  const due = '2026-10-19T06:59:00Z';
  const videos = ['18.8', '19.2', '19.3'].map((n) => t(n, due, { category: 'reading', courseId: 'chem', estMinutes: 25 }));
  const out = bundleTasks([
    videos[0], t('hw18', due, { courseId: 'chem' }), videos[1], videos[2],
    t('e1', due, { category: 'reading', courseId: 'engl' }), t('e2', due, { category: 'reading', courseId: 'engl' }),
  ]);
  assert.deepEqual(out.map((x) => ('bundle' in x ? `bundle:${x.bundle.map((y) => y.id).join(',')}` : x.task.id)), ['bundle:18.8,19.2,19.3', 'hw18', 'e1', 'e2']);
  const b = out[0] as { bundle: { id: string }[]; minutes: number };
  assert.equal(b.minutes, 75);
});
