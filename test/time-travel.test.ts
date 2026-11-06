// Course Hub runs for years: the days that break date code — both DST changes, New Year, a leap day, the end
// of a term — are pinned here (TZ=America/Los_Angeles, as on the user's Mac).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { upsertCourse } from '../src/db/courses.ts';
import { listItems, upsertItem, upsertSyllabusExam } from '../src/db/items.ts';
import { run } from '../src/db/sql.ts';
import { addDays, atLocal, daysBetween, localDateStr, mondayOf } from '../src/util/time.ts';
import { isSlotDue, lastSlotAtOrBefore } from '../src/scheduler.ts';
import { weekOf } from '../src/weeks/infer.ts';
import { weeklyPeriod } from '../src/reports/data.ts';
import { runReminders } from '../src/notify/reminders.ts';
import { examCountdown, homeworkDays } from '../web/src/lib/today.ts';
import type { TaskView } from '../web/src/types.ts';

test('calendar arithmetic holds across both DST changes, New Year and a leap day', () => {
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');
  assert.equal(addDays('2027-03-14', 1), '2027-03-15');
  assert.equal(daysBetween('2026-10-26', '2026-11-02'), 7);
  assert.equal(daysBetween('2027-03-08', '2027-03-15'), 7);
  assert.equal(mondayOf('2026-11-01'), '2026-10-26');
  assert.equal(mondayOf('2027-03-14'), '2027-03-08');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(mondayOf('2027-01-01'), '2026-12-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2028-02-29', 1), '2028-03-01');
  assert.equal(atLocal('2026-10-31', 7, 0).toISOString(), '2026-10-31T14:00:00.000Z'); // PDT
  assert.equal(atLocal('2026-11-01', 7, 0).toISOString(), '2026-11-01T15:00:00.000Z'); // PST
  assert.equal(atLocal('2027-03-14', 7, 0).toISOString(), '2027-03-14T14:00:00.000Z'); // PDT again
  assert.equal(localDateStr(new Date('2026-11-02T07:59:00Z')), '2026-11-01'); // 11:59 PM PST, still Sunday
});

test('daily and weekly jobs run once on a DST day, at the local hour', () => {
  const daily = { hour: 7, minute: 0 };
  const saturday = new Date('2026-10-31T14:00:00Z');
  assert.equal(isSlotDue(new Date('2026-11-01T14:59:00Z'), saturday, daily), false); // 6:59 PST
  assert.equal(isSlotDue(new Date('2026-11-01T15:00:00Z'), saturday, daily), true); // 7:00 PST
  assert.equal(isSlotDue(new Date('2026-11-02T07:59:00Z'), new Date('2026-11-01T15:00:05Z'), daily), false); // not again that 25-hour day
  assert.equal(lastSlotAtOrBefore(new Date('2027-03-14T20:00:00Z'), daily).toISOString(), '2027-03-14T14:00:00.000Z');
  assert.equal(lastSlotAtOrBefore(new Date('2027-03-14T12:00:00Z'), { hour: 3, minute: 0 }).toISOString(), '2027-03-14T10:00:00.000Z'); // 3:00 exists after 2:00 is skipped
  const sundayEvening = { weekday: 0, hour: 20, minute: 0 };
  assert.equal(lastSlotAtOrBefore(new Date('2026-11-02T20:00:00Z'), sundayEvening).toISOString(), '2026-11-02T04:00:00.000Z'); // Sun Nov 1 20:00 PST
  assert.equal(weeklyPeriod(new Date('2026-11-02T04:00:00Z')), '2026-11-02'); // run on Sunday evening: the coming week
});

test('countdowns and day groups count calendar days, even across a 23- or 25-hour day', () => {
  assert.equal(examCountdown('2027-03-16T01:30:00Z', new Date('2027-03-12T20:00:00Z')), '3 天后'); // Fri noon PST → Mon 6:30 PM PDT
  assert.equal(examCountdown('2027-03-15T16:00:00Z', new Date('2027-03-14T07:00:00Z')), '后天'); // Sat 11 PM PST → Mon 9 AM PDT
  assert.equal(examCountdown('2026-11-02T07:59:00Z', new Date('2026-11-01T06:00:00Z')), '明天'); // Sat 11 PM PDT → Sun 11:59 PM PST
  const t = (id: string, dueAt: string) => ({ id, dueAt, status: 'todo', estMinutes: 30 }) as unknown as TaskView;
  const { days } = homeworkDays([t('a', '2026-11-02T07:59:00Z'), t('b', '2026-11-02T08:00:00Z')], new Date('2026-10-31T19:00:00Z'));
  assert.deepEqual(days.map((d) => [d.label, d.tasks.map((x) => x.id)]), [['明天 11/1', ['a']], ['周一 11/2', ['b']]]); // Sun 11:59 PM PST vs Mon 0:00
});

test('weeks of the term stay Monday-aligned across DST and New Year', () => {
  assert.equal(weekOf('2026-09-21', '2026-11-02T07:59:00Z'), 6); // Sunday 11:59 PM PST: still week 6
  assert.equal(weekOf('2026-09-21', '2026-11-02T08:00:00Z'), 7); // Monday 0:00 PST
  assert.equal(weekOf('2026-12-28', '2027-01-03T12:00:00Z'), 1);
  assert.equal(weekOf('2026-12-28', '2027-01-04T12:00:00Z'), 2);
});

function world() {
  tmpDataDir();
  const db = openDb();
  const s = createSchool(db, { name: 'LACCD', base_url: 'https://ilearn.laccd.edu' });
  for (const [id, active] of [['1', 1], ['2', 0]] as const) {
    upsertCourse(db, {
      id: `${s.id}:${id}`, school_id: s.id, canvas_id: id, name: `CHEM 10${id}`, code: `CHEM 10${id}`, term_name: null, start_at: null, end_at: null,
      html_url: `https://ilearn.laccd.edu/courses/${id}`, syllabus_html: null, tabs: null, current_score: null, current_grade: null, active,
      updated_at: new Date().toISOString(),
    });
  }
  return { db, s: s.id };
}

test('an exam with only a date reminds from 6 PM the evening before — on the DST day too — and still after a closed lid', async () => {
  const { db, s } = world();
  // Knowledge Check on Monday Nov 2, time "see syllabus": stored as 11:59 PM that day
  upsertSyllabusExam(db, { id: `${s}:syl:kc3`, school_id: s, course_id: `${s}:1`, title: 'Knowledge Check 3', date: atLocal('2026-11-02', 23, 59).toISOString(), timeKnown: false, note: '', html_url: null });
  assert.equal(await runReminders(db, new Date('2026-11-02T01:59:00Z')), 0); // Sun 5:59 PM PST
  assert.equal(await runReminders(db, new Date('2026-11-02T02:00:00Z')), 1); // Sun 6:00 PM PST
  assert.equal(await runReminders(db, new Date('2026-11-02T03:00:00Z')), 0, 'once');
  run(db, 'DELETE FROM reminders_sent');
  assert.equal(await runReminders(db, new Date('2026-11-02T16:00:00Z')), 1, 'Mac asleep all evening: reminded on waking Monday morning');
});

test('when a term ends, its courses leave Today, the lists and the reminders', async () => {
  const { db, s } = world();
  const due = new Date(Date.now() + 5 * 3_600_000).toISOString();
  for (const course of ['1', '2']) {
    upsertItem(db, {
      id: `${s}:a:${course}00`, school_id: s, course_id: `${s}:${course}`, kind: 'assignment', title: `Homework of ${course}`, due_at: due, end_at: null,
      unlock_at: null, lock_at: null, points: 10, html_url: null, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
      sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0, source: 'api', module_id: null, group_id: null,
    });
  }
  assert.deepEqual(listItems(db, {}).map((r) => r.id), [`${s}:a:100`]); // CHEM 102 concluded (inactive)
  assert.equal(await runReminders(db, new Date()), 1);
});
