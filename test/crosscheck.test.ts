// After every sync, Canvas's own lists are a second opinion on what Course Hub stored.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getItem } from '../src/db/items.ts';
import { run } from '../src/db/sql.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { crossCheck } from '../src/sync/crosscheck.ts';
import { createApp } from '../src/server/app.ts';
import type { AchieveReader } from '../src/platforms/achieve.ts';

const readAchieve: AchieveReader = async () => ({ items: [], statuses: {} });

async function synced(variant: 'alpha' | 'gamma' = 'gamma') {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant, pageSize: 3 });
  const school = createSchool(db, { name: 'G', base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  return { db, mock, s: school.id, sync: () => syncSchool(db, school.id, { reason: 'test', relogin: null, readAchieve }) };
}

test('every sync checks Course Hub against Canvas\'s planner, to-do list, calendar feed and missing list — all agree', async () => {
  for (const variant of ['alpha', 'gamma'] as const) {
    const { mock, sync } = await synced(variant);
    try {
      const stats = await sync();
      assert.ok(stats.checks, variant);
      assert.deepEqual(stats.checks.problems, [], variant);
      assert.ok(stats.checks.sources.planner > 0 && stats.checks.sources.ics > 0 && stats.checks.sources.todo > 0, `${variant}: ${JSON.stringify(stats.checks.sources)}`);
    } finally {
      await mock.close();
    }
  }
});

test('a kind of Canvas to-do Course Hub does not know yet is reported, not silently skipped', async () => {
  const { mock, sync } = await synced();
  try {
    mock.data.plannerExtras.push({ type: 'discussion_checkin', id: '9901', course_id: '301', title: 'Weekly check-in', todo_date: new Date(Date.now() + 86_400_000).toISOString() });
    const stats = await sync();
    assert.equal(stats.checks!.problems.length, 1);
    assert.match(stats.checks!.problems[0], /Weekly check-in.*discussion_checkin/);
  } finally {
    await mock.close();
  }
});

test('Canvas still expecting work that Course Hub shows as handed in is reported; the student\'s own tick is not', async () => {
  const { db, mock, s, sync } = await synced();
  try {
    await sync();
    run(db, "UPDATE items SET sub_state = 'submitted' WHERE id = $id", { id: `${s}:a:7301` }); // a mapping mistake
    run(db, 'UPDATE items SET local_done = 1 WHERE id = $id', { id: `${s}:a:7103` }); // the student's own choice
    const evidence = { todo: (await (await fetch(`${mock.baseUrl}/api/v1/users/self/todo`, { headers: { Cookie: mock.sessionCookieHeader() } })).text()) };
    const todo = JSON.parse(evidence.todo.replace(/^while\(1\);/, ''));
    const res = crossCheck(db, getSchoolRow(db, s), new Date(), { todo });
    assert.deepEqual(res.problems.length, 1, res.problems.join('\n'));
    assert.match(res.problems[0], /Chapter 18 Homework/);
    assert.ok(getItem(db, `${s}:a:7301`));
  } finally {
    await mock.close();
  }
});

test('problems that persist across two syncs show on the status page', async () => {
  const { db, mock, sync } = await synced();
  try {
    mock.data.plannerExtras.push({ type: 'discussion_checkin', id: '9901', course_id: '301', title: 'Weekly check-in', todo_date: new Date(Date.now() + 86_400_000).toISOString() });
    const app = createApp(db);
    const issues = async () => ((await (await app.request('http://127.0.0.1:4123/api/status')).json()) as { issues: { kind: string; text: string }[] }).issues;
    await sync();
    assert.ok(!(await issues()).some((i) => i.kind === 'crosscheck'), 'one sync could be a moment of Canvas changing under us');
    await sync();
    assert.ok((await issues()).some((i) => i.kind === 'crosscheck' && /Weekly check-in/.test(i.text)));
  } finally {
    await mock.close();
  }
});

import { getSchool } from '../src/db/schools.ts';
const getSchoolRow = (db: ReturnType<typeof openDb>, id: string) => getSchool(db, id)!;
