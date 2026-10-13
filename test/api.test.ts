import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import type { MockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { createApp } from '../src/server/app.ts';

let mock: MockCanvas;
let db: DB;
let app: ReturnType<typeof createApp>;
const syncCalls: unknown[] = [];
const loginCalls: string[] = [];
const guideCalls: [string, number, boolean][] = [];
let releaseSync: () => void = () => {};

before(async () => {
  tmpDataDir();
  db = openDb();
  mock = await startMockCanvas({ variant: 'alpha' });
  const school = createSchool(db, { name: 'alpha', base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  await syncSchool(db, school.id, { reason: 'test', relogin: null });
  app = createApp(db, {
    runSync: async (_db, opts) => {
      syncCalls.push(opts);
      await new Promise<void>((r) => { releaseSync = r; });
      return {};
    },
    enqueueGuide: (courseId, week, force) => {
      guideCalls.push([courseId, week, force]);
      return true;
    },
    startLogin: async (_db, schoolId) => {
      loginCalls.push(schoolId);
      return { ok: false, message: 'test double: no follow-up sync' };
    },
  });
});

after(async () => {
  releaseSync();
  await mock.close();
});

const BASE = 'http://127.0.0.1:4123';
function call(path: string, init: { method?: string; body?: unknown; header?: boolean; host?: string } = {}) {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';
  if (init.header ?? init.method !== undefined) headers['X-CourseHub'] = '1';
  return app.request(`${init.host ? `http://${init.host}` : BASE}${path}`, {
    method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}
async function json<T = any>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

test('health answers on the loopback host only', async () => {
  assert.deepEqual(await json(await call('/api/health')), { ok: true });
  assert.equal((await call('/api/health', { host: 'evil.com:4123' })).status, 403);
  assert.equal((await call('/api/health', { host: 'localhost:4123' })).status, 200);
});

test('state-changing requests need the X-CourseHub header and a local Origin', async () => {
  const body = { title: 'Achieve HW 4', dueAt: new Date(Date.now() + 86_400_000).toISOString() };
  assert.equal((await call('/api/items', { method: 'POST', body, header: false })).status, 403);
  const res = await app.request(`${BASE}/api/items`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CourseHub': '1', Origin: 'https://evil.com' }, body: JSON.stringify(body) });
  assert.equal(res.status, 403);
});

test('overview groups what needs attention', async () => {
  const o = await json(await call('/api/overview'));
  const titles = (list: { title: string }[]) => list.map((t) => t.title);
  assert.ok(titles(o.today).includes('Homework 6: Cell Respiration'));
  assert.ok(titles(o.overdue).includes('Lab Report 2'));
  assert.ok(!titles(o.overdue).includes('Lab safety signature'), 'on-paper work is not overdue');
  assert.ok(!titles(o.overdue).includes('Homework 4'), 'excused work is not overdue');
  assert.ok(titles(o.next3).includes('Reading Quiz 6'));
  assert.ok(o.counts.missing >= 1);
  assert.equal(o.schools.length, 1);
  assert.ok(o.announcements.some((a: { title: string }) => a.title === 'Midterm review session'));
  assert.deepEqual(o.exams.map((e: { title: string }) => e.title), ['Midterm Exam'], 'upcoming exams within 30 days');
  const lab2 = o.overdue.find((t: { title: string }) => t.title === 'Lab Report 2');
  assert.equal(lab2.status, 'missing');
  assert.equal(lab2.courseName, 'BIO 3');
  assert.match(lab2.htmlUrl, /\/courses\/101\/assignments\/5005$/);
});

test('manual tasks: create, mark done, delete; Canvas items cannot be deleted', async () => {
  const created = await call('/api/items', { method: 'POST', body: { title: 'Achieve HW 4', courseId: 'alpha:101', dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), htmlUrl: 'https://achieve.macmillanlearning.com' } });
  assert.equal(created.status, 201);
  const task = await json(created);
  assert.equal(task.source, 'manual');
  assert.equal(task.courseName, 'BIO 3');
  const done = await json(await call(`/api/items/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { localDone: true } }));
  assert.equal(done.status, 'done');
  assert.equal((await call(`/api/items/${encodeURIComponent('alpha:a:5002')}`, { method: 'DELETE' })).status, 400);
  assert.equal((await call(`/api/items/${encodeURIComponent(task.id)}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call('/api/items', { method: 'POST', body: { title: '' } })).status, 400);
});

test('items list filters done work unless asked', async () => {
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 60 * 86_400_000).toISOString();
  const open = await json<{ title: string; status: string }[]>(await call(`/api/items?from=${from}&to=${to}`));
  assert.ok(open.every((t) => t.status !== 'done'));
  const all = await json<{ title: string; status: string }[]>(await call(`/api/items?from=${from}&to=${to}&includeDone=1`));
  assert.ok(all.some((t) => t.title === 'Homework 5' && t.status === 'done'));
  const undated = await json<{ title: string }[]>(await call('/api/items/undated'));
  assert.ok(undated.some((t) => t.title === 'Extra credit essay'));
});

test('courses and course content endpoints', async () => {
  const cards = await json<{ course: { id: string; code: string }; nextDue: { title: string } | null }[]>(await call('/api/courses'));
  assert.deepEqual(cards.map((c) => c.course.code).sort(), ['BIO 3', 'ENGL 1A', 'MATH 7']);
  assert.ok(cards.find((c) => c.course.code === 'BIO 3')!.nextDue);
  const detail = await json(await call('/api/courses/alpha:101'));
  assert.equal(detail.course.name, 'BIO 3 - General Biology');
  assert.equal(detail.currentWeek, 6);
  const modules = await json<{ module: { name: string }; items: { title: string; ref: { kind: string } | null }[] }[]>(await call('/api/courses/alpha:101/modules'));
  assert.equal(modules.length, 9);
  const w6 = modules.find((m) => m.module.name.startsWith('Week 6'))!;
  assert.equal(w6.items.find((i) => i.title === 'Week 6 Slides')!.ref!.kind, 'file');
  const files = await json<{ name: string; text_status: string; html_url: string }[]>(await call('/api/courses/alpha:101/files'));
  assert.ok(files.some((f) => f.name === 'Week6_Cell_Respiration.pdf' && f.text_status === 'ok'));
  const grades = await json(await call('/api/courses/alpha:101/grades'));
  assert.equal(grades.score, 92.3);
  assert.ok(grades.items.some((g: { title: string; score: number | null }) => g.title === 'Homework 5' && g.score === 9));
  const syllabus = await json(await call('/api/courses/alpha:101/syllabus'));
  assert.match(syllabus.html, /BIO 3 Syllabus/);
  assert.ok(syllabus.files.some((f: { name: string }) => f.name === 'Syllabus_BIO3.pdf'));
  const ann = await json<{ title: string }[]>(await call('/api/courses/alpha:101/announcements'));
  assert.equal(ann[0].title, 'Midterm review session');
  assert.equal((await call('/api/courses/nope:1')).status, 404);
});

test('pages are served with Canvas HTML rewritten for local viewing', async () => {
  const page = await json(await call('/api/pages/alpha:p:60'));
  assert.match(page.page.body_html, /\/proxy\/alpha\/courses\/101\/files\/7001\/preview/);
  assert.match(page.page.body_html, /\/courses\/alpha:101\/pages\/alpha:p:61/);
  assert.doesNotMatch(page.page.body_html, /<script/);
});

test('course settings can be changed', async () => {
  const res = await call('/api/courses/alpha:103', { method: 'PATCH', body: { nickname: '英文写作', hidden: true } });
  assert.equal(res.status, 200);
  const cards = await json<{ course: { id: string } }[]>(await call('/api/courses'));
  assert.ok(!cards.some((c) => c.course.id === 'alpha:103'));
  const all = await json<{ course: { id: string; nickname: string } }[]>(await call('/api/courses?all=1'));
  assert.equal(all.find((c) => c.course.id === 'alpha:103')!.course.nickname, '英文写作');
  await call('/api/courses/alpha:103', { method: 'PATCH', body: { hidden: false } });
});

test('proxy serves only whitelisted Canvas media', async () => {
  assert.equal((await call('/proxy/alpha/api/v1/users/self')).status, 404);
  const img = await call('/proxy/alpha/courses/101/files/7001/preview');
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.match(img.headers.get('cache-control')!, /private/);
  assert.ok((await img.arrayBuffer()).byteLength > 0);
  assert.equal((await call('/proxy/nope/equation_images/x')).status, 404);
});

test('schools: list with health info, create with validation', async () => {
  const schools = await json<{ id: string; failStreak: number; loginState: { status: string }; hasAuth: boolean }[]>(await call('/api/schools'));
  assert.equal(schools[0].id, 'alpha');
  assert.equal(schools[0].failStreak, 0);
  assert.equal(schools[0].loginState.status, 'idle');
  assert.equal(schools[0].hasAuth, true);
  assert.equal((await call('/api/schools', { method: 'POST', body: { name: 'Bad', baseUrl: 'not a url' } })).status, 400);
  const created = await call('/api/schools', { method: 'POST', body: { name: 'Pasadena City College', baseUrl: 'canvas.pasadena.edu' } });
  assert.equal(created.status, 201);
  const s = await json(created);
  assert.equal(s.base_url, 'https://canvas.pasadena.edu');
  const patched = await json(await call(`/api/schools/${s.id}`, { method: 'PATCH', body: { icsUrl: 'https://canvas.pasadena.edu/feeds/calendars/user_x.ics', links: [{ label: '学生门户', url: 'https://portal.pasadena.edu' }] } }));
  assert.equal(patched.ics_url, 'https://canvas.pasadena.edu/feeds/calendars/user_x.ics');
  assert.deepEqual(patched.links, [{ label: '学生门户', url: 'https://portal.pasadena.edu' }]);
  assert.equal((await call(`/api/schools/${s.id}`, { method: 'DELETE' })).status, 200);
});

test('login starts in the background and its state can be polled', async () => {
  const res = await call('/api/schools/alpha/login', { method: 'POST' });
  assert.equal(res.status, 202);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(loginCalls, ['alpha']);
  const state = await json(await call('/api/schools/alpha/login'));
  assert.ok(['idle', 'waiting', 'success', 'failed'].includes(state.status));
});

test('sync runs in the background; a second request while running is refused', async () => {
  assert.equal((await call('/api/sync', { method: 'POST', body: {} })).status, 202);
  assert.equal((await call('/api/sync', { method: 'POST', body: {} })).status, 409);
  const status = await json(await call('/api/sync'));
  assert.equal(status.running, true);
  assert.ok(status.recent.length >= 1);
  releaseSync();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal((await json(await call('/api/sync'))).running, false);
  assert.equal(syncCalls.length, 1);
});

test('settings validate input and merge', async () => {
  assert.equal((await call('/api/settings', { method: 'PUT', body: { dailyTime: '25:99' } })).status, 400);
  assert.equal((await call('/api/settings', { method: 'PUT', body: { aiModel: 'gpt' } })).status, 400);
  const s = await json(await call('/api/settings', { method: 'PUT', body: { dailyTime: '06:30', aiModel: 'opus' } }));
  assert.equal(s.dailyTime, '06:30');
  assert.equal(s.weeklyTime, '20:00');
  assert.equal((await json(await call('/api/settings'))).aiModel, 'opus');
});

test('study endpoints list weeks, show a week\'s materials and queue generation', async () => {
  const index = await json<{ course: { id: string }; currentWeek: number }[]>(await call('/api/study'));
  assert.equal(index.find((c) => c.course.id === 'alpha:101')!.currentWeek, 6);
  const course = await json(await call('/api/study/alpha:101'));
  assert.equal(course.weeks.length, 16);
  const w6 = course.weeks.find((w: { week: number }) => w.week === 6);
  assert.ok(w6.materialCount > 0);
  assert.equal(w6.guide, null);
  const week = await json(await call('/api/study/alpha:101/6'));
  const pdf = week.materials.find((m: { title: string }) => m.title === 'Week6_Cell_Respiration.pdf');
  assert.ok(pdf.hasText);
  assert.match(pdf.url, /\/courses\/101\/files\/7001$/);
  assert.ok(week.assignments.some((a: { title: string; dueAt: string }) => a.title === 'Homework 6: Cell Respiration' && a.dueAt));
  assert.equal(week.guide.status, null);
  assert.equal((await call('/api/study/alpha:101/6/generate', { method: 'POST', body: { force: true } })).status, 202);
  assert.deepEqual(guideCalls, [['alpha:101', 6, true]]);
  assert.equal((await call('/api/study/alpha:101/99')).status, 404);
});

test('not-yet-built features answer 501; unknown API paths 404; the app shell is served', async () => {
  assert.equal((await call('/api/reports')).status, 501);
  assert.equal((await call('/api/nope')).status, 404);
  const page = await call('/today');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type')!, /text\/html/);
});

test('category can be corrected by hand and is validated', async () => {
  const res = await call(`/api/items/${encodeURIComponent('alpha:a:5002')}`, { method: 'PATCH', body: { category: 'exam' } });
  const t = await json(res);
  assert.equal(t.category, 'exam');
  assert.equal(t.categorySource, 'user');
  assert.equal((await call(`/api/items/${encodeURIComponent('alpha:a:5002')}`, { method: 'PATCH', body: { category: 'nonsense' } })).status, 400);
  await call(`/api/items/${encodeURIComponent('alpha:a:5002')}`, { method: 'PATCH', body: { category: null } });
  const reset = await json(await call(`/api/items/${encodeURIComponent('alpha:a:5002')}`, { method: 'PATCH', body: {} }));
  assert.notEqual(reset.categorySource, 'user', 'resetting hands the decision back to the automatic classifier');
  assert.equal(reset.category, 'homework');
});

test('syllabus analysis state is exposed and can be re-run on demand', async () => {
  const syl = await json(await call('/api/courses/alpha:101/syllabus'));
  assert.ok('analysis' in syl);
  const res = await call('/api/courses/alpha:101/analyze', { method: 'POST' });
  assert.equal(res.status, 202);
});
