// "A year from now": seeds about a year of data (past terms, thousands of changes/notices, a report per day,
// slide text) and holds the main pages to time budgets, so a slow query or an O(n²) loop fails the suite
// long before the user feels it. Budgets are generous (a busy Mac must not make this flaky); they catch
// regressions, not milliseconds.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb, tx } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { setCourseWeek1, upsertCourse } from '../src/db/courses.ts';
import { upsertItem, setItemCategory } from '../src/db/items.ts';
import { addChange } from '../src/db/changes.ts';
import { recordNotice } from '../src/db/notices.ts';
import { saveReport } from '../src/db/reports.ts';
import { upsertFile, upsertModule, upsertModuleItem, upsertPage, upsertTopic, setModuleWeek } from '../src/db/content.ts';
import { replaceWeeks, upsertGuide } from '../src/db/study.ts';
import { run } from '../src/db/sql.ts';
import { saveText } from '../src/content/textstore.ts';
import { createApp } from '../src/server/app.ts';
import { computeDaily, computeWeekly } from '../src/reports/data.ts';
import { localDateStr, addDays, mondayOf } from '../src/util/time.ts';

let db: DB;
let app: ReturnType<typeof createApp>;
let current = '';
const DAY = 86_400_000;

function seedYear(db: DB): void {
  const now = Date.now();
  const iso = (offsetDays: number) => new Date(now + offsetDays * DAY).toISOString();
  const thisMonday = mondayOf(localDateStr(new Date()));
  tx(db, () => {
    for (let s = 0; s < 3; s++) {
      const school = createSchool(db, { name: `School ${s}`, base_url: `school${s}.instructure.com` });
      for (let c = 0; c < 5; c++) {
        const active = c < 2; // two current courses per school, three from past terms
        const id = `${school.id}:${100 + c}`;
        upsertCourse(db, {
          id, school_id: school.id, canvas_id: String(100 + c), name: `COURSE ${s}${c} 101 - Long Course Name`, code: `CRS ${s}${c}`,
          term_name: active ? 'Fall' : 'Old', start_at: iso(active ? -60 : -400), end_at: iso(active ? 60 : -250),
          html_url: `https://school${s}/courses/${100 + c}`, syllabus_html: '<p>syllabus</p>', tabs: null, current_score: null, current_grade: null,
          active: 1, updated_at: new Date().toISOString(),
        });
        if (active) current = id;
        setCourseWeek1(db, id, addDays(thisMonday, active ? -7 * 8 : -7 * 60));
        replaceWeeks(db, id, Array.from({ length: 16 }, (_, w) => ({
          course_id: id, week: w + 1, start_date: addDays(thisMonday, (active ? -56 : -420) + w * 7), title: `Week ${w + 1}`, topics: JSON.stringify([`Topic ${w + 1}a`, `Topic ${w + 1}b`]), source: 'module',
        })));
        for (let w = 0; w < 16; w++) {
          const mid = `${school.id}:m:${c}_${w}`;
          upsertModule(db, { id: mid, course_id: id, canvas_id: `m${w}`, name: `Week ${w + 1}`, position: w, unlock_at: null });
          setModuleWeek(db, mid, { week_start: w + 1, week_end: w + 1, week_source: 'name' });
          for (let k = 0; k < 6; k++) {
            const fileId = `${school.id}:f:${c}_${w}_${k}`;
            upsertFile(db, { id: fileId, course_id: id, canvas_id: `${w}${k}`, name: `Slides ${w}-${k}.pdf`, content_type: 'application/pdf', size: 1000, updated_at: iso(-10), html_url: `https://x/files/${w}${k}` });
            run(db, "UPDATE files SET text_status = 'ok', text_pages = 30 WHERE id = $id", { id: fileId });
            if (active) saveText({ fileId, name: `Slides ${w}-${k}.pdf`, kind: 'pdf', pages: Array.from({ length: 30 }, (_, p) => `Page ${p} `.repeat(150)), scanned: false, extractedAt: iso(0), sourceUpdatedAt: iso(-10) });
            upsertModuleItem(db, { id: `${school.id}:mi:${c}_${w}_${k}`, module_id: mid, course_id: id, title: `Slides ${w}-${k}`, type: 'File', content_id: `${w}${k}`, page_url: null, html_url: null, external_url: null, position: k, indent: 0, ref_id: fileId });
          }
          const pageId = `${school.id}:p:${c}_${w}`;
          upsertPage(db, { id: pageId, course_id: id, url: `week-${w}`, title: `Week ${w + 1} Overview`, body_html: '<p>overview</p>'.repeat(200), updated_at: iso(-5), front_page: 0, html_url: 'https://x/p' });
          upsertModuleItem(db, { id: `${school.id}:mi:${c}_${w}_p`, module_id: mid, course_id: id, title: 'Overview', type: 'Page', content_id: null, page_url: `week-${w}`, html_url: null, external_url: null, position: 9, indent: 0, ref_id: pageId });
          if (active && w < 8) upsertGuide(db, { course_id: id, week: w + 1, status: 'ready', content: JSON.stringify({ overview: 'x'.repeat(3000), concepts: [] }), input_hash: 'old' });
        }
        for (let i = 0; i < 120; i++) {
          const itemId = `${school.id}:a:${c}_${i}`;
          upsertItem(db, {
            id: itemId, school_id: school.id, course_id: id, kind: i % 10 === 0 ? 'quiz' : 'assignment', title: `Homework ${i} for course ${s}${c}`,
            due_at: iso((active ? -40 : -380) + i * 0.8), end_at: null, unlock_at: null, lock_at: null, points: 10, html_url: `https://x/a/${i}`, provider: 'canvas',
            description_html: '<p>Do the thing.</p>'.repeat(30), submission_types: '["online_upload"]', sub_state: i % 3 === 0 ? 'graded' : 'unsubmitted',
            submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0, source: 'api', module_id: `${school.id}:m:${c}_${i % 16}`, group_id: null,
          });
          if (i % 25 === 0) setItemCategory(db, itemId, 'exam', 'auto');
          if (i % 2 === 0) run(db, "INSERT INTO reminders_sent (item_id, threshold, sent_at) VALUES ($id, '24', $at), ($id, '3', $at)", { id: itemId, at: iso(-10) });
        }
        for (let t = 0; t < 100; t++) {
          upsertTopic(db, {
            id: `${school.id}:t:${c}_${t}`, course_id: id, kind: t % 3 === 0 ? 'announcement' : 'discussion', title: `Topic ${t} about homework`, message_html: '<p>message</p>'.repeat(20),
            posted_at: iso(-t * 2), author: 'Prof', html_url: 'https://x/t', reply_count: 3, unread_count: 0, assignment_item_id: null,
          });
        }
        for (let k = 0; k < 1000; k++) {
          addChange(db, { school_id: school.id, course_id: id, kind: k % 2 ? 'due_changed' : 'announcement', ref_id: `${school.id}:a:${c}_${k % 120}`, summary: `change ${k}`, data: '{"from":null,"to":null}', notified: 1 });
        }
      }
    }
    for (let n = 0; n < 3000; n++) recordNotice(db, { kind: 'reminder', title: `Notice ${n}`, body: 'BIO 3 · Homework', url: 'https://x' });
    const content = JSON.stringify({ kind: 'daily', data: { date: '', overdue: [], dueToday: [], next3Days: [], laterThisWeek: [], eventsToday: [], examsSoon: [], announcements: [], grades: [], dueChanges: [], loginNeeded: [], studyFocus: [], totals: { todo: 0, minutes: 0 }, pad: 'x'.repeat(15_000) }, ai: { headline: 'h', blocks: [], tips: [] }, aiError: null });
    for (let d = 0; d < 365; d++) saveReport(db, { type: 'daily', period: addDays(localDateStr(new Date()), -d), content });
  });
}

async function median(fn: () => Promise<unknown>): Promise<number> {
  const runs: number[] = [];
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    await fn();
    runs.push(performance.now() - t);
  }
  return runs.sort((a, b) => a - b)[1];
}

before(() => {
  tmpDataDir();
  db = openDb();
  seedYear(db);
  app = createApp(db);
});

test('a year of data: the main pages answer within their budgets', { timeout: 180_000 }, async () => {
  const from = new Date(Date.now() - 20 * DAY).toISOString();
  const to = new Date(Date.now() + 140 * DAY).toISOString();
  const budgets: [string, number][] = [
    ['/api/overview', 1000],
    [`/api/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&includeDone=1`, 1000],
    ['/api/items/undated', 600],
    ['/api/courses', 800],
    [`/api/study/${encodeURIComponent(current)}`, 1500],
    [`/api/study/${encodeURIComponent(current)}/9`, 800],
    ['/api/search?q=homework', 600],
    ['/api/status', 800],
    ['/api/reports?type=daily', 600],
    ['/api/notices?limit=200', 500],
  ];
  const timings: string[] = [];
  for (const [path, budget] of budgets) {
    const ms = await median(async () => {
      const res = await app.request(`http://127.0.0.1:4123${path}`);
      assert.equal(res.status, 200, path);
      await res.text();
    });
    timings.push(`${Math.round(ms)}ms ${path.slice(0, 50)}`);
    assert.ok(ms < budget, `${path} took ${Math.round(ms)} ms (budget ${budget} ms)`);
  }
  const daily = await median(async () => computeDaily(db, new Date()));
  const weekly = await median(async () => computeWeekly(db, new Date()));
  assert.ok(daily < 800, `computeDaily ${Math.round(daily)} ms`);
  assert.ok(weekly < 800, `computeWeekly ${Math.round(weekly)} ms`);
  if (process.env.PERF_LOG) console.log([...timings, `${Math.round(daily)}ms computeDaily`, `${Math.round(weekly)}ms computeWeekly`].join('\n'));
});
