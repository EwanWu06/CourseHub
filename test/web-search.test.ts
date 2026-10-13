import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchEntries } from '../web/src/lib/search.ts';

test('search results become one list of places to go, in group order', () => {
  const now = new Date('2026-10-12T10:00:00-07:00');
  const entries = searchEntries({
    groups: [
      { kind: 'tasks', items: [{ id: 'a:1', title: 'HW 6', courseName: 'BIO 3', dueAt: '2026-10-13T06:59:00Z', dueDateOnly: false, htmlUrl: 'https://x/a/1' }] },
      { kind: 'courses', items: [{ id: 'a:101', displayName: 'BIO 3', name: 'BIO 3 - General Biology', schoolName: 'Alpha' }] },
      { kind: 'files', items: [{ id: 'a:f:1', name: 'Week6.pdf', courseName: 'BIO 3', courseId: 'a:101', htmlUrl: 'https://x/files/1' }] },
      { kind: 'pages', items: [{ id: 'a:p:60', title: 'Week 6 Overview', courseName: 'BIO 3', courseId: 'a:101', htmlUrl: 'https://x/pages/w6' }] },
      { kind: 'topics', items: [{ id: 'a:t:402', title: 'Midterm review', kind: 'announcement', courseName: 'BIO 3', courseId: 'a:101', htmlUrl: 'https://x/t/402' }] },
    ],
  }, now);
  assert.deepEqual(entries.map((e) => e.group), ['作业和考试', '课程', '文件', '页面', '公告和讨论']);
  assert.deepEqual(entries[0].target, { external: 'https://x/a/1' });
  assert.equal(entries[0].sub, 'BIO 3 · 今天 23:59');
  assert.deepEqual(entries[1].target, { internal: '/courses/a:101' });
  assert.deepEqual(entries[2].target, { external: 'https://x/files/1' });
  assert.deepEqual(entries[3].target, { internal: '/courses/a:101/pages/a%3Ap%3A60' });
  assert.deepEqual(entries[4].target, { internal: '/courses/a:101/announcements' });
});
