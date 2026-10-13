import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { upsertCourse } from '../src/db/courses.ts';
import { getItem, upsertItem } from '../src/db/items.ts';
import { addChange } from '../src/db/changes.ts';
import { saveReport, getReport } from '../src/db/reports.ts';
import { upsertFile } from '../src/db/content.ts';
import { all, one, run } from '../src/db/sql.ts';
import { loadText, saveText } from '../src/content/textstore.ts';
import { maintainDb, pruneOldData, trimBrowserCache } from '../src/maintenance.ts';

const NOW = new Date('2026-10-12T20:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

function world() {
  tmpDataDir();
  const db = openDb();
  const s = createSchool(db, { name: 'A', base_url: 'a.instructure.com' });
  upsertCourse(db, {
    id: 'a:1', school_id: s.id, canvas_id: '1', name: 'BIO', code: 'BIO 1', term_name: null, start_at: null, end_at: null, html_url: 'https://a/c/1',
    syllabus_html: null, tabs: null, current_score: null, current_grade: null, active: 1, updated_at: NOW.toISOString(),
  });
  const item = (id: string) => upsertItem(db, {
    id, school_id: s.id, course_id: 'a:1', kind: 'assignment', title: id, due_at: daysAgo(1), end_at: null, unlock_at: null, lock_at: null, points: 1,
    html_url: null, provider: 'canvas', description_html: null, submission_types: null, sub_state: null, submitted_at: null, missing: 0, late: 0,
    excused: 0, score: null, grade: null, canvas_done: 0, source: 'api', module_id: null, group_id: null,
  });
  return { db, school: s.id, item };
}

test('old bookkeeping is pruned; anything recent or still pending is kept', () => {
  const { db, school, item } = world();
  item('a:a:old-gone');
  item('a:a:recent-gone');
  item('a:a:live');
  run(db, "UPDATE items SET removed = 1, updated_at = $at WHERE id = 'a:a:old-gone'", { at: daysAgo(200) });
  run(db, "UPDATE items SET removed = 1, updated_at = $at WHERE id = 'a:a:recent-gone'", { at: daysAgo(10) });
  for (const [ref, notified, age] of [['old-sent', 1, 130], ['old-pending', 0, 130], ['new', 1, 5]] as const) {
    addChange(db, { school_id: school, course_id: 'a:1', kind: 'announcement', ref_id: ref, summary: ref, data: '{}', notified });
    run(db, 'UPDATE changes SET created_at = $at WHERE ref_id = $ref', { at: daysAgo(age), ref });
  }
  run(db, "INSERT INTO reminders_sent (item_id, threshold, sent_at) VALUES ('x', '24', $old), ('y', '24', $new)", { old: daysAgo(130), new: daysAgo(3) });
  saveReport(db, { type: 'daily', period: '2025-08-01', content: '{}' });
  saveReport(db, { type: 'daily', period: '2026-10-01', content: '{}' });
  saveReport(db, { type: 'weekly', period: '2025-08-04', content: '{}' });
  upsertFile(db, { id: 'a:f:live', course_id: 'a:1', canvas_id: 'live', name: 'live.pdf', content_type: 'application/pdf', size: 1, updated_at: null, html_url: 'https://a/f' });
  const text = (fileId: string) => saveText({ fileId, name: fileId, kind: 'pdf', pages: ['p'], scanned: false, extractedAt: daysAgo(1), sourceUpdatedAt: null });
  text('a:f:live');
  text('a:f:orphan');

  const r = pruneOldData(db, NOW);
  assert.equal(getItem(db, 'a:a:old-gone'), undefined, 'gone from Canvas half a year ago');
  assert.ok(getItem(db, 'a:a:recent-gone'));
  assert.ok(getItem(db, 'a:a:live'));
  assert.deepEqual(all<{ ref_id: string }>(db, 'SELECT ref_id FROM changes ORDER BY ref_id').map((c) => c.ref_id), ['new', 'old-pending']);
  assert.deepEqual(all<{ item_id: string }>(db, 'SELECT item_id FROM reminders_sent').map((x) => x.item_id), ['y']);
  assert.equal(getReport(db, 'daily:2025-08-01'), undefined);
  assert.ok(getReport(db, 'daily:2026-10-01'));
  assert.ok(getReport(db, 'weekly:2025-08-04'), 'weekly reports are kept');
  assert.ok(loadText('a:f:live'));
  assert.equal(loadText('a:f:orphan'), null, 'text of a file Canvas no longer has');
  assert.ok(r.changes >= 1 && r.reports >= 1 && r.items >= 1 && r.texts >= 1);
});

test('database upkeep checkpoints the WAL and runs without error', () => {
  const { db } = world();
  maintainDb(db, NOW);
  assert.equal(one<{ ok: string }>(db, 'PRAGMA quick_check')?.ok ?? Object.values(db.prepare('PRAGMA quick_check').get() as object)[0], 'ok');
});

test('the browser cache is trimmed but logins (cookies, local storage) are kept — and never while Chrome runs', () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'profile-'));
  const mk = (p: string) => {
    mkdirSync(path.join(profile, p), { recursive: true });
    writeFileSync(path.join(profile, p, 'data'), 'x'.repeat(1000));
  };
  for (const p of ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'GraphiteDawnCache', 'component_crx_cache', 'BrowserMetrics', 'Default/Local Storage']) mk(p);
  writeFileSync(path.join(profile, 'Default', 'Cookies'), 'cookies');

  assert.equal(trimBrowserCache(profile, { chromeRunning: () => true }).trimmed, false);
  assert.ok(existsSync(path.join(profile, 'Default/Cache')));

  const r = trimBrowserCache(profile, { chromeRunning: () => false });
  assert.equal(r.trimmed, true);
  assert.ok(r.freedBytes >= 6000);
  for (const p of ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'GraphiteDawnCache', 'component_crx_cache', 'BrowserMetrics']) assert.ok(!existsSync(path.join(profile, p)), p);
  assert.ok(existsSync(path.join(profile, 'Default', 'Cookies')));
  assert.ok(existsSync(path.join(profile, 'Default/Local Storage')));
});
