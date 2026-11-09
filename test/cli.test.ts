import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { upsertCourse } from '../src/db/courses.ts';
import { upsertItem } from '../src/db/items.ts';
import { replaceWeeks, upsertGuide } from '../src/db/study.ts';
import { main } from '../src/cli.ts';

let db: DB;
const COURSE = 'alpha:101';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => { out.push(s); }, err: (s: string) => { err.push(s); } }, out, err };
}

before(() => {
  tmpDataDir();
  db = openDb();
  const s = createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  upsertCourse(db, {
    id: COURSE, school_id: s.id, canvas_id: '101', name: 'BIO 3 - General Biology', code: 'BIO 3', term_name: null, start_at: null, end_at: null,
    html_url: 'https://alpha.instructure.com/courses/101', syllabus_html: null, tabs: null, current_score: null, current_grade: null, active: 1,
    updated_at: new Date().toISOString(),
  });
  const soon = new Date(Date.now() + 26 * 3_600_000).toISOString();
  const later = new Date(Date.now() + 10 * 86_400_000).toISOString();
  for (const [id, due] of [['hw', soon], ['essay', later]] as const) {
    upsertItem(db, {
      id, school_id: s.id, course_id: COURSE, kind: 'assignment', title: id.toUpperCase(), due_at: due, end_at: null, unlock_at: null, lock_at: null,
      points: 10, html_url: null, provider: 'canvas', description_html: null, submission_types: '["online_upload"]', sub_state: 'unsubmitted',
      submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0, source: 'api', module_id: null, group_id: null,
    });
  }
  replaceWeeks(db, COURSE, [{ course_id: COURSE, week: 6, start_date: '2026-10-05', title: 'Week 6', topics: '["Respiration"]', source: 'module' }]);
});

test('tasks --json --days 3 prints the coming work as JSON task views', async () => {
  const c = capture();
  assert.equal(await main(['tasks', '--json', '--days', '3'], c.io), 0);
  const tasks = JSON.parse(c.out.join('\n')) as { id: string; title: string; dueAt: string; status: string; courseName: string }[];
  assert.deepEqual(tasks.map((t) => t.id), ['hw']);
  assert.equal(tasks[0].status, 'todo');
  assert.equal(tasks[0].courseName, 'BIO 3');
});

test('tasks without --json is a readable list', async () => {
  const c = capture();
  assert.equal(await main(['tasks', '--days', '14'], c.io), 0);
  const text = c.out.join('\n');
  assert.match(text, /HW/);
  assert.match(text, /ESSAY/);
  assert.match(text, /BIO 3/);
});

test('study for a week without a guide says so', async () => {
  const c = capture();
  assert.equal(await main(['study', COURSE, '6'], c.io), 1);
  assert.match(c.out.join('\n') + c.err.join('\n'), /还没有生成/);
  upsertGuide(db, { course_id: COURSE, week: 6, status: 'ready', content: JSON.stringify({ overview: '本周讲细胞呼吸。', objectives: [], concepts: [{ term: 'Glycolysis', term_zh: '糖酵解', explanation: '…', example: '', pitfalls: '', sources: [] }], cheatsheet: '', assignments: [], self_test: [], study_plan: [], coverage: { level: 'full', note: '' } }) });
  const d = capture();
  assert.equal(await main(['study', COURSE, '6'], d.io), 0);
  assert.match(d.out.join('\n'), /本周讲细胞呼吸/);
  assert.match(d.out.join('\n'), /Glycolysis/);
});

test('courses --json lists visible courses', async () => {
  const c = capture();
  assert.equal(await main(['courses', '--json'], c.io), 0);
  assert.deepEqual((JSON.parse(c.out.join('\n')) as { id: string; displayName: string }[]).map((x) => [x.id, x.displayName]), [[COURSE, 'BIO 3']]);
});

test('an unknown command exits 2 with the usage', async () => {
  const c = capture();
  assert.equal(await main(['frobnicate'], c.io), 2);
  assert.match(c.err.join('\n'), /用法|usage/i);
  const h = capture();
  assert.equal(await main(['help'], h.io), 0);
  assert.match(h.out.join('\n'), /coursehub tasks/);
});
