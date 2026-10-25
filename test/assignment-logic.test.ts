// "Done" means everything the assignment asks for: a discussion needs its replies, not just the first post; a
// peer-review grade column needs its reviews; an earlier first-post deadline is its own task. Shapes from the
// user's real SMC and LACCD courses (mock school gamma).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getItem } from '../src/db/items.ts';
import { all } from '../src/db/sql.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { makeTaskViewer } from '../src/reports/data.ts';
import type { TaskView } from '../src/reports/data.ts';
import { createApp } from '../src/server/app.ts';
import { milestoneDate } from '../src/logic/instructions.ts';

async function gamma() {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'gamma', pageSize: 3 });
  const school = createSchool(db, { name: 'Gamma', base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  const sync = () => syncSchool(db, school.id, { reason: 'test', relogin: null, readAchieve: null });
  return { db, mock, s: school.id, sync };
}

const view = (db: DB, id: string): TaskView => makeTaskViewer(db, new Date())(getItem(db, id)!);
const part = (t: TaskView, kind: string) => t.requirements?.parts.find((p) => p.kind === kind);
const course = (mock: Awaited<ReturnType<typeof startMockCanvas>>, id: string) => mock.data.courses.find((c) => c.id === id)!;
const assignment = (mock: Awaited<ReturnType<typeof startMockCanvas>>, courseId: string, id: string) => course(mock, courseId).assignments.find((a) => a.id === id)!;

test('a discussion Canvas already calls "submitted" stays on the list until its replies are in', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const t = view(db, `${s}:a:7105`);
    assert.equal(getItem(db, `${s}:a:7105`)!.sub_state, 'submitted', 'Canvas: submitted (the main post)');
    assert.equal(t.status, 'todo');
    assert.deepEqual({ ...part(t, 'post'), quote: undefined, detail: undefined }, { kind: 'post', need: 1, done: 1, source: 'canvas', quote: undefined, detail: undefined });
    const r = part(t, 'replies')!;
    assert.equal(r.need, 2);
    assert.equal(r.done, 1);
    assert.equal(r.quote, 'Reply at least two times to other students with questions, critiques, or suggestions.');
    const overview = await (await createApp(db).request('http://127.0.0.1:4123/api/overview')).json() as { homework: TaskView[] };
    assert.ok(overview.homework.some((x) => x.id === `${s}:a:7105` && x.status === 'todo'), 'on Today');

    assignment(mock, '301', '7105').entries!.push({ id: '9102', parent_id: '9202' });
    await sync();
    const done = view(db, `${s}:a:7105`);
    assert.equal(done.status, 'done');
    assert.equal(part(done, 'replies')!.done, 2);
  } finally {
    await mock.close();
  }
});

test('two replies to the same classmate, or one to the teacher, are not two classmates', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    const entries = assignment(mock, '301', '7105').entries!;
    entries.push({ id: '9102', parent_id: '9201' }, { id: '9103', parent_id: '9203' }); // u-sean again; the teacher
    await sync();
    const r = part(view(db, `${s}:a:7105`), 'replies')!;
    assert.equal(r.done, 1);
    assert.match(r.detail ?? '', /3 条.*1 位同学/);
    assert.equal(view(db, `${s}:a:7105`).status, 'todo');
  } finally {
    await mock.close();
  }
});

test('Canvas marks "Required Replies (2)" submitted at the first reply: Course Hub waits for the second', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const replies = view(db, `${s}:a:7305:reply_to_entry`);
    assert.equal(getItem(db, `${s}:a:7305:reply_to_entry`)!.sub_state, 'submitted');
    assert.equal(replies.status, 'todo');
    assert.deepEqual([part(replies, 'replies')!.need, part(replies, 'replies')!.done], [2, 1]);
    const first = view(db, `${s}:a:7305:reply_to_topic`);
    assert.equal(first.status, 'done');
    assert.deepEqual([part(first, 'post')!.need, part(first, 'post')!.done], [1, 1]);
    assert.ok(first.requirements!.notes.some((n) => n.kind === 'post_first'), 'must post before seeing the others');
  } finally {
    await mock.close();
  }
});

test('Canvas says posted but lists none of the student\'s entries: nothing is counted, Canvas\'s word stands', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync(); // Experiment 34: "Reply to Topic" submitted, no entries in the submission (as a group discussion can be)
    const first = view(db, `${s}:a:7304:reply_to_topic`);
    assert.equal(first.status, 'done');
    assert.equal(part(first, 'post')!.done, null);
  } finally {
    await mock.close();
  }
});

test('who wrote a post the student replied to is looked up once, not every sync', async () => {
  const { db, mock, sync } = await gamma();
  try {
    await sync();
    const lookups = () => mock.requests.filter((r) => r.path.includes('/entry_list')).length;
    const first = lookups();
    assert.ok(first >= 2, 'ENGL and CHEM discussions with replies');
    await sync();
    assert.equal(lookups(), first);
    assert.equal(all(db, 'SELECT * FROM entry_authors').length >= 2, true);
  } finally {
    await mock.close();
  }
});

test('a discussion that only asks for a post is done once it is posted', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const t = view(db, `${s}:a:7106`);
    assert.deepEqual(t.requirements!.parts.map((p) => [p.kind, p.need, p.done]), [['post', 1, 0]]);
    assert.ok(t.requirements!.notes.some((n) => n.kind === 'words' && /200.300/.test(n.text)));
    assignment(mock, '301', '7106').entries!.push({ id: '9110', parent_id: null });
    assignment(mock, '301', '7106').submission = { ...assignment(mock, '301', '7106').submission, workflow_state: 'submitted', submitted_at: new Date().toISOString() };
    await sync();
    assert.equal(view(db, `${s}:a:7106`).status, 'done');
  } finally {
    await mock.close();
  }
});

test('a peer-review grade column counts the reviews, and the reviews take its deadline', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const column = view(db, `${s}:a:7107`);
    const reviews = part(column, 'reviews')!;
    assert.deepEqual([reviews.need, reviews.done], [3, 1]);
    assert.match(reviews.detail ?? '', /已分配 2/);
    assert.equal(column.status, 'todo');
    const pr = view(db, `${s}:pr:239991`);
    assert.equal(pr.dueAt, getItem(db, `${s}:a:7107`)!.due_at, 'due when the teacher\'s peer-review column is due');
    assert.match(pr.dueNote ?? '', /Peer Reviews for Bradbury Draft/);
    const draft = view(db, `${s}:a:7101`);
    assert.ok(draft.requirements!.notes.some((n) => n.kind === 'peer_reviews' && /3/.test(n.text)));

    mock.data.plannerExtras.push(
      { type: 'assessment_request', id: '239993', course_id: '301', title: 'Essay #2: Rough Draft', todo_date: new Date(Date.now() + 2 * 86_400_000).toISOString(), assignment_id: '7101', workflow_state: 'completed' },
    );
    for (const x of mock.data.plannerExtras) if (x.id === '239991') x.workflow_state = 'completed';
    await sync();
    assert.equal(view(db, `${s}:a:7107`).status, 'done');
  } finally {
    await mock.close();
  }
});

test('"Initial Post Due Thursday" in the title becomes its own task with that day\'s deadline', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const parent = getItem(db, `${s}:a:7108`)!;
    const first = view(db, `${s}:a:7108:initial_post`);
    assert.equal(first.title, 'Week 8 Discussion (Initial Post Due Thursday) · 首帖');
    assert.equal(first.dueAt, milestoneDate(parent.due_at!, { weekday: 4, time: null }));
    assert.equal(new Date(first.dueAt!).getDay(), 4);
    assert.match(first.dueNote ?? '', /Initial Post Due Thursday/);
    assert.equal(first.status, Date.parse(first.dueAt!) > Date.now() ? 'todo' : 'overdue');
    const whole = view(db, `${s}:a:7108`);
    assert.deepEqual(whole.requirements!.parts.map((p) => [p.kind, p.need, p.done]), [['post', 1, 0], ['replies', 2, 0]]);

    assignment(mock, '301', '7108').entries!.push({ id: '9500', parent_id: null });
    await sync();
    assert.equal(view(db, `${s}:a:7108:initial_post`).status, 'done');

    assignment(mock, '301', '7108').name = 'Week 8 Discussion';
    await sync();
    assert.equal(getItem(db, `${s}:a:7108:initial_post`)!.removed, 1, 'gone when the instructions stop saying so');
  } finally {
    await mock.close();
  }
});

test('the first-post task follows Canvas too when Canvas lists none of the entries', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    assignment(mock, '301', '7108').submission = { ...assignment(mock, '301', '7108').submission, workflow_state: 'submitted', submitted_at: new Date().toISOString() };
    await sync();
    assert.equal(view(db, `${s}:a:7108:initial_post`).status, 'done');
  } finally {
    await mock.close();
  }
});

test('one attempt, in the lab only, PDF only: shown with the task', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const lab = view(db, `${s}:a:7306`).requirements!.notes;
    assert.ok(lab.some((n) => n.kind === 'one_attempt' && n.quote === 'You will have one attempt to complete this assignment.'));
    assert.ok(lab.some((n) => n.kind === 'in_person' && /physically in the lab/.test(n.quote ?? '')));
    const upload = view(db, `${s}:a:7307`).requirements!.notes;
    assert.ok(upload.some((n) => n.kind === 'file_types' && /PDF/.test(n.text)));
    assert.equal(view(db, `${s}:a:7308`).requirements, null, 'a video watched in PlayPosit uploads no file, whatever Canvas says');
  } finally {
    await mock.close();
  }
});

test('grading rules come with the course: weights and dropped scores', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const res = await createApp(db).request(`http://127.0.0.1:4123/api/courses/${encodeURIComponent(`${s}:302`)}`);
    const body = await res.json() as { grading: { weighted: boolean; groups: { name: string; weight: number | null; dropLowest: number; dropHighest: number; count: number }[] } };
    assert.equal(body.grading.weighted, true);
    const lab = body.grading.groups.find((g) => g.name === 'Lab')!;
    assert.deepEqual({ ...lab, count: 0 }, { name: 'Lab', weight: 25, dropLowest: 2, dropHighest: 0, count: 0 });
  } finally {
    await mock.close();
  }
});

test('a quiz below the minimum score the module asks for is not done, even graded', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const quiz = view(db, `${s}:a:7109`);
    assert.equal(getItem(db, `${s}:a:7109`)!.sub_state, 'graded');
    assert.notEqual(quiz.status, 'done');
    const sc = part(quiz, 'score')!;
    assert.deepEqual([sc.need, sc.done], [12, 10]);
    assert.match(sc.detail ?? '', /Start Here/);
    assert.equal(quiz.remaining, '还差 2 分');

    for (const m of course(mock, '301').modules) for (const i of m.items) if (i.id === '7162') i.requirement = { type: 'min_score', min_score: 12, completed: true };
    assignment(mock, '301', '7109').submission = { ...assignment(mock, '301', '7109').submission, score: 13, grade: '13' };
    await sync();
    assert.equal(view(db, `${s}:a:7109`).status, 'done');
  } finally {
    await mock.close();
  }
});

test('work in a module that is still locked says what unlocks it; the course lists what is left to unlock', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const notes = view(db, `${s}:a:7108`).requirements!.notes;
    assert.ok(notes.some((n) => n.kind === 'locked' && /Week 8, Module 8/.test(n.text) && /Start Here/.test(n.text)));
    const res = await createApp(db).request(`http://127.0.0.1:4123/api/courses/${encodeURIComponent(`${s}:301`)}`);
    const body = await res.json() as { unlock: { module: string; title: string; type: string; minScore: number | null; htmlUrl: string | null }[] };
    assert.deepEqual(body.unlock.map((u) => [u.module, u.title, u.type]), [['Start Here', 'Read: Course Policies', 'must_view'], ['Start Here', 'Syllabus Quiz!', 'min_score']]);
    assert.equal(body.unlock[1].minScore, 12);
  } finally {
    await mock.close();
  }
});

test('work Canvas marked missing after grading it by itself is missing, not done', async () => {
  const { db, mock, s, sync } = await gamma();
  try {
    await sync();
    const lab = view(db, `${s}:a:7309`);
    assert.equal(getItem(db, `${s}:a:7309`)!.sub_state, 'graded');
    assert.equal(lab.status, 'missing');
  } finally {
    await mock.close();
  }
});

test('the after-sync cross-check still agrees with Canvas', async () => {
  const { mock, sync } = await gamma();
  try {
    const stats = await sync();
    assert.deepEqual(stats.errors, []);
    assert.deepEqual(stats.checks?.problems, []);
  } finally {
    await mock.close();
  }
});
