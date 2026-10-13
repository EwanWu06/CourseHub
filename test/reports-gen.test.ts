import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { upsertCourse } from '../src/db/courses.ts';
import { upsertItem, setLocalDone, setItemCategory } from '../src/db/items.ts';
import type { ItemUpsert } from '../src/db/items.ts';
import { updateSettings } from '../src/db/settings.ts';
import { setNotifier } from '../src/notify/mac.ts';
import type { Notice } from '../src/notify/mac.ts';
import { generateDaily } from '../src/reports/daily.ts';
import type { DailyReport } from '../src/reports/daily.ts';
import { generateWeekly } from '../src/reports/weekly.ts';
import type { WeeklyReport } from '../src/reports/weekly.ts';
import { headlineOf, refreshReport } from '../src/reports/view.ts';

let db: DB;
let rec: string;
let queue: string;
const notices: Notice[] = [];
const NOW = new Date('2026-11-01T16:00:00Z'); // Sun Nov 1, 08:00 PST

beforeEach(() => {
  tmpDataDir();
  db = openDb();
  rec = mkdtempSync(path.join(tmpdir(), 'fake-claude-'));
  queue = mkdtempSync(path.join(tmpdir(), 'fake-claude-q-'));
  process.env.FAKE_CLAUDE_DIR = rec;
  process.env.FAKE_CLAUDE_QUEUE = queue;
  process.env.FAKE_CLAUDE_MODE = 'ok';
  notices.length = 0;
  setNotifier(async (n) => { notices.push(n); });
  const school = createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  const course = `${school.id}:101`;
  upsertCourse(db, {
    id: course, school_id: school.id, canvas_id: '101', name: 'Biology 3', code: 'BIO 3', term_name: null, start_at: null, end_at: null,
    html_url: `${school.base_url}/courses/101`, syllabus_html: null, tabs: null, current_score: null, current_grade: null, active: 1,
    updated_at: new Date().toISOString(),
  });
  const add = (id: string, patch: Partial<ItemUpsert>) => upsertItem(db, {
    id, school_id: school.id, course_id: course, kind: 'assignment', title: id, due_at: null, end_at: null, unlock_at: null, lock_at: null,
    points: 10, html_url: `https://alpha/${id}`, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
    sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0,
    source: 'api', module_id: null, group_id: null, ...patch,
  });
  add('tonight', { title: 'HW 5', due_at: '2026-11-02T07:59:00Z' }); // Sun 23:59 PST
  add('tomorrow', { title: 'Lab Report 4', due_at: '2026-11-03T07:59:00Z', points: 30 }); // Mon 23:59
  add('late', { title: 'HW 4', due_at: '2026-10-30T06:59:00Z' }); // overdue
  add('kc', { kind: 'quiz', title: 'Knowledge Check 2', due_at: '2026-11-04T17:00:00Z' }); // Wed 09:00 PST
  setItemCategory(db, 'kc', 'exam', 'auto');
});
after(() => setNotifier(null));

const calls = () => readdirSync(rec).filter((f) => f.startsWith('argv-')).length;
function reply(n: number, data: unknown) {
  writeFileSync(path.join(queue, `${n}.json`), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(data), structured_output: data, usage: { input_tokens: 800, output_tokens: 300 } }));
}

test('generateDaily saves the day\'s data with the AI plan; unknown item ids are dropped, minutes kept sane', async () => {
  reply(1, {
    headline: '今晚先交 HW 5，Knowledge Check 2 开始复习',
    blocks: [
      { slot: '上午', title: '写 HW 5', item_id: 'tonight', minutes: 45 },
      { slot: '晚上', title: '复习第 18 章', item_id: 'made-up', minutes: 100000, note: '做 review problems' },
    ],
    tips: ['实验课带计算器'],
  });
  const row = await generateDaily(db, { now: NOW, notify: false });
  assert.equal(row.id, 'daily:2026-11-01');
  const r = JSON.parse(row.content) as DailyReport;
  assert.equal(r.kind, 'daily');
  assert.equal(r.aiError, null);
  assert.deepEqual(r.data.dueToday.map((t) => t.id), ['tonight']);
  assert.equal(r.ai!.blocks[0].item_id, 'tonight');
  assert.equal(r.ai!.blocks[1].item_id, undefined, 'unknown id dropped, block kept');
  assert.equal(r.ai!.blocks[1].minutes, 600);
  const prompt = readFileSync(path.join(rec, 'stdin-0.txt'), 'utf8');
  assert.match(prompt, /"item_id":"tonight"/);
  assert.match(prompt, /今天 23:59/);
  assert.match(prompt, /"type":"考试"/);
  assert.match(readFileSync(path.join(rec, 'argv-0.txt'), 'utf8'), /不要写日期/);
  assert.equal(notices.length, 0);
  assert.equal(headlineOf(r), '今晚先交 HW 5，Knowledge Check 2 开始复习');
});

test('when Claude fails the daily report is still saved, with a plain headline', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  const r = JSON.parse((await generateDaily(db, { now: NOW, notify: false })).content) as DailyReport;
  assert.equal(r.ai, null);
  assert.ok(r.aiError);
  assert.equal(r.data.dueToday.length, 1);
  assert.equal(headlineOf(r), '今天 1 项截止');
});

test('with AI switched off, no Claude call is made', async () => {
  updateSettings(db, { aiEnabled: false });
  const r = JSON.parse((await generateDaily(db, { now: NOW, notify: false })).content) as DailyReport;
  assert.equal(r.ai, null);
  assert.match(r.aiError!, /关闭/);
  updateSettings(db, { aiEnabled: true });
  await generateDaily(db, { now: NOW, notify: false, ai: false });
  assert.equal(calls(), 0);
});

test('the daily notification names the count, the most urgent item, overdue work and a near exam', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  await generateDaily(db, { now: NOW, notify: true });
  assert.equal(notices.length, 1);
  assert.equal(notices[0].title, '今天 1 项截止');
  assert.match(notices[0].body, /最急：BIO 3 HW 5 今天 23:59/);
  assert.match(notices[0].body, /1 项已逾期/);
  assert.match(notices[0].body, /考试：BIO 3 Knowledge Check 2 周三 09:00/);
  assert.match(notices[0].url!, /\/reports\/daily:2026-11-01$/);
});

test('the weekly report made on Sunday 20:00 covers the coming week', async () => {
  reply(1, { headline: '下周三有 Knowledge Check 2', focus: ['复习第 18 章'], risks: ['周三考试前实验报告也要交'], suggestions: ['周一前写完 Lab Report 4'] });
  const row = await generateWeekly(db, { now: new Date('2026-11-02T04:00:00Z'), notify: true }); // Sun Nov 1, 20:00 PST
  assert.equal(row.id, 'weekly:2026-11-02');
  assert.equal(row.period, '2026-11-02');
  const r = JSON.parse(row.content) as WeeklyReport;
  assert.equal(r.kind, 'weekly');
  assert.equal(r.ai!.headline, '下周三有 Knowledge Check 2');
  assert.deepEqual(r.data.next.exams.map((t) => t.id), ['kc']);
  assert.match(readFileSync(path.join(rec, 'stdin-0.txt'), 'utf8'), /"day":"周三"/);
  assert.equal(notices[0].title, '下周：1 项截止 · 1 场考试');
  assert.match(notices[0].body, /最忙：周三（约 2 小时）/);
  assert.match(notices[0].url!, /\/reports\/weekly:2026-11-02$/);
});

test('a stored report shows today\'s status for its tasks', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  const row = await generateDaily(db, { now: NOW, notify: false });
  setLocalDone(db, 'tonight', true);
  const live = refreshReport(db, JSON.parse(row.content), NOW) as DailyReport;
  assert.equal(live.data.dueToday[0].status, 'done');
  assert.equal(live.data.dueToday[0].localDone, true);
});
