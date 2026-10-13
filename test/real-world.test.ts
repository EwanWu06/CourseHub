// The shapes found when Course Hub was checked against the user's real Canvas (SMC, UCLA Extension, LACCD):
// every one of them must come through complete and on time — in API mode and when only the calendar feed works.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool, updateSchool } from '../src/db/schools.ts';
import { getItem, listItems, listUndated } from '../src/db/items.ts';
import { all, one } from '../src/db/sql.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { makeTaskViewer } from '../src/reports/data.ts';
import { createApp } from '../src/server/app.ts';
import type { TaskView } from '../src/reports/data.ts';
import type { AchieveData, AchieveReader } from '../src/platforms/achieve.ts';

const ACHIEVE: AchieveData = {
  items: [
    { id: 'q1', name: 'Pre-Class Review Questions 7.3-7.7', tool: 'assessment', points: 19, dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString(), visibilityStartDate: null, gradebookCategoryName: 'Week 4' },
    { id: 'p1', name: 'Week 3 Practice Exam Questions', tool: 'assessment', points: 5, dueDate: new Date(Date.now() + 3 * 86_400_000).toISOString(), visibilityStartDate: null, gradebookCategoryName: 'PEQS (all weeks)' },
    { id: 'r1', name: '7.3 Pyruvate Oxidation', tool: 'reading', points: null, dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString(), visibilityStartDate: null, gradebookCategoryName: 'Ungraded' },
  ],
  statuses: { q1: 'Completed', p1: '', r1: '' },
};
const reads: { url: string; uuid: string }[] = [];
let achieve: AchieveReader = async (url, uuid) => {
  reads.push({ url, uuid });
  return ACHIEVE;
};
const readAchieve: AchieveReader = (url, uuid) => achieve(url, uuid);

async function gamma(opts: { auth?: boolean } = {}) {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'gamma', pageSize: 3 });
  const school = createSchool(db, { name: 'Gamma', base_url: mock.baseUrl });
  if (opts.auth ?? true) saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  else updateSchool(db, school.id, { ics_url: `${mock.baseUrl}/feeds/calendars/user_gamma-ics-token.ics` });
  return { db, mock, s: school.id };
}

const view = (db: DB, id: string): TaskView => makeTaskViewer(db, new Date())(getItem(db, id)!);
const localHm = (iso: string | null) => (iso ? `${new Date(iso).getHours()}:${String(new Date(iso).getMinutes()).padStart(2, '0')}` : null);
const localDate = (iso: string | null) => (iso ? new Date(iso).toDateString() : null);

test('courses with Pages, Quizzes or Files hidden from students sync without errors', async () => {
  const { db, mock, s } = await gamma();
  try {
    const stats = await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(stats.mode, 'api');
    assert.deepEqual(stats.errors, []);
    assert.equal(stats.courses, 4);
    assert.ok(getItem(db, `${s}:a:7301`) && getItem(db, `${s}:a:7601`));
  } finally {
    await mock.close();
  }
});

test('announcements posted before the course started are not lost (welcome notes, first-week schedule changes)', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    const has = (id: string) => !!one(db, 'SELECT 1 AS x FROM topics WHERE id = $id', { id: `${s}:t:${id}` });
    assert.ok(has('7661'), '[MUST READ] Week 1 Lectures moved — posted 4 days before MATH started');
    assert.ok(has('7201'), 'Welcome to English C1000! — posted 2 days before ENGL started');
    assert.ok(has('7202'), 'an announcement Canvas shows without a posted date');
  } finally {
    await mock.close();
  }
});

test('peer reviews assigned to the student are tasks, done once Canvas says they are completed', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    const open = view(db, `${s}:pr:239991`);
    assert.equal(open.kind, 'review');
    assert.equal(open.title, 'Essay #2: Rough Draft · 同伴互评');
    assert.equal(open.status, 'todo');
    assert.equal(open.courseId, `${s}:301`);
    assert.match(open.htmlUrl ?? '', /\/courses\/301\/assignments\/7101\?reviewee_id=/);
    assert.equal(open.category, 'review');
    assert.equal(view(db, `${s}:pr:239992`).status, 'done');
  } finally {
    await mock.close();
  }
});

test('work with only an "available until" date is due when it closes — listed, counted, reminded', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    const survey = view(db, `${s}:a:7102`);
    assert.equal(survey.dueAt, getItem(db, `${s}:a:7102`)!.lock_at);
    assert.equal(survey.dueIsClose, true);
    assert.equal(survey.status, 'todo');
    const soon = listItems(db, { from: new Date().toISOString(), to: new Date(Date.now() + 14 * 86_400_000).toISOString() }).map((r) => r.id);
    assert.ok(soon.includes(`${s}:a:7102`));
    assert.ok(!listUndated(db).some((r) => r.id === `${s}:a:7102`));
    assert.equal(view(db, `${s}:a:7104`).status, 'done'); // closed and graded
  } finally {
    await mock.close();
  }
});

test('an ungraded-looking grade column with nothing to submit and no date is not shown as a to-do', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    const app = createApp(db);
    const undated = (await (await app.request('http://127.0.0.1:4123/api/items/undated')).json()) as TaskView[];
    assert.ok(!undated.some((t) => t.id === `${s}:a:7403`), 'Achieve Category: Week 5 (No Submission, no date)');
  } finally {
    await mock.close();
  }
});

test('override events in the calendar feed never become duplicate tasks', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(getItem(db, `${s}:a:225628`), undefined);
    assert.equal(getItem(db, `${s}:a:789771`), undefined);
    assert.equal(all(db, "SELECT id FROM items WHERE title LIKE 'Presentations%'").length, 1);
  } finally {
    await mock.close();
  }
});

test('a checkpoint the student ticked off in the Canvas planner counts as done', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(view(db, `${s}:a:7304:reply_to_entry`).status, 'done');
    assert.equal(view(db, `${s}:a:7303:reply_to_topic`).status, 'todo');
  } finally {
    await mock.close();
  }
});

test('when the login lapses, the calendar feed keeps every deadline exactly as it was (no fake "moved earlier")', async () => {
  const { db, mock, s } = await gamma();
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    const before = new Map(all<{ id: string; due_at: string | null }>(db, 'SELECT id, due_at FROM items WHERE removed = 0').map((r) => [r.id, r.due_at]));
    const changesBefore = all(db, 'SELECT id FROM changes').length;
    mock.expireSessions();
    const stats = await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(stats.mode, 'ics');
    const after = new Map(all<{ id: string; due_at: string | null }>(db, 'SELECT id, due_at FROM items WHERE removed = 0').map((r) => [r.id, r.due_at]));
    assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort(), 'no task appears or disappears');
    for (const [id, due] of before) assert.equal(after.get(id), due, id);
    assert.equal(all(db, 'SELECT id FROM changes').length, changesBefore, 'no change alerts');
  } finally {
    await mock.close();
  }
});

test('with no login at all, the calendar feed alone gives correct deadlines, checkpoints included', async () => {
  const { db, mock, s } = await gamma({ auth: false });
  try {
    const stats = await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(stats.mode, 'ics');
    const hw = getItem(db, `${s}:a:7301`)!; // due 11:59 PM: an all-day date in the feed
    assert.equal(localHm(hw.due_at), '23:59');
    assert.match(hw.html_url ?? '', /\/courses\/302\/assignments\/7301$/);
    assert.equal(localHm(getItem(db, `${s}:a:7302`)!.due_at), '16:25');
    const pres = getItem(db, `${s}:a:7103`)!; // listed only as event-assignment-override-225628
    assert.equal(pres.title, 'Presentations: The First Half [ENGL C1000]');
    assert.equal(getItem(db, `${s}:a:225628`), undefined);
    const first = getItem(db, `${s}:a:7303:reply_to_topic`)!;
    const replies = getItem(db, `${s}:a:7303:reply_to_entry`)!;
    assert.equal(first.title, 'Titrations in the Real World Discussion · 首帖 [CHEM_102_17218FA26W]');
    assert.equal(replies.title, 'Titrations in the Real World Discussion · 回复同学 [CHEM_102_17218FA26W]');
    assert.equal(localHm(first.due_at), '23:59');
    assert.ok(localDate(first.due_at)! < localDate(replies.due_at)! || Date.parse(first.due_at!) < Date.parse(replies.due_at!));
  } finally {
    await mock.close();
  }
});

test('a planner note or peer review that disappears from Canvas disappears from Course Hub', async () => {
  const { db, mock, s } = await gamma();
  try {
    mock.data.plannerExtras.push({ type: 'planner_note', id: '7901', course_id: '301', title: 'Ask about essay topic', todo_date: new Date(Date.now() + 86_400_000).toISOString() });
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(getItem(db, `${s}:n:7901`)!.removed, 0);
    mock.data.plannerExtras.splice(0, mock.data.plannerExtras.length); // note deleted, peer reviews withdrawn
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(getItem(db, `${s}:n:7901`)!.removed, 1);
    assert.equal(getItem(db, `${s}:pr:239991`)!.removed, 1);
  } finally {
    await mock.close();
  }
});

test('Achieve work comes in with its real deadlines and completion, opening through Canvas — no alert storm on first import', async () => {
  const { db, mock, s } = await gamma();
  try {
    reads.length = 0;
    const stats = await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.deepEqual(stats.errors, []);
    assert.equal(reads.length, 1);
    assert.match(reads[0].url, /\/courses\/303\/external_tools\/sessionless_launch\?verifier=v7451$/);
    assert.equal(reads[0].uuid, '3de09d3e-5572-4b21-9c29-76961c25e2bc');
    const q1 = view(db, `${s}:ach:q1`);
    assert.equal(q1.courseId, `${s}:303`);
    assert.equal(q1.status, 'done');
    assert.equal(q1.htmlUrl, `${mock.baseUrl}/courses/303/modules/items/7451`);
    assert.equal(view(db, `${s}:ach:p1`).status, 'todo');
    assert.equal(view(db, `${s}:ach:p1`).category, 'homework');
    assert.equal(all(db, "SELECT id FROM changes WHERE ref_id LIKE '%:ach:%'").length, 0);
    const app = createApp(db);
    const overview = (await (await app.request('http://127.0.0.1:4123/api/overview')).json()) as { platforms: { courseId: string; platform: string; ok: boolean; items: number }[] };
    assert.deepEqual(overview.platforms.map((p) => [p.courseId, p.platform, p.ok, p.items]), [[`${s}:303`, 'Achieve', true, 3]]);
  } finally {
    await mock.close();
  }
});

test('when Achieve cannot be read, what was known stays, the problem is shown, and Canvas still syncs', async () => {
  const { db, mock, s } = await gamma();
  const original = achieve;
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    achieve = async () => {
      throw new Error('没有进入 Achieve 课程页');
    };
    const stats = await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(stats.mode, 'api');
    assert.ok(stats.errors.some((e) => /Achieve/.test(e)), stats.errors.join('; '));
    assert.equal(getItem(db, `${s}:ach:p1`)!.removed, 0);
    assert.ok(getItem(db, `${s}:a:7404`));
    const app = createApp(db);
    const overview = (await (await app.request('http://127.0.0.1:4123/api/overview')).json()) as { platforms: { ok: boolean; error: string | null }[] };
    assert.equal(overview.platforms[0].ok, false, 'Today shows it right away');
    assert.match(overview.platforms[0].error ?? '', /没有进入/);
    const issues = async () => ((await (await app.request('http://127.0.0.1:4123/api/status')).json()) as { issues: { kind: string; text: string }[] }).issues;
    assert.ok(!(await issues()).some((i) => i.kind === 'platform'), 'one miss right after a good read is not an alarm');
    db.prepare("UPDATE platform_status SET last_ok_at = ? WHERE platform = 'achieve'").run(new Date(Date.now() - 7 * 3_600_000).toISOString());
    assert.ok((await issues()).some((i) => i.kind === 'platform' && /Achieve.*7 小时/.test(i.text)), 'stale for hours: the status page says so');
  } finally {
    achieve = original;
    await mock.close();
  }
});

test('Achieve work taken down in Achieve disappears; a new one is announced like any new work', async () => {
  const { db, mock, s } = await gamma();
  const original = achieve;
  try {
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    achieve = async () => ({
      items: [...ACHIEVE.items.filter((i) => i.id !== 'p1'), { id: 'n1', name: 'Gel Electrophoresis review Questions', tool: 'assessment', points: 4, dueDate: new Date(Date.now() + 86_400_000).toISOString(), visibilityStartDate: null, gradebookCategoryName: 'Week 5' }],
      statuses: {},
    });
    await syncSchool(db, s, { reason: 'test', relogin: null, readAchieve });
    assert.equal(getItem(db, `${s}:ach:p1`)!.removed, 1);
    assert.equal(getItem(db, `${s}:ach:q1`)!.removed, 0, 'the Canvas sync of the same course leaves Achieve work alone');
    assert.equal(all(db, "SELECT id FROM changes WHERE ref_id LIKE '%:ach:n1' AND kind = 'new_item'").length, 1);
  } finally {
    achieve = original;
    await mock.close();
  }
});
