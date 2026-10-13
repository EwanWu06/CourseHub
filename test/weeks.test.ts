import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getCourse } from '../src/db/courses.ts';
import { getItem } from '../src/db/items.ts';
import { listModules, setModuleWeek } from '../src/db/content.ts';
import { listWeeks } from '../src/db/study.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { parseWeekRange, inferWeek1, weekOf, assignModuleWeeks } from '../src/weeks/infer.ts';
import { rebuildWeeks, currentWeek, lastWeek } from '../src/weeks/build.ts';
import { mondayOf } from '../src/util/time.ts';

test('parseWeekRange understands common module naming', () => {
  assert.deepEqual(parseWeekRange('Week 3: Cells'), { start: 3, end: 3 });
  assert.deepEqual(parseWeekRange('Wk3 readings'), { start: 3, end: 3 });
  assert.deepEqual(parseWeekRange('WEEK 03:'), { start: 3, end: 3 });
  assert.deepEqual(parseWeekRange('Weeks 3-4: Genetics'), { start: 3, end: 4 });
  assert.deepEqual(parseWeekRange('Week 3 & 4'), { start: 3, end: 4 });
  assert.deepEqual(parseWeekRange('第3周 细胞'), { start: 3, end: 3 });
  assert.deepEqual(parseWeekRange('第 3-4 周'), { start: 3, end: 4 });
  assert.deepEqual(parseWeekRange('W3 – Photosynthesis'), { start: 3, end: 3 });
  assert.equal(parseWeekRange('Module 3: Limits'), null);
  assert.equal(parseWeekRange('Chapter 3'), null);
  assert.equal(parseWeekRange('Week of Oct 5'), null);
  assert.equal(parseWeekRange('Week 99'), null);
});

test('inferWeek1 picks the Monday of the course start, else term start, else earliest date', () => {
  assert.equal(inferWeek1({ courseStart: '2026-08-26T07:00:00Z', termStart: '2026-08-10T07:00:00Z', dates: [] }), '2026-08-24');
  assert.equal(inferWeek1({ courseStart: null, termStart: '2026-08-12T07:00:00Z', dates: [] }), '2026-08-10');
  assert.equal(inferWeek1({ courseStart: null, termStart: null, dates: ['2026-09-10T06:59:00Z', '2026-09-02T06:59:00Z'] }), '2026-08-31');
  assert.equal(inferWeek1({ courseStart: null, termStart: null, dates: [] }), null);
});

test('a course that starts on a weekend begins with the following Monday', () => {
  assert.equal(inferWeek1({ courseStart: '2026-09-20T07:00:00Z', termStart: null, dates: [] }), '2026-09-21'); // Sun Sep 20 00:00 PDT
  assert.equal(inferWeek1({ courseStart: '2026-09-19T07:00:00Z', termStart: null, dates: [] }), '2026-09-21'); // Sat
  assert.equal(inferWeek1({ courseStart: null, termStart: null, dates: ['2026-09-20T06:59:00Z'] }), '2026-09-14'); // a Saturday due date stays in its week
});

test('weekOf counts weeks in local time, including across DST', () => {
  assert.equal(weekOf('2026-08-24', '2026-10-12T06:00:00Z'), 7); // Sun Oct 11, 23:00 PDT
  assert.equal(weekOf('2026-08-24', '2026-10-13T06:00:00Z'), 8); // Mon Oct 12, 23:00 PDT
  assert.equal(weekOf('2026-10-26', '2026-11-02T08:30:00Z'), 2); // Mon Nov 2, 00:30 PST
  assert.equal(weekOf('2026-10-26', '2026-10-20T12:00:00Z'), 0);
});

test('assignModuleWeeks uses name, then unlock date, then due dates, else none', () => {
  const w = assignModuleWeeks([
    { id: 'n', name: 'Week 2: Chem', unlockAt: '2026-10-01T07:00:00Z', dueDates: [] },
    { id: 'u', name: 'Unit A', unlockAt: '2026-09-08T07:00:00Z', dueDates: [] },
    { id: 'd', name: 'Module 4', unlockAt: null, dueDates: ['2026-09-15T06:59:00Z', '2026-09-17T06:59:00Z', '2026-12-01T07:59:00Z'] },
    { id: 's', name: 'Module 5', unlockAt: null, dueDates: ['2026-09-25T06:59:00Z', '2026-10-02T06:59:00Z'] },
    { id: 'x', name: 'Start Here', unlockAt: null, dueDates: [] },
  ], '2026-08-24');
  assert.deepEqual(w.get('n'), { start: 2, end: 2, source: 'name' });
  assert.deepEqual(w.get('u'), { start: 3, end: 3, source: 'unlock' });
  assert.deepEqual(w.get('d'), { start: 4, end: 4, source: 'due' });
  assert.deepEqual(w.get('s'), { start: 5, end: 6, source: 'due' });
  assert.deepEqual(w.get('x'), { start: null, end: null, source: 'none' });
  assert.deepEqual(assignModuleWeeks([{ id: 'u', name: 'Unit A', unlockAt: '2026-09-08T07:00:00Z', dueDates: [] }], null).get('u'), { start: null, end: null, source: 'none' });
});

async function syncedSchool(variant: 'alpha' | 'beta') {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant });
  const school = createSchool(db, { name: variant, base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  await syncSchool(db, school.id, { reason: 'test', relogin: null });
  return { db, mock, s: school.id };
}

test('sync builds the week table for a course with week-named modules', async () => {
  const { db, mock, s } = await syncedSchool('alpha');
  try {
    const bio = getCourse(db, `${s}:101`)!;
    assert.equal(bio.week1, mondayOf(bio.start_at!));
    assert.equal(currentWeek(db, bio.id, new Date()), 6);
    assert.equal(lastWeek(db, bio.id), 16);
    const weeks = listWeeks(db, bio.id);
    assert.equal(weeks.length, 16);
    assert.equal(weeks[5].title, 'Week 6: Cell Respiration');
    const week6 = listModules(db, bio.id).find((m) => m.name.startsWith('Week 6'))!;
    assert.deepEqual([week6.week_start, week6.week_end, week6.week_source], [6, 6, 'name']);
    assert.equal(currentWeek(db, `${s}:103`, new Date()), 2);
  } finally {
    await mock.close();
  }
});

test('course without dates or week names: weeks come from due dates; undated modules stay unassigned', async () => {
  const { db, mock, s } = await syncedSchool('beta');
  try {
    const psych = getCourse(db, `${s}:201`)!;
    assert.ok(psych.week1);
    const mods = listModules(db, psych.id);
    const m4 = mods.find((m) => m.name.startsWith('Module 4'))!;
    const quizDue = getItem(db, `${s}:a:8001`)!.due_at!;
    assert.equal(m4.week_source, 'due');
    assert.equal(m4.week_start, weekOf(psych.week1!, quizDue));
    const start = mods.find((m) => m.name === 'Getting Started')!;
    assert.deepEqual([start.week_start, start.week_source], [null, 'none']);
    assert.doesNotThrow(() => rebuildWeeks(db, psych.id));
  } finally {
    await mock.close();
  }
});

test('rebuildWeeks keeps AI (syllabus) module assignments and week topics', async () => {
  const { db, mock, s } = await syncedSchool('beta');
  try {
    const courseId = `${s}:201`;
    const start = listModules(db, courseId).find((m) => m.name === 'Getting Started')!;
    setModuleWeek(db, start.id, { week_start: 1, week_end: 1, week_source: 'syllabus' });
    db.prepare("UPDATE weeks SET topics = '[\"history\"]', source = 'syllabus' WHERE course_id = ? AND week = 1").run(courseId);
    rebuildWeeks(db, courseId);
    const again = listModules(db, courseId).find((m) => m.id === start.id)!;
    assert.deepEqual([again.week_start, again.week_source], [1, 'syllabus']);
    assert.equal(listWeeks(db, courseId)[0].topics, '["history"]');
  } finally {
    await mock.close();
  }
});
