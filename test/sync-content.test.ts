import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getCourse } from '../src/db/courses.ts';
import { getItem } from '../src/db/items.ts';
import { getFile, getPage, getTopic, listConversations, listModuleItems, listModules } from '../src/db/content.ts';
import { pendingChanges } from '../src/db/changes.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { htmlToText } from '../src/util/html.ts';

async function synced(variant: 'alpha' | 'beta' = 'alpha') {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant, pageSize: 3 });
  const school = createSchool(db, { name: variant, base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  const stats = await syncSchool(db, school.id, { reason: 'test', relogin: null });
  return { db, mock, s: school.id, stats };
}

test('htmlToText keeps line structure and decodes entities', () => {
  assert.equal(htmlToText('<p>A<br>B</p><ul><li>x</li></ul>&amp;'), 'A\nB\n• x\n&');
  assert.equal(htmlToText('<script>alert(1)</script><h2>T&#39;s</h2><p>a&nbsp;&nbsp;b &lt;c&gt;</p>'), "T's\na b <c>");
});

test('modules and their items are stored in order with resolved references', async () => {
  const { db, mock, s, stats } = await synced();
  try {
    assert.deepEqual(stats.errors, []);
    const bio = `${s}:101`;
    const modules = listModules(db, bio);
    assert.equal(modules.length, 9);
    assert.equal(modules[5].name, 'Week 6: Cell Respiration');
    const items = listModuleItems(db, bio);
    const ref = (title: string) => items.find((i) => i.title === title)?.ref_id;
    assert.equal(ref('Homework 6: Cell Respiration'), `${s}:a:5002`);
    assert.equal(ref('Week 6 Slides'), `${s}:f:7001`);
    assert.equal(ref('Week 6 Overview'), `${s}:p:60`);
    assert.equal(ref('Reading Quiz 6'), `${s}:a:5004`);
    assert.equal(ref('Discussion: Ethics of GMOs'), `${s}:t:501`);
    assert.equal(ref('Krebs cycle video'), null);
    assert.ok(items.some((i) => i.module_id === `${s}:m:308`), 'week 8 items fetched through /modules/:id/items');
    assert.equal(getItem(db, `${s}:a:5002`)!.module_id, `${s}:m:306`);
  } finally {
    await mock.close();
  }
});

test('syllabus and visible tabs are stored on the course', async () => {
  const { db, mock, s } = await synced();
  try {
    const bio = getCourse(db, `${s}:101`)!;
    assert.match(bio.syllabus_html!, /BIO 3 Syllabus/);
    assert.ok(JSON.parse(bio.tabs!).includes('files'));
    assert.ok(!JSON.parse(getCourse(db, `${s}:102`)!.tabs!).includes('files'));
  } finally {
    await mock.close();
  }
});

test('page bodies are fetched once and only refetched when the page changes', async () => {
  const { db, mock, s } = await synced();
  try {
    const bodyFetches = () => mock.requests.filter((r) => r.path.startsWith('/api/v1/courses/101/pages/week-6-overview')).length;
    assert.equal(bodyFetches(), 1);
    assert.match(getPage(db, `${s}:p:60`)!.body_html!, /cellular respiration/);
    await syncSchool(db, s, { reason: 'test', relogin: null });
    assert.equal(bodyFetches(), 1);
    mock.data.courses[0].pages[1].updated_at = new Date().toISOString();
    mock.data.courses[0].pages[1].body = '<p>Updated body</p>';
    await syncSchool(db, s, { reason: 'test', relogin: null });
    assert.equal(bodyFetches(), 2);
    assert.equal(getPage(db, `${s}:p:60`)!.body_html, '<p>Updated body</p>');
  } finally {
    await mock.close();
  }
});

test('when the Files tab is hidden, files linked from modules are still found', async () => {
  const { db, mock, s } = await synced();
  try {
    const f = getFile(db, `${s}:f:7101`)!;
    assert.equal(f.name, 'Limits_Slides.pdf');
    assert.equal(f.course_id, `${s}:102`);
    assert.match(f.html_url, /\/courses\/102\/files\/7101$/);
    assert.equal(getFile(db, `${s}:f:7006`)!.size, 300 * 1024 * 1024);
  } finally {
    await mock.close();
  }
});

test('announcements and discussions are stored; a new announcement becomes a pending change', async () => {
  const { db, mock, s } = await synced();
  try {
    assert.equal(getTopic(db, `${s}:t:402`)!.kind, 'announcement');
    assert.equal(getTopic(db, `${s}:t:501`)!.assignment_item_id, `${s}:a:5006`);
    assert.equal(pendingChanges(db).length, 0);
    mock.data.courses[0].topics.push({ id: '403', title: 'Lab moved to room 210', message: '<p>Room change</p>', posted_at: new Date().toISOString(), author: 'Dr. Rivera', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 });
    await syncSchool(db, s, { reason: 'test', relogin: null });
    const changes = pendingChanges(db);
    assert.equal(changes.length, 1);
    assert.equal(changes[0].kind, 'announcement');
    assert.equal(changes[0].ref_id, `${s}:t:403`);
  } finally {
    await mock.close();
  }
});

test('inbox conversations are listed without opening (marking read) any of them', async () => {
  const { db, mock, s } = await synced('beta');
  try {
    const convs = listConversations(db, s);
    assert.equal(convs.length, 2);
    assert.equal(convs[0].subject, 'Question about Chapter 5');
    assert.equal(convs[0].workflow_state, 'unread');
    assert.equal(mock.requests.filter((r) => /\/conversations\/\d+/.test(r.path)).length, 0);
  } finally {
    await mock.close();
  }
});

test('modules deleted in Canvas disappear locally', async () => {
  const { db, mock, s } = await synced();
  try {
    mock.data.courses[0].modules = mock.data.courses[0].modules.filter((m) => m.id !== '399');
    await syncSchool(db, s, { reason: 'test', relogin: null });
    assert.equal(listModules(db, `${s}:101`).length, 8);
  } finally {
    await mock.close();
  }
});
