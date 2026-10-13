import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskStatus, estimateMinutes, isExamLike } from '../src/reports/data.ts';
import type { ItemRow } from '../src/db/types.ts';

const NOW = new Date('2026-10-12T17:00:00Z'); // Mon 10:00 PDT
const past = '2026-10-10T06:59:00Z';
const future = '2026-10-14T06:59:00Z';

function row(p: Partial<ItemRow>): ItemRow {
  return {
    id: 'x', school_id: 's', course_id: 'c', kind: 'assignment', title: 'HW', due_at: future, end_at: null, unlock_at: null,
    lock_at: null, points: 10, html_url: null, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
    sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0,
    local_done: 0, source: 'api', module_id: null, first_seen_at: '', updated_at: '', removed: 0,
    group_id: null, category: null, category_source: null, syllabus_date: null, syllabus_note: null, syllabus_time_known: 0, user_note: null, ...p,
  };
}

test('taskStatus: done when submitted, graded, excused or ticked off anywhere', () => {
  assert.equal(taskStatus(row({ sub_state: 'submitted', due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ sub_state: 'graded' }), NOW), 'done');
  assert.equal(taskStatus(row({ sub_state: 'pending_review' }), NOW), 'done');
  assert.equal(taskStatus(row({ excused: 1, due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ canvas_done: 1, due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ local_done: 1, due_at: past }), NOW), 'done');
});

test('taskStatus: missing, overdue, todo', () => {
  assert.equal(taskStatus(row({ missing: 1, due_at: past }), NOW), 'missing');
  assert.equal(taskStatus(row({ due_at: past }), NOW), 'overdue');
  assert.equal(taskStatus(row({ due_at: future }), NOW), 'todo');
  assert.equal(taskStatus(row({ due_at: null }), NOW), 'todo');
  assert.equal(taskStatus(row({ kind: 'manual', provider: 'manual', source: 'manual', sub_state: null, submission_types: null, due_at: past }), NOW), 'overdue');
});

test('taskStatus: things that cannot be submitted online become past, not overdue', () => {
  assert.equal(taskStatus(row({ submission_types: '["on_paper"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ submission_types: '["none"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ kind: 'quiz', submission_types: '["not_graded"]', sub_state: null, due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ sub_state: 'unknown', source: 'ics', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ kind: 'note', submission_types: '["not_graded"]', sub_state: null, due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ provider: 'macmillan', submission_types: '["external_tool"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ provider: 'macmillan', submission_types: '["external_tool"]', due_at: past, missing: 1 }), NOW), 'missing');
});

test('taskStatus: calendar events are events', () => {
  assert.equal(taskStatus(row({ kind: 'event', sub_state: null, submission_types: null }), NOW), 'event');
});

test('estimateMinutes and isExamLike', () => {
  assert.equal(estimateMinutes(row({ kind: 'quiz' })), 45);
  assert.equal(estimateMinutes(row({ kind: 'discussion' })), 40);
  assert.equal(estimateMinutes(row({ points: 10 })), 45);
  assert.equal(estimateMinutes(row({ points: 50 })), 90);
  assert.equal(estimateMinutes(row({ points: 100 })), 150);
  assert.equal(estimateMinutes(row({ points: null })), 60);
  assert.equal(estimateMinutes(row({ kind: 'event' })), 0);
  assert.equal(estimateMinutes(row({ title: 'Midterm Exam 1', points: 100 })), 120);
  assert.ok(isExamLike('Midterm Exam'));
  assert.ok(isExamLike('Final'));
  assert.ok(isExamLike('Quiz 3'));
  assert.ok(isExamLike('期中考试'));
  assert.ok(!isExamLike('Homework 3'));
});

test('estimateMinutes follows the real category when known', () => {
  assert.equal(estimateMinutes(row({ category: 'exam', title: 'Knowledge Check 1', points: 100 })), 120);
  assert.equal(estimateMinutes(row({ category: 'lab', title: 'Exp #24' })), 120);
  assert.equal(estimateMinutes(row({ category: 'project', title: 'Research Paper' })), 150);
  assert.equal(estimateMinutes(row({ category: 'reading', title: '15.2 The Rate of a Chemical Reaction', points: 2 })), 25);
  assert.equal(estimateMinutes(row({ category: 'survey', title: 'Getting to Know You Survey' })), 10);
  assert.equal(estimateMinutes(row({ category: 'homework', kind: 'quiz', title: 'Chapter 15 Homework', points: 102 })), 150);
});

test('isExamLike also trusts the category', () => {
  assert.ok(isExamLike('Knowledge Check 1', 'exam'));
  assert.ok(!isExamLike('Chapter 15 Homework', 'homework'));
});

// ---- computeDaily / computeWeekly on a real database ----
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool, updateSchool } from '../src/db/schools.ts';
import { upsertCourse, updateCourseUser, setCourseWeek1 } from '../src/db/courses.ts';
import { upsertItem, setLocalDone, setItemCategory } from '../src/db/items.ts';
import type { ItemUpsert } from '../src/db/items.ts';
import { upsertTopic } from '../src/db/content.ts';
import { replaceWeeks, upsertGuide } from '../src/db/study.ts';
import { saveReport } from '../src/db/reports.ts';
import { addChange } from '../src/db/changes.ts';
import { run } from '../src/db/sql.ts';
import { computeDaily, computeWeekly } from '../src/reports/data.ts';

function world() {
  tmpDataDir();
  const db: DB = openDb();
  const school = createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  const course = (canvasId: string, code: string) => {
    const id = `${school.id}:${canvasId}`;
    upsertCourse(db, {
      id, school_id: school.id, canvas_id: canvasId, name: `${code} Course`, code, term_name: 'Fall 2026', start_at: null, end_at: null,
      html_url: `${school.base_url}/courses/${canvasId}`, syllabus_html: null, tabs: null, current_score: null, current_grade: null,
      active: 1, updated_at: new Date().toISOString(),
    });
    return id;
  };
  const bio = course('101', 'BIO 3');
  const art = course('102', 'ART 1');
  updateCourseUser(db, art, { hidden: true });
  const add = (id: string, patch: Partial<ItemUpsert> = {}) => {
    upsertItem(db, {
      id, school_id: school.id, course_id: bio, kind: 'assignment', title: id, due_at: null, end_at: null, unlock_at: null, lock_at: null,
      points: 10, html_url: `https://alpha/${id}`, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
      sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0,
      source: 'api', module_id: null, group_id: null, ...patch,
    });
    return id;
  };
  return { db, school, bio, art, add };
}
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

test('computeDaily groups by local day, right after the DST change, and leaves out done work and hidden courses', () => {
  const { db, school, bio, art, add } = world();
  const now = new Date('2026-11-01T16:00:00Z'); // Sun Nov 1, 08:00 PST (clocks went back at 02:00)
  add('tonight', { due_at: '2026-11-02T07:59:00Z' }); // Sun 23:59 PST
  add('tomorrow', { due_at: '2026-11-03T07:59:00Z' }); // Mon 23:59
  add('wed', { due_at: '2026-11-05T07:59:00Z', points: 100 }); // Wed 23:59 — still within 3 days
  add('thu', { due_at: '2026-11-06T07:59:00Z' }); // next week: neither group
  add('submitted', { due_at: '2026-11-02T07:59:00Z', sub_state: 'submitted' });
  setLocalDone(db, add('ticked', { due_at: '2026-11-03T07:59:00Z' }), true);
  add('late', { due_at: '2026-10-30T06:59:00Z' });
  add('missing', { due_at: '2026-10-25T06:59:00Z', missing: 1 });
  add('ancient', { due_at: '2026-09-01T06:59:00Z' }); // more than 30 days ago
  add('hidden', { due_at: '2026-11-02T07:59:00Z', course_id: art });
  add('lecture', { kind: 'event', due_at: '2026-11-01T18:00:00Z', submission_types: null });
  setItemCategory(db, add('kc', { kind: 'quiz', title: 'Knowledge Check 2', due_at: '2026-11-10T08:00:00Z' }), 'exam', 'auto');

  const d = computeDaily(db, now);
  assert.equal(d.date, '2026-11-01');
  assert.deepEqual(ids(d.dueToday), ['tonight']);
  assert.deepEqual(ids(d.next3Days), ['tomorrow', 'wed']);
  assert.deepEqual(ids(d.laterThisWeek), [], 'Sunday: nothing is left of this week');
  assert.deepEqual(ids(d.overdue), ['late', 'missing']);
  assert.deepEqual(ids(d.eventsToday), ['lecture']);
  assert.deepEqual(ids(d.examsSoon), ['kc']);
  assert.equal(d.totals.todo, 5);
  assert.equal(d.totals.minutes, [...d.overdue, ...d.dueToday, ...d.next3Days].reduce((n, t) => n + t.estMinutes, 0));
  assert.ok(d.totals.minutes > 0);

  const monday = computeDaily(db, new Date('2026-10-26T16:00:00Z')); // Mon Oct 26, 09:00 PDT
  assert.deepEqual(ids(monday.laterThisWeek), ['tonight'], 'Sun Nov 1 is later this week');
  assert.ok(monday.next3Days.some((t) => t.id === 'late'), 'Thu Oct 29 23:59 PDT is within 3 days');
  void school;
});

test('computeDaily reports what changed since the previous day\'s report, plus logins and this week\'s study focus', () => {
  const { db, school, bio, art, add } = world();
  const now = new Date('2026-11-01T16:00:00Z');
  saveReport(db, { type: 'daily', period: '2026-10-31', content: '{}' });
  saveReport(db, { type: 'daily', period: '2026-11-01', content: '{}' }); // an earlier run today must not move "since"
  run(db, "UPDATE reports SET created_at = CASE period WHEN '2026-10-31' THEN '2026-10-31T14:00:00.000Z' ELSE '2026-11-01T15:00:00.000Z' END");
  const topic = (id: string, course: string, posted: string) => upsertTopic(db, {
    id, course_id: course, kind: 'announcement', title: id, message_html: '<p>hi</p>', posted_at: posted, author: null,
    html_url: `https://alpha/${id}`, reply_count: 0, unread_count: 0, assignment_item_id: null,
  });
  topic('new-ann', bio, '2026-11-01T02:00:00Z');
  topic('old-ann', bio, '2026-10-30T00:00:00Z');
  topic('hidden-ann', art, '2026-11-01T03:00:00Z');
  add('hw5', { due_at: '2026-11-04T07:59:00Z', score: 9 });
  addChange(db, { school_id: school.id, course_id: bio, kind: 'graded', ref_id: 'hw5', summary: '成绩已公布：hw5', data: JSON.stringify({ score: 9, points: 10 }) });
  addChange(db, { school_id: school.id, course_id: bio, kind: 'due_changed', ref_id: 'hw5', summary: '截止时间变化：hw5', data: JSON.stringify({ from: '2026-11-06T07:59:00Z', to: '2026-11-04T07:59:00Z' }) });
  addChange(db, { school_id: school.id, course_id: bio, kind: 'graded', ref_id: 'hw5', summary: 'old', data: JSON.stringify({ score: 1, points: 10 }) });
  run(db, "UPDATE changes SET created_at = CASE summary WHEN 'old' THEN '2026-10-20T00:00:00.000Z' ELSE '2026-11-01T10:00:00.000Z' END");
  updateSchool(db, school.id, { status: 'needs_login' });
  setCourseWeek1(db, bio, '2026-08-31');
  replaceWeeks(db, bio, [{ course_id: bio, week: 9, start_date: '2026-10-26', title: 'Week 9', topics: '["Electrochemistry"]', source: 'module' }]);
  upsertGuide(db, { course_id: bio, week: 9, status: 'ready', content: JSON.stringify({ overview: '本周讲电化学。' }) });

  const d = computeDaily(db, now);
  assert.deepEqual(d.announcements.map((a) => a.title), ['new-ann']);
  assert.equal(d.announcements[0].courseName, 'BIO 3');
  assert.deepEqual(d.grades, [{ itemId: 'hw5', title: 'hw5', courseName: 'BIO 3', score: 9, points: 10 }]);
  assert.deepEqual(d.dueChanges, [{ itemId: 'hw5', title: 'hw5', courseName: 'BIO 3', from: '2026-11-06T07:59:00Z', to: '2026-11-04T07:59:00Z' }]);
  assert.deepEqual(d.loginNeeded, [{ schoolId: school.id, name: 'Alpha' }]);
  assert.deepEqual(d.studyFocus, [{ courseId: bio, courseName: 'BIO 3', week: 9, overview: '本周讲电化学。', status: 'ready' }]);

  run(db, 'DELETE FROM reports');
  const first = computeDaily(db, now); // no earlier report: the last 24 hours
  assert.deepEqual(first.announcements.map((a) => a.title), ['new-ann']);
});

test('computeWeekly looks at next week on Sundays, the current week otherwise, with 7 days across the DST change', () => {
  const { db, bio, add } = world();
  const sunday = computeWeekly(db, new Date('2026-11-01T16:00:00Z'));
  assert.equal(sunday.weekStart, '2026-11-02');
  assert.equal(sunday.weekEnd, '2026-11-08');

  add('fri-big', { due_at: '2026-10-31T06:59:00Z', points: 150 }); // Fri Oct 30 23:59 PDT
  add('fri-big2', { due_at: '2026-10-31T05:00:00Z', points: 100 }); // Fri 22:00 → Friday = 300 min, Thu (exam 120 + hw 45) = 165
  add('sat-small', { due_at: '2026-11-01T06:59:00Z', points: 10 }); // Sat Oct 31 23:59 PDT
  add('sun-pst', { due_at: '2026-11-02T07:59:00Z', points: 10 }); // Sun Nov 1 23:59 PST
  add('done', { due_at: '2026-10-30T06:59:00Z', sub_state: 'graded', points: 500 });
  setItemCategory(db, add('kc', { kind: 'quiz', title: 'Knowledge Check 2', due_at: '2026-10-29T17:00:00Z' }), 'exam', 'auto'); // Thu 10:00 PDT
  setItemCategory(db, add('ch18', { kind: 'quiz', title: 'Chapter 18 Homework', due_at: '2026-10-30T06:59:00Z' }), 'homework', 'auto'); // Thu 23:59 PDT
  add('midterm', { kind: 'event', title: 'Midterm 1', due_at: '2026-10-28T17:00:00Z', submission_types: null });
  // last week (Oct 19–25)
  add('ontime', { due_at: '2026-10-21T06:59:00Z', sub_state: 'graded' });
  add('lateone', { due_at: '2026-10-22T06:59:00Z', sub_state: 'submitted', late: 1 });
  add('missed', { due_at: '2026-10-23T06:59:00Z', missing: 1 });
  add('skipped', { due_at: '2026-10-24T06:59:00Z' }); // overdue, never submitted

  const w = computeWeekly(db, new Date('2026-10-28T17:00:00Z')); // Wed Oct 28
  assert.equal(w.weekStart, '2026-10-26');
  assert.equal(w.weekEnd, '2026-11-01');
  assert.deepEqual(w.next.days.map((d) => d.date), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  const day = (date: string) => ids(w.next.days.find((d) => d.date === date)!.items);
  assert.deepEqual(day('2026-10-30'), ['fri-big', 'fri-big2'], 'done work is left out');
  assert.equal(w.next.days.find((d) => d.date === '2026-10-29')!.minutes, 165);
  assert.deepEqual(day('2026-10-31'), ['sat-small']);
  assert.deepEqual(day('2026-11-01'), ['sun-pst']);
  assert.equal(w.busiest, '2026-10-30');
  assert.deepEqual(ids(w.next.exams), ['kc', 'midterm'], 'quiz-shaped homework is not an exam');
  assert.equal(w.last.onTime, 1);
  assert.equal(w.last.late, 1);
  assert.equal(w.last.missing, 2);
  void bio;
});

test('computeWeekly lists next week\'s topics per course, with the guide overview when there is one', () => {
  const { db, bio, art } = world();
  setCourseWeek1(db, bio, '2026-08-31');
  setCourseWeek1(db, art, '2026-08-31');
  replaceWeeks(db, bio, [
    { course_id: bio, week: 10, start_date: '2026-11-02', title: 'Chapter 20', topics: '["Electrochemistry"]', source: 'module' },
    { course_id: bio, week: 11, start_date: '2026-11-09', title: 'Chapter 21', topics: '[]', source: 'module' },
  ]);
  replaceWeeks(db, art, [{ course_id: art, week: 10, start_date: '2026-11-02', title: null, topics: '[]', source: 'calendar' }]);
  updateCourseUser(db, art, { hidden: false }); // visible, but nothing is known about its week 10
  const w = computeWeekly(db, new Date('2026-11-01T16:00:00Z'));
  assert.deepEqual(w.next.topics, [{ courseId: bio, courseName: 'BIO 3', week: 10, title: 'Chapter 20', topics: ['Electrochemistry'], overview: null }]);
  upsertGuide(db, { course_id: bio, week: 10, status: 'ready', content: JSON.stringify({ overview: '电化学入门' }) });
  assert.equal(computeWeekly(db, new Date('2026-11-01T16:00:00Z')).next.topics[0].overview, '电化学入门');
  assert.equal(w.busiest, null, 'nothing due → no busiest day');
});
