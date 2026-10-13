import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import type { MockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool, getSchool, updateSchool } from '../src/db/schools.ts';
import { getCourse, listCourses } from '../src/db/courses.ts';
import { getItem } from '../src/db/items.ts';
import { pendingChanges } from '../src/db/changes.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';

async function setup(variant: 'alpha' | 'beta', opts: { auth?: boolean } = {}) {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant, pageSize: 3 });
  const school = createSchool(db, { name: variant === 'alpha' ? 'Alpha' : 'Beta', base_url: mock.baseUrl });
  if (opts.auth ?? true) saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  return { db, mock, schoolId: school.id };
}

function count(db: DB, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

async function done(mock: MockCanvas) {
  await mock.close();
}

test('full API sync stores active courses and every dated item with the right kind and status', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    const stats = await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    assert.equal(stats.mode, 'api');
    assert.deepEqual(stats.errors, []);
    assert.deepEqual(listCourses(db).map((c) => c.code).sort(), ['BIO 3', 'ENGL 1A', 'MATH 7']);
    assert.notEqual(getCourse(db, `${schoolId}:104`)?.active, 1); // concluded: excluded (not stored, or inactive)
    assert.equal(getCourse(db, `${schoolId}:105`), undefined);

    const it = (id: string) => getItem(db, `${schoolId}:${id}`)!;
    assert.equal(it('a:5002').kind, 'assignment');
    assert.equal(it('a:5002').sub_state, 'unsubmitted');
    assert.equal(it('a:5004').kind, 'quiz');
    assert.equal(it('a:5006').kind, 'discussion');
    assert.equal(it('a:5006').canvas_done, 1);
    assert.equal(it('a:5007').provider, 'macmillan');
    assert.equal(it('a:6001').provider, 'webassign');
    assert.equal(it('a:5005').missing, 1);
    assert.equal(it('a:5010').excused, 1);
    assert.equal(it('a:5001').score, 9);
    assert.equal(it('a:5001').sub_state, 'graded');
    assert.equal(it('a:5009').due_at, null);
    assert.equal(it('q:801').kind, 'quiz');
    assert.equal(getItem(db, `${schoolId}:q:802`), undefined);
    assert.equal(it('e:9001').kind, 'event');
    assert.equal(it('e:9001').title, 'Midterm Exam');
    assert.equal(it('n:71').kind, 'note');
    assert.equal(it('w:61').kind, 'page');
    assert.match(it('w:61').html_url!, /^http:\/\/127\.0\.0\.1:\d+\/courses\/101\/pages\/week-7-overview$/);

    const school = getSchool(db, schoolId)!;
    assert.equal(school.status, 'ok');
    assert.equal(school.user_name, 'Ewan Wu');
    assert.equal(school.ics_url, `${mock.baseUrl}/feeds/calendars/user_alpha-ics-token.ics`);
    assert.ok(school.last_ok_at);
    assert.deepEqual(mock.requests.filter((r) => r.method !== 'GET'), []);
  } finally {
    await done(mock);
  }
});

test('term dates stand in for missing course dates', async () => {
  const { db, mock, schoolId } = await setup('beta');
  try {
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    const psych = getCourse(db, `${schoolId}:201`)!;
    assert.equal(psych.start_at, mock.data.courses[0].term.start_at);
    assert.equal(psych.term_name, 'Fall 2026');
  } finally {
    await done(mock);
  }
});

test('first sync is a silent baseline; later due-date moves become pending changes', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    assert.equal(pendingChanges(db).length, 0);
    const hw6 = mock.data.courses[0].assignments.find((a) => a.id === '5002')!;
    const old = hw6.due_at;
    hw6.due_at = new Date(Date.parse(old!) - 86_400_000).toISOString();
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    const changes = pendingChanges(db);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'due_changed');
    assert.equal(changes[0].ref_id, `${schoolId}:a:5002`);
    assert.deepEqual(JSON.parse(changes[0].data), { from: old, to: hw6.due_at });
  } finally {
    await done(mock);
  }
});

test('session expiring mid-sync keeps existing data, flags the school and falls back to ICS', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    const before = count(db, 'SELECT COUNT(*) AS n FROM items WHERE school_id = ? AND removed = 0', schoolId);
    mock.expireAfter(4);
    let loginNeeded = 0;
    const stats = await syncSchool(db, schoolId, { reason: 'test', relogin: null, onLoginNeeded: () => { loginNeeded++; } });
    assert.equal(stats.mode, 'ics');
    assert.equal(loginNeeded, 1);
    assert.equal(getSchool(db, schoolId)!.status, 'needs_login');
    assert.equal(count(db, 'SELECT COUNT(*) AS n FROM items WHERE school_id = ? AND removed = 0', schoolId), before);
    assert.equal(getItem(db, `${schoolId}:a:5002`)!.removed, 0);
  } finally {
    await done(mock);
  }
});

test('one assignment seen by the assignments API, planner and ICS is stored once', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM items WHERE id LIKE '%:5002'"), 1);
    assert.equal(getItem(db, `${schoolId}:a:5002`)!.source, 'api');
    assert.equal(getItem(db, `${schoolId}:d:501`), undefined);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM items WHERE title = 'Reading Quiz 6'"), 1);
  } finally {
    await done(mock);
  }
});

test('without a login the ICS feed still provides deadlines', async () => {
  const { db, mock, schoolId } = await setup('beta', { auth: false });
  try {
    updateSchool(db, schoolId, { ics_url: `${mock.baseUrl}/feeds/calendars/user_beta-ics-token.ics` });
    const stats = await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    assert.equal(stats.mode, 'ics');
    const quiz = getItem(db, `${schoolId}:a:8001`)!;
    assert.equal(quiz.source, 'ics');
    assert.equal(quiz.sub_state, 'unknown');
    assert.equal(quiz.course_id, null);
    assert.equal(quiz.title, 'Chapter 5 Quiz [PSYCH 1]');
  } finally {
    await done(mock);
  }
});

test('a successful re-login retries the sync through the API', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    mock.expireSessions();
    let calls = 0;
    const stats = await syncSchool(db, schoolId, {
      reason: 'test',
      relogin: async (id) => {
        calls++;
        saveAuth({ schoolId: id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
        return true;
      },
    });
    assert.equal(calls, 1);
    assert.equal(stats.mode, 'api');
    assert.equal(getSchool(db, schoolId)!.status, 'ok');
  } finally {
    await done(mock);
  }
});

test('assignments deleted in Canvas are flagged removed; planner-only items are kept', async () => {
  const { db, mock, schoolId } = await setup('alpha');
  try {
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    const bio = mock.data.courses[0];
    bio.assignments = bio.assignments.filter((a) => a.id !== '5011');
    await syncSchool(db, schoolId, { reason: 'test', relogin: null });
    assert.equal(getItem(db, `${schoolId}:a:5011`)!.removed, 1);
    assert.equal(getItem(db, `${schoolId}:q:801`)!.removed, 0);
    assert.equal(getItem(db, `${schoolId}:n:71`)!.removed, 0);
    assert.equal(getItem(db, `${schoolId}:a:5002`)!.removed, 0);
  } finally {
    await done(mock);
  }
});
