import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appleScriptString, notify, setNotifier, loginNeededNotice } from '../src/notify/mac.ts';
import type { Notice } from '../src/notify/mac.ts';

test('appleScriptString escapes quotes and backslashes', () => {
  assert.equal(appleScriptString('He said "hi" \\ bye'), '"He said \\"hi\\" \\\\ bye"');
});

test('notifications go through the injected notifier, in order', async () => {
  const seen: Notice[] = [];
  setNotifier(async (n) => { seen.push(n); });
  await Promise.all([notify({ title: 'a', body: '1' }), notify({ title: 'b', body: '2' })]);
  assert.deepEqual(seen.map((n) => n.title), ['a', 'b']);
  setNotifier(null);
});

test('login-needed notice names the school and links to settings', () => {
  const n = loginNeededNotice({ name: 'LACCD' });
  assert.match(n.title, /LACCD/);
  assert.match(n.url!, /\/settings$/);
});

// ---- reminders and change alerts on a real database ----
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { upsertCourse, updateCourseUser } from '../src/db/courses.ts';
import { upsertItem, setLocalDone, upsertSyllabusExam } from '../src/db/items.ts';
import type { ItemUpsert } from '../src/db/items.ts';
import { upsertTopic } from '../src/db/content.ts';
import { addChange, pendingChanges } from '../src/db/changes.ts';
import { updateSettings } from '../src/db/settings.ts';
import { all } from '../src/db/sql.ts';
import { pendingText } from '../src/notify/mac.ts';
import { runReminders } from '../src/notify/reminders.ts';
import { flushChangeNotices } from '../src/notify/changes.ts';
import { replaceCourseLogic } from '../src/db/logic.ts';

function world() {
  tmpDataDir();
  const db: DB = openDb();
  const school = createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  const mk = (canvasId: string, code: string) => {
    const id = `${school.id}:${canvasId}`;
    upsertCourse(db, {
      id, school_id: school.id, canvas_id: canvasId, name: `${code} course`, code, term_name: null, start_at: null, end_at: null,
      html_url: `${school.base_url}/courses/${canvasId}`, syllabus_html: null, tabs: null, current_score: null, current_grade: null,
      active: 1, updated_at: new Date().toISOString(),
    });
    return id;
  };
  const course = mk('101', 'BIO 3');
  const hidden = mk('102', 'ART 1');
  updateCourseUser(db, hidden, { hidden: true });
  const add = (id: string, patch: Partial<ItemUpsert> = {}) => {
    upsertItem(db, {
      id, school_id: school.id, course_id: course, kind: 'assignment', title: id, due_at: null, end_at: null, unlock_at: null, lock_at: null,
      points: 10, html_url: `https://alpha/${id}`, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
      sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0,
      source: 'api', module_id: null, group_id: null, ...patch,
    });
    return id;
  };
  const seen: Notice[] = [];
  setNotifier(async (n) => { seen.push(n); });
  return { db, school, course, hidden, add, seen };
}

const DUE = '2026-11-03T07:59:00Z'; // Mon Nov 2, 23:59 PST
const before = (h: number) => new Date(Date.parse(DUE) - h * 3_600_000);

test('the notifier applet reads title, subtitle, body and url from four lines', () => {
  assert.equal(pendingText({ title: 'A\nB', body: 'x', url: 'http://u' }), 'A B\n\nx\nhttp://u\n');
});

test('reminders fire 24 hours and 3 hours before a deadline, once each', async () => {
  const { db, add, seen } = world();
  add('hw', { title: 'HW 6', due_at: DUE });
  assert.equal(await runReminders(db, before(30)), 0);
  assert.equal(await runReminders(db, before(23.5)), 1);
  assert.match(seen[0].title, /截止/);
  assert.equal(seen[0].body, 'BIO 3 · HW 6');
  assert.equal(seen[0].url, 'https://alpha/hw');
  assert.equal(await runReminders(db, before(23)), 0, 'not twice');
  assert.equal(await runReminders(db, before(2.5)), 1);
  assert.equal(seen[1].title, '3 小时内截止');
  assert.equal(await runReminders(db, before(1)), 0);
  assert.equal(seen.length, 2);
  setNotifier(null);
});

test('an item first seen 2 hours before its deadline gets only the 3-hour reminder', async () => {
  const { db, add, seen } = world();
  add('late-add', { due_at: DUE });
  assert.equal(await runReminders(db, before(2)), 1);
  assert.equal(seen.length, 1);
  assert.deepEqual(all<{ threshold: string }>(db, "SELECT threshold FROM reminders_sent WHERE item_id = 'late-add' ORDER BY threshold").map((r) => r.threshold), ['24', '3']);
  assert.equal(await runReminders(db, before(1)), 0);
  setNotifier(null);
});

test('a discussion Canvas calls submitted still reminds while replies are missing, and says what is left', async () => {
  const { db, school, course, add, seen } = world();
  add('disc', { kind: 'discussion', title: "Discussion: What's Your Topic?", due_at: DUE, sub_state: 'submitted', submission_types: '["discussion_topic"]' });
  replaceCourseLogic(db, school.id, course, new Map([['disc', {
    parts: [{ kind: 'post' as const, need: 1, done: 1, source: 'canvas' as const }, { kind: 'replies' as const, need: 2, done: 1, source: 'text' as const }], notes: [],
  }]]));
  assert.equal(await runReminders(db, before(23.5)), 1);
  assert.equal(seen[0].body, "BIO 3 · Discussion: What's Your Topic?（还差 1 条回复）");
  setNotifier(null);
});

test('done work, passed deadlines, hidden courses and switched-off reminders stay quiet', async () => {
  const { db, hidden, add, seen } = world();
  add('submitted', { due_at: DUE, sub_state: 'submitted' });
  setLocalDone(db, add('ticked', { due_at: DUE }), true);
  add('passed', { due_at: '2026-11-02T07:59:00Z' });
  add('elsewhere', { due_at: DUE, course_id: hidden });
  assert.equal(await runReminders(db, before(2)), 0);
  add('hw', { due_at: DUE });
  updateSettings(db, { reminders: false });
  assert.equal(await runReminders(db, before(2)), 0);
  assert.equal(seen.length, 0);
  setNotifier(null);
});

test('many deadlines at the same moment become one notice', async () => {
  const { db, add, seen } = world();
  for (const i of [1, 2, 3, 4, 5]) add(`v${i}`, { title: `19.${i} Video`, due_at: DUE });
  assert.equal(await runReminders(db, before(2)), 1);
  assert.equal(seen[0].title, '5 项 3 小时内截止');
  assert.match(seen[0].body, /19\.1 Video/);
  assert.equal(await runReminders(db, before(1)), 0, 'all of them count as reminded');
  setNotifier(null);
});

test('exams: a timed one reminds like a deadline; a date-only one once, the evening before', async () => {
  const { db, school, course, seen } = world();
  upsertSyllabusExam(db, { id: 'alpha:x:mid', school_id: school.id, course_id: course, title: 'Midterm 1', date: '2026-11-04T02:30:00.000Z', timeKnown: true, note: '大纲', html_url: null }); // Tue Nov 3, 18:30 PST
  upsertSyllabusExam(db, { id: 'alpha:x:kc', school_id: school.id, course_id: course, title: 'Knowledge Check 2', date: '2026-11-05T07:59:00.000Z', timeKnown: false, note: '大纲', html_url: null }); // Wed Nov 4, time unknown
  assert.equal(await runReminders(db, new Date('2026-11-03T03:00:00Z')), 1, 'Mon 19:00: midterm in 23.5 h');
  assert.equal(seen[0].title, '考试：明天 18:30');
  assert.equal(seen[0].body, 'BIO 3 · Midterm 1');
  assert.equal(await runReminders(db, new Date('2026-11-04T00:00:00Z')), 1, 'Tue 16:00: midterm in 2.5 h');
  assert.equal(seen[1].title, '考试：今天 18:30');
  assert.equal(await runReminders(db, new Date('2026-11-04T01:30:00Z')), 0, 'Tue 17:30: KC2 waits for the evening');
  assert.equal(await runReminders(db, new Date('2026-11-04T02:10:00Z')), 1, 'Tue 18:10: KC2 is tomorrow');
  assert.equal(seen[2].title, '考试：明天');
  assert.equal(seen[2].body, 'BIO 3 · Knowledge Check 2');
  assert.equal(await runReminders(db, new Date('2026-11-04T17:00:00Z')), 0, 'Wed 09:00: nothing again');
  setNotifier(null);
});

test('change alerts: an earlier deadline, a new item due within 48 h and announcements; extras summarised', async () => {
  const { db, school, course, hidden, add, seen } = world();
  const now = new Date('2026-11-01T16:00:00Z'); // Sun 08:00 PST
  add('moved', { title: 'Lab 5', due_at: '2026-11-03T07:59:00Z' });
  add('fresh', { title: 'Quiz 9', due_at: '2026-11-02T20:00:00Z' });
  add('far', { title: 'Essay', due_at: '2026-11-20T07:59:00Z' });
  add('art', { title: 'Sketch', due_at: '2026-11-02T20:00:00Z', course_id: hidden });
  const change = (kind: 'due_changed' | 'new_item' | 'graded' | 'announcement', ref: string, data: object, extra: { notified?: number; course_id?: string } = {}) =>
    addChange(db, { school_id: school.id, course_id: extra.course_id ?? course, kind, ref_id: ref, summary: `${kind} ${ref}`, data: JSON.stringify(data), notified: extra.notified });
  const topic = (id: string, title: string) => upsertTopic(db, {
    id, course_id: course, kind: 'announcement', title, message_html: null, posted_at: now.toISOString(), author: null,
    html_url: `https://alpha/${id}`, reply_count: 0, unread_count: 0, assignment_item_id: null,
  });
  topic('ann1', 'Lab moved to room 204');
  topic('ann2', 'Office hours cancelled');
  change('due_changed', 'moved', { from: '2026-11-05T07:59:00Z', to: '2026-11-03T07:59:00Z' });
  change('due_changed', 'far', { from: '2026-11-18T07:59:00Z', to: '2026-11-20T07:59:00Z' }); // later: no alert
  change('new_item', 'fresh', { due_at: '2026-11-02T20:00:00Z' });
  change('new_item', 'far', { due_at: '2026-11-20T07:59:00Z' }); // not within 48 h
  change('new_item', 'art', { due_at: '2026-11-02T20:00:00Z' }, { course_id: hidden }); // hidden course
  change('graded', 'moved', { score: 9 });
  change('announcement', 'ann1', {});
  change('announcement', 'ann2', {});
  change('announcement', 'ann-first-sync', {}, { notified: 1 });

  assert.equal(await flushChangeNotices(db, now), 4);
  assert.deepEqual(seen.map((n) => n.title), ['截止时间提前了', '新作业 · 48 小时内截止', '新公告 · BIO 3', '还有 1 条更新']);
  assert.match(seen[0].body, /^BIO 3 Lab 5：周三 23:59 → 明天 23:59$/);
  assert.equal(seen[0].url, 'https://alpha/moved');
  assert.match(seen[1].body, /^BIO 3 Quiz 9 · 明天 12:00$/);
  assert.equal(seen[2].body, 'Lab moved to room 204');
  assert.equal(seen[2].url, 'https://alpha/ann1');
  assert.match(seen[3].body, /Office hours cancelled/);
  assert.equal(pendingChanges(db).length, 0, 'everything is marked notified');
  assert.equal(await flushChangeNotices(db, now), 0);

  // Canvas marks something missing: said at once, with how long it can still be handed in
  add('lab18', { title: 'Exp #18', due_at: '2026-11-01T00:25:00Z', lock_at: '2026-12-18T07:59:59Z', sub_state: 'graded', missing: 1 });
  addChange(db, { school_id: school.id, course_id: course, kind: 'missing', ref_id: 'lab18', summary: 'missing lab18', data: '{}' });
  assert.equal(await flushChangeNotices(db, now), 1);
  assert.equal(seen.at(-1)!.title, 'Canvas 标记缺交');
  assert.equal(seen.at(-1)!.body, 'BIO 3 Exp #18 · 还能交到 12月17日 周四 23:59');
  // ticked off since: no alert
  add('lab19', { title: 'Exp #19', due_at: '2026-11-01T00:25:00Z', sub_state: 'graded', missing: 1 });
  setLocalDone(db, 'lab19', true);
  addChange(db, { school_id: school.id, course_id: course, kind: 'missing', ref_id: 'lab19', summary: 'missing lab19', data: '{}' });
  assert.equal(await flushChangeNotices(db, now), 0);

  change('announcement', 'ann1', {});
  updateSettings(db, { notifyChanges: false });
  assert.equal(await flushChangeNotices(db, now), 0);
  assert.equal(pendingChanges(db).length, 0, 'switched off: marked without alerting');
  setNotifier(null);
});
