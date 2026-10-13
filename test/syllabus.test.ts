import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tmpDataDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import type { MockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getItem, listItems, listUndated, setItemCategory } from '../src/db/items.ts';
import { listModules } from '../src/db/content.ts';
import { listWeeks } from '../src/db/study.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { makeTaskViewer } from '../src/reports/data.ts';
import { buildSyllabusInput, dateMentioned, applySyllabusAnalysis, analyzeSyllabus } from '../src/ai/syllabus.ts';
import type { SyllabusResult } from '../src/ai/syllabus.ts';
import { addDays, atLocal, localDateStr } from '../src/util/time.ts';

let mock: MockCanvas;
let db: DB;
const C = 'alpha:101';
const day = (n: number) => addDays(localDateStr(new Date()), n);

before(async () => {
  tmpDataDir();
  db = openDb();
  mock = await startMockCanvas({ variant: 'alpha' });
  const s = createSchool(db, { name: 'alpha', base_url: mock.baseUrl });
  saveAuth({ schoolId: s.id, savedAt: new Date().toISOString(), userAgent: 'test', cookies: mock.sessionCookies() });
  await syncSchool(db, s.id, { reason: 'test', relogin: null });
});
after(() => mock.close());

test('dateMentioned recognises how syllabi write dates', () => {
  assert.ok(dateMentioned('will take place during lab on October 21st.', '2026-10-21'));
  assert.ok(!dateMentioned('will take place during lab on October 21st.', '2026-10-22'));
  assert.ok(dateMentioned('5 / Sep 29 & Oct 1 / Knowledge Check 1', '2026-10-01'));
  assert.ok(!dateMentioned('Oct 15 lab', '2026-10-01'));
  assert.ok(dateMentioned('Exam on 10/1', '2026-10-01'));
  assert.ok(dateMentioned('考试：10月1日', '2026-10-01'));
  assert.ok(dateMentioned('Sept. 9th quiz', '2026-09-09'));
});

test('the syllabus input gathers schedule pages, syllabus files and the items with their groups', () => {
  const input = buildSyllabusInput(db, C);
  const ids = input.sources.map((s) => s.id);
  assert.ok(ids.includes('syllabus'));
  assert.ok(ids.includes('page:alpha:p:62'), 'Class Schedule page');
  assert.ok(ids.includes('file:alpha:f:7007'), 'syllabus PDF text');
  const kc = input.items.find((i) => i.id === 'alpha:a:5012')!;
  assert.equal(kc.group, 'Knowledge Checks (30%)');
  assert.equal(kc.auto_category, 'exam');
  assert.equal(input.hash, buildSyllabusInput(db, C).hash);
});

test('verified exams get syllabus dates; unverifiable claims are rejected; user choices win', () => {
  setItemCategory(db, 'alpha:a:5002', 'homework', 'user');
  const input = buildSyllabusInput(db, C);
  const kcDay = day(9);
  const result: SyllabusResult = {
    exams: [
      { title: 'Knowledge Check 2', item_id: 'alpha:a:5012', date: kcDay, time: null, coverage: 'Chapters 5–6', quote: 'Knowledge Check 2, covering Chapters 5–6, will take place during lab', source_id: 'page:alpha:p:62' },
      { title: 'Lab Practical', item_id: null, date: day(16), time: null, coverage: null, quote: 'Lab Practical (in person) on', source_id: 'page:alpha:p:62' },
      { title: 'Final Exam', item_id: null, date: '2026-12-01', time: '08:00', coverage: null, quote: 'The final exam is on December 1st at 8am', source_id: 'syllabus' },
      { title: 'Knowledge Check 2', item_id: 'alpha:a:5012', date: day(30), time: null, coverage: null, quote: 'Knowledge Check 2, covering Chapters 5–6', source_id: 'page:alpha:p:62' },
    ],
    categories: [
      { item_id: 'alpha:a:5011', category: 'project', reason: 'Final Project is a project' },
      { item_id: 'alpha:a:5002', category: 'exam', reason: 'wrong on purpose' },
      { item_id: 'alpha:a:5009', category: 'nonsense', reason: 'invalid' },
    ],
    weeks: [{ week: 6, topics: ['Cell Respiration'] }, { week: 7, topics: ['Photosynthesis'] }],
    module_weeks: [{ module_id: 'alpha:m:399', week: 1 }, { module_id: 'alpha:m:306', week: 2 }],
  };
  const summary = applySyllabusAnalysis(db, C, input, result);
  assert.equal(summary.examsApplied, 2);
  assert.equal(summary.examsRejected, 2, 'made-up quote and an unsupported date');

  const kc = getItem(db, 'alpha:a:5012')!;
  assert.equal(kc.syllabus_date, atLocal(kcDay, 23, 59).toISOString());
  assert.equal(kc.category, 'exam');
  assert.equal(kc.category_source, 'syllabus');
  assert.match(kc.syllabus_note!, /大纲/);
  assert.match(kc.syllabus_note!, /Chapters 5–6/);

  const practical = listItems(db, { courseId: C }).find((i) => i.title === 'Lab Practical')!;
  assert.match(practical.id, /^alpha:x:/);
  assert.equal(practical.kind, 'event');
  assert.equal(practical.category, 'exam');
  assert.ok(!listItems(db, { courseId: C }).some((i) => i.title === 'Final Exam'));

  assert.equal(getItem(db, 'alpha:a:5011')!.category, 'project');
  assert.equal(getItem(db, 'alpha:a:5002')!.category, 'homework', 'user override kept');
  assert.notEqual(getItem(db, 'alpha:a:5009')!.category, 'nonsense');

  assert.deepEqual(JSON.parse(listWeeks(db, C).find((w) => w.week === 6)!.topics), ['Cell Respiration']);
  const mods = listModules(db, C);
  assert.equal(mods.find((m) => m.id === 'alpha:m:399')!.week_start, 1, 'undated module mapped');
  assert.equal(mods.find((m) => m.id === 'alpha:m:306')!.week_start, 6, 'name-mapped module untouched');
});

test('syllabus dates show up as deadlines (date only) and not as undated', () => {
  const kc = getItem(db, 'alpha:a:5012')!;
  const view = makeTaskViewer(db, new Date())(kc);
  assert.equal(view.dueAt, kc.syllabus_date);
  assert.equal(view.dueFromSyllabus, true);
  assert.equal(view.dueDateOnly, true);
  assert.ok(listItems(db, { from: new Date().toISOString() }).some((i) => i.id === 'alpha:a:5012'));
  assert.ok(!listUndated(db).some((i) => i.id === 'alpha:a:5012'));
  const later = makeTaskViewer(db, new Date(Date.now() + 40 * 86_400_000))(kc);
  assert.equal(later.status, 'past', 'an exam that has happened is not "overdue"');
});

test('analyzeSyllabus calls Claude once per distinct input', async () => {
  const rec = mkdtempSync(path.join(tmpdir(), 'fake-claude-'));
  const queue = mkdtempSync(path.join(tmpdir(), 'fake-claude-q-'));
  process.env.COURSEHUB_CLAUDE_BIN = path.resolve('test/fixtures/fake-claude.sh');
  process.env.FAKE_CLAUDE_DIR = rec;
  process.env.FAKE_CLAUDE_QUEUE = queue;
  const reply = { exams: [], categories: [{ item_id: 'alpha:a:5010', category: 'homework', reason: 'ok' }], weeks: [], module_weeks: [] };
  writeFileSync(path.join(queue, '1.json'), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(reply), structured_output: reply, usage: { input_tokens: 10, output_tokens: 5 } }));
  const first = await analyzeSyllabus(db, 'alpha:102');
  assert.equal(first.ran, true);
  const second = await analyzeSyllabus(db, 'alpha:102');
  assert.equal(second.ran, false, 'nothing changed → no second AI call');
  assert.equal(readdirSync(rec).filter((f) => f.startsWith('argv-')).length, 1);
  const prompt = readdirSync(rec).find((f) => f.startsWith('stdin-'))!;
  assert.ok(prompt);
});
