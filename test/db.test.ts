import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb, tx } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool, listSchools, getSchool, updateSchool, deleteSchool, normalizeBaseUrl } from '../src/db/schools.ts';
import { upsertCourse, getCourse, listCourses, updateCourseUser, markInactive } from '../src/db/courses.ts';
import { upsertItem, getItem, listItems, listUndated, setLocalDone, createManual, deleteManual, markRemovedExcept, setItemNote } from '../src/db/items.ts';
import type { ItemUpsert } from '../src/db/items.ts';
import { upsertPage, getPage, upsertFile, getFile, filesNeedingText, setFileText, upsertTopic } from '../src/db/content.ts';
import { replaceWeeks, listWeeks, upsertGuide, getGuide } from '../src/db/study.ts';
import { saveReport, listReports, latestReport } from '../src/db/reports.ts';
import { addChange, pendingChanges, markNotified } from '../src/db/changes.ts';
import { getSettings, updateSettings, DEFAULT_SETTINGS } from '../src/db/settings.ts';
import { startSyncRun, finishSyncRun, recentSyncRuns, getJob, setJob } from '../src/db/runs.ts';

function freshDb(): DB {
  tmpDataDir();
  return openDb();
}

function seedCourse(db: DB, schoolName = 'Alpha College', canvasId = '101') {
  const school = createSchool(db, { name: schoolName, base_url: 'alpha.instructure.com' });
  const id = `${school.id}:${canvasId}`;
  upsertCourse(db, {
    id, school_id: school.id, canvas_id: canvasId, name: 'Biology 3', code: 'BIO 3', term_name: 'Fall 2026',
    start_at: null, end_at: null, html_url: `${school.base_url}/courses/${canvasId}`, syllabus_html: null, tabs: null,
    current_score: null, current_grade: null, active: 1, updated_at: new Date().toISOString(),
  });
  return { school, courseId: id };
}

function item(courseId: string, schoolId: string, id: string, patch: Partial<ItemUpsert> = {}): ItemUpsert {
  return {
    id, school_id: schoolId, course_id: courseId, kind: 'assignment', title: 'HW 1', due_at: '2026-10-20T06:59:00Z',
    end_at: null, unlock_at: null, lock_at: null, points: 10, html_url: null, provider: 'canvas', description_html: null,
    submission_types: '["online_upload"]', sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0,
    score: null, grade: null, canvas_done: 0, source: 'api', module_id: null, group_id: null, ...patch,
  };
}

test('migrations are idempotent and record schema_version', () => {
  const dir = tmpDataDir();
  const db1 = openDb();
  db1.close();
  const db2 = openDb();
  const row = db2.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string };
  assert.ok(Number(row.value) >= 1);
  assert.ok(dir.length > 0);
});

test('normalizeBaseUrl keeps only the https origin', () => {
  assert.equal(normalizeBaseUrl('smc.instructure.com/'), 'https://smc.instructure.com');
  assert.equal(normalizeBaseUrl(' https://canvas.x.edu/courses/123 '), 'https://canvas.x.edu');
  assert.equal(normalizeBaseUrl('http://canvas.x.edu'), 'https://canvas.x.edu');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:4301/'), 'http://127.0.0.1:4301');
  assert.throws(() => normalizeBaseUrl('not a url'));
  assert.throws(() => normalizeBaseUrl('ftp://x.edu'));
});

test('createSchool slugs the name, normalizes the URL and assigns distinct colors', () => {
  const db = freshDb();
  const a = createSchool(db, { name: 'Santa Monica College', base_url: 'smc.instructure.com/' });
  assert.equal(a.id, 'santa-monica-college');
  assert.equal(a.base_url, 'https://smc.instructure.com');
  assert.equal(a.status, 'new');
  const b = createSchool(db, { name: 'Santa Monica College', base_url: 'other.instructure.com' });
  assert.equal(b.id, 'santa-monica-college-2');
  assert.notEqual(a.color, b.color);
  assert.equal(listSchools(db).length, 2);
});

test('updateSchool and deleteSchool (cascades courses and items)', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  upsertItem(db, item(courseId, school.id, `${school.id}:a:1`));
  updateSchool(db, school.id, { status: 'ok', user_name: 'Ewan' });
  assert.equal(getSchool(db, school.id)?.user_name, 'Ewan');
  deleteSchool(db, school.id);
  assert.equal(getSchool(db, school.id), undefined);
  assert.equal(getCourse(db, courseId), undefined);
  assert.equal(getItem(db, `${school.id}:a:1`), undefined);
});

test('upsertCourse preserves user nickname/hidden/color/week1', () => {
  const db = freshDb();
  const { courseId } = seedCourse(db);
  updateCourseUser(db, courseId, { nickname: '生物', hidden: true, color: '#123456' });
  const c = getCourse(db, courseId)!;
  upsertCourse(db, { ...c, name: 'Biology 3 (renamed)', updated_at: new Date().toISOString() });
  const after = getCourse(db, courseId)!;
  assert.equal(after.name, 'Biology 3 (renamed)');
  assert.equal(after.nickname, '生物');
  assert.equal(after.hidden, 1);
  assert.equal(after.color, '#123456');
});

test('listCourses hides hidden/inactive courses unless asked; markInactive', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  upsertCourse(db, { ...getCourse(db, courseId)!, id: `${school.id}:102`, canvas_id: '102', name: 'Old course' });
  markInactive(db, school.id, [courseId]);
  assert.deepEqual(listCourses(db).map((c) => c.id), [courseId]);
  assert.equal(listCourses(db, { activeOnly: false }).length, 2);
  updateCourseUser(db, courseId, { hidden: true });
  assert.equal(listCourses(db).length, 0);
  assert.equal(listCourses(db, { includeHidden: true }).length, 1);
});

test('upsertItem reports creation, then returns the previous row', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  const id = `${school.id}:a:1`;
  assert.deepEqual(upsertItem(db, item(courseId, school.id, id)), { created: true });
  const second = upsertItem(db, item(courseId, school.id, id, { due_at: '2026-10-18T06:59:00Z' }));
  assert.equal(second.created, false);
  assert.equal(second.prev?.due_at, '2026-10-20T06:59:00Z');
  assert.equal(getItem(db, id)?.due_at, '2026-10-18T06:59:00Z');
});

test('upsertItem never overwrites local_done and clears removed', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  const id = `${school.id}:a:1`;
  upsertItem(db, item(courseId, school.id, id));
  setLocalDone(db, id, true);
  db.prepare('UPDATE items SET removed = 1 WHERE id = ?').run(id);
  upsertItem(db, item(courseId, school.id, id, { title: 'HW 1 v2' }));
  const row = getItem(db, id)!;
  assert.equal(row.local_done, 1);
  assert.equal(row.removed, 0);
  assert.equal(row.title, 'HW 1 v2');
});

test('markRemovedExcept only touches listed kinds in that course', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  const other = `${school.id}:102`;
  upsertCourse(db, { ...getCourse(db, courseId)!, id: other, canvas_id: '102' });
  upsertItem(db, item(courseId, school.id, 'a1'));
  upsertItem(db, item(courseId, school.id, 'a2'));
  upsertItem(db, item(courseId, school.id, 'e1', { kind: 'event' }));
  upsertItem(db, item(other, school.id, 'b1'));
  const n = markRemovedExcept(db, courseId, ['assignment', 'quiz', 'discussion'], new Set(['a1']));
  assert.equal(n, 1);
  assert.equal(getItem(db, 'a2')?.removed, 1);
  assert.equal(getItem(db, 'a1')?.removed, 0);
  assert.equal(getItem(db, 'e1')?.removed, 0);
  assert.equal(getItem(db, 'b1')?.removed, 0);
});

test('listItems filters by range, hidden courses and removed; listUndated', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  upsertItem(db, item(courseId, school.id, 'early', { due_at: '2026-10-10T06:59:00Z' }));
  upsertItem(db, item(courseId, school.id, 'late', { due_at: '2026-10-30T06:59:00Z' }));
  upsertItem(db, item(courseId, school.id, 'nodue', { due_at: null }));
  const inRange = listItems(db, { from: '2026-10-01T00:00:00Z', to: '2026-10-20T00:00:00Z' });
  assert.deepEqual(inRange.map((i) => i.id), ['early']);
  assert.deepEqual(listUndated(db).map((i) => i.id), ['nodue']);
  updateCourseUser(db, courseId, { hidden: true });
  assert.equal(listItems(db, {}).length, 0);
  assert.equal(listItems(db, { includeHiddenCourses: true }).length, 2);
});

test('manual items can be created and deleted, Canvas items cannot be deleted', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  const m = createManual(db, { title: 'Achieve HW 4', course_id: courseId, due_at: '2026-10-21T06:59:00Z', html_url: null });
  assert.match(m.id, /^manual:/);
  assert.equal(m.school_id, school.id);
  assert.equal(m.source, 'manual');
  upsertItem(db, item(courseId, school.id, 'a1'));
  assert.throws(() => deleteManual(db, 'a1'));
  deleteManual(db, m.id);
  assert.equal(getItem(db, m.id), undefined);
});

test('upsertPage keeps the stored body when the body is omitted', () => {
  const db = freshDb();
  const { courseId } = seedCourse(db);
  const base = { id: 'p1', course_id: courseId, url: 'intro', title: 'Intro', updated_at: '2026-10-01T00:00:00Z', front_page: 0, html_url: 'x' };
  upsertPage(db, { ...base, body_html: '<p>Hi</p>' });
  const res = upsertPage(db, { ...base, title: 'Intro!' });
  assert.equal(res.prev?.updated_at, '2026-10-01T00:00:00Z');
  assert.equal(getPage(db, 'p1')?.body_html, '<p>Hi</p>');
  assert.equal(getPage(db, 'p1')?.title, 'Intro!');
});

test('upsertFile resets text_status to pending only when the file changes', () => {
  const db = freshDb();
  const { courseId } = seedCourse(db);
  const f = { id: 'f1', course_id: courseId, canvas_id: '9', name: 'Week1.pdf', content_type: 'application/pdf', size: 1000, updated_at: '2026-10-01T00:00:00Z', html_url: 'x' };
  assert.equal(upsertFile(db, f).created, true);
  assert.deepEqual(filesNeedingText(db, 10).map((r) => r.id), ['f1']);
  setFileText(db, 'f1', { status: 'ok', pages: 3 });
  upsertFile(db, f);
  assert.equal(getFile(db, 'f1')?.text_status, 'ok');
  upsertFile(db, { ...f, updated_at: '2026-10-05T00:00:00Z' });
  assert.equal(getFile(db, 'f1')?.text_status, 'pending');
});

test('upsertTopic reports new topics once', () => {
  const db = freshDb();
  const { courseId } = seedCourse(db);
  const t = { id: 't1', course_id: courseId, kind: 'announcement' as const, title: 'Welcome', message_html: '', posted_at: null, author: null, html_url: 'x', reply_count: 0, unread_count: 0, assignment_item_id: null };
  assert.equal(upsertTopic(db, t).created, true);
  assert.equal(upsertTopic(db, t).created, false);
});

test('weeks are replaced wholesale; guides upsert partially', () => {
  const db = freshDb();
  const { courseId } = seedCourse(db);
  replaceWeeks(db, courseId, [{ course_id: courseId, week: 1, start_date: '2026-08-24', title: 'Week 1', topics: '[]', source: 'calc' }]);
  replaceWeeks(db, courseId, [{ course_id: courseId, week: 2, start_date: '2026-08-31', title: null, topics: '["cells"]', source: 'syllabus' }]);
  assert.deepEqual(listWeeks(db, courseId).map((w) => w.week), [2]);
  upsertGuide(db, { course_id: courseId, week: 2, status: 'queued' });
  upsertGuide(db, { course_id: courseId, week: 2, status: 'ready', content: '{}', input_hash: 'h' });
  const g = getGuide(db, courseId, 2)!;
  assert.equal(g.status, 'ready');
  assert.equal(g.input_hash, 'h');
  assert.equal(g.attempts, 0);
});

test('settings default and merge on update', () => {
  const db = freshDb();
  assert.deepEqual(getSettings(db), DEFAULT_SETTINGS);
  const s = updateSettings(db, { aiModel: 'opus' });
  assert.equal(s.aiModel, 'opus');
  assert.equal(s.dailyTime, '07:00');
  assert.equal(getSettings(db).aiModel, 'opus');
});

test('saveReport upserts by type and period', () => {
  const db = freshDb();
  saveReport(db, { type: 'daily', period: '2026-10-12', content: '{"v":1}' });
  saveReport(db, { type: 'daily', period: '2026-10-12', content: '{"v":2}' });
  saveReport(db, { type: 'weekly', period: '2026-10-12', content: '{}' });
  assert.equal(listReports(db, 'daily').length, 1);
  assert.equal(latestReport(db, 'daily')?.content, '{"v":2}');
});

test('changes queue: pending until marked notified', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  addChange(db, { school_id: school.id, course_id: courseId, kind: 'due_changed', ref_id: 'a1', summary: 's', data: '{}' });
  addChange(db, { school_id: school.id, course_id: courseId, kind: 'new_item', ref_id: 'a2', summary: 's', data: '{}', notified: 1 });
  const pending = pendingChanges(db);
  assert.equal(pending.length, 1);
  markNotified(db, pending.map((c) => c.id));
  assert.equal(pendingChanges(db).length, 0);
});

test('sync runs and job bookkeeping', () => {
  const db = freshDb();
  const id = startSyncRun(db, 'alpha');
  finishSyncRun(db, id, 'ok', { courses: 3 });
  const [run] = recentSyncRuns(db, 5);
  assert.equal(run.status, 'ok');
  assert.equal(JSON.parse(run.stats!).courses, 3);
  assert.equal(getJob(db, 'daily'), undefined);
  setJob(db, 'daily', { last_run_at: '2026-10-12T14:00:00Z', last_status: 'ok' });
  setJob(db, 'daily', { last_error: null });
  assert.equal(getJob(db, 'daily')?.last_run_at, '2026-10-12T14:00:00Z');
});

test('tx rolls back on error', () => {
  const db = freshDb();
  assert.throws(() => tx(db, () => {
    createSchool(db, { name: 'Rollback U', base_url: 'r.instructure.com' });
    throw new Error('boom');
  }));
  assert.equal(listSchools(db).length, 0);
});

test('a personal note on a task survives re-syncs', () => {
  const db = freshDb();
  const { school, courseId } = seedCourse(db);
  upsertItem(db, item(courseId, school.id, 'x:1'));
  setItemNote(db, 'x:1', '带计算器');
  upsertItem(db, item(courseId, school.id, 'x:1', { title: 'HW 1 (updated)' }));
  assert.equal(getItem(db, 'x:1')!.user_note, '带计算器');
  setItemNote(db, 'x:1', null);
  assert.equal(getItem(db, 'x:1')!.user_note, null);
});

test('the queries that grow with time use an index, not a full scan', () => {
  const db = freshDb();
  const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[]).map((r) => r.detail).join(' | ');
  assert.match(plan("SELECT * FROM changes WHERE notified = 0"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM changes WHERE created_at >= '2026-01-01'"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM topics WHERE course_id = 'x' AND kind = 'announcement'"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM files WHERE course_id = 'x'"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM pages WHERE course_id = 'x'"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM items WHERE school_id = 'x' AND removed = 0"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM ai_runs WHERE started_at >= '2026-01-01'"), /USING (COVERING )?INDEX/);
  assert.match(plan("SELECT * FROM sync_runs WHERE school_id = 'x' ORDER BY id DESC LIMIT 1"), /USING (COVERING )?INDEX|USING INTEGER PRIMARY KEY/);
  assert.match(plan("SELECT * FROM reminders_sent WHERE sent_at < '2026-01-01'"), /USING (COVERING )?INDEX/);
});
