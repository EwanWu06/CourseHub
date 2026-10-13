import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { run } from '../src/db/sql.ts';
import { listNotices, markNoticesRead, pruneNotices, recordNotice, unreadNotices } from '../src/db/notices.ts';
import { notify, setNoticeRecorder, setNotifier } from '../src/notify/mac.ts';
import type { Notice } from '../src/notify/mac.ts';

test('notices are kept with their kind and link, newest first, until read and pruned', () => {
  tmpDataDir();
  const db = openDb();
  recordNotice(db, { kind: 'reminder', title: '3 小时内截止', body: 'BIO 3 · HW 6', url: 'https://alpha/hw' });
  recordNotice(db, { kind: 'change', title: '新公告 · BIO 3', subtitle: 'sub', body: 'Lab moved' });
  const list = listNotices(db, 10);
  assert.deepEqual(list.map((n) => n.title), ['新公告 · BIO 3', '3 小时内截止']);
  assert.equal(list[1].url, 'https://alpha/hw');
  assert.equal(list[1].kind, 'reminder');
  assert.equal(list[0].subtitle, 'sub');
  assert.equal(unreadNotices(db), 2);
  markNoticesRead(db);
  assert.equal(unreadNotices(db), 0);
  run(db, "UPDATE notices SET created_at = '2026-01-01T00:00:00.000Z' WHERE kind = 'change'");
  pruneNotices(db, '2026-06-01T00:00:00.000Z');
  assert.deepEqual(listNotices(db, 10).map((n) => n.kind), ['reminder']);
});

test('every notify() is recorded, even when the banner itself fails', async () => {
  const seen: Notice[] = [];
  setNoticeRecorder((n) => { seen.push(n); });
  setNotifier(async () => { throw new Error('banner failed'); });
  await notify({ kind: 'system', title: 't', body: 'b' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].kind, 'system');
  setNotifier(null);
  setNoticeRecorder(null);
});
