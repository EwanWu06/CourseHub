import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir, scratchDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import type { MockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getGuide } from '../src/db/study.ts';
import { run } from '../src/db/sql.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { loadText, saveText } from '../src/content/textstore.ts';
import { aiQueue } from '../src/ai/claude.ts';
import { buildGuideInput, generateGuide, autoEnqueueGuides, guideStale } from '../src/ai/guide.ts';

let mock: MockCanvas;
let db: DB;
let rec: string;
let queue: string;
const C = 'alpha:101';

before(async () => {
  tmpDataDir();
  db = openDb();
  mock = await startMockCanvas({ variant: 'alpha' });
  const s = createSchool(db, { name: 'alpha', base_url: mock.baseUrl });
  saveAuth({ schoolId: s.id, savedAt: new Date().toISOString(), userAgent: 'test', cookies: mock.sessionCookies() });
  await syncSchool(db, s.id, { reason: 'test', relogin: null });
});
after(() => mock.close());
beforeEach(() => {
  rec = scratchDir('fake-claude-');
  queue = scratchDir('fake-claude-q-');
  process.env.FAKE_CLAUDE_DIR = rec;
  process.env.FAKE_CLAUDE_QUEUE = queue;
  process.env.FAKE_CLAUDE_MODE = 'ok';
});

const calls = () => readdirSync(rec).filter((f) => f.startsWith('argv-')).length;
function reply(n: number, data: unknown) {
  writeFileSync(path.join(queue, `${n}.json`), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(data), structured_output: data, usage: { input_tokens: 1000, output_tokens: 500 } }));
}
const GUIDE = {
  overview: '本周讲细胞呼吸。',
  objectives: ['说出糖酵解发生在哪里'],
  concepts: [
    { term: 'Glycolysis', term_zh: '糖酵解', explanation: '在细胞质中把葡萄糖分解成丙酮酸。', example: '一个葡萄糖 → 2 个丙酮酸', pitfalls: '不是在线粒体里', sources: [{ material_id: 'alpha:f:7001', page: 1 }, { material_id: 'alpha:f:999', page: 2 }] },
  ],
  cheatsheet: '$C_6H_{12}O_6$',
  assignments: [{ item_id: 'alpha:a:5002', relation: '本周作业就考这个' }, { item_id: 'nope', relation: '不存在' }],
  self_test: [{ question: '糖酵解在哪里？', answer: '细胞质' }],
  study_plan: [{ step: '读 slides 第 1–3 页', minutes: 40 }],
  coverage: { level: 'full', note: '' },
};

test('the week-6 input carries slide text with page markers, notes, the overview page and this week\'s work only', () => {
  const input = buildGuideInput(db, C, 6);
  const pdf = input.materials.find((m) => m.id === 'alpha:f:7001')!;
  assert.match(pdf.text, /\[第2页\][\s\S]*Krebs cycle/);
  assert.match(input.materials.find((m) => m.id === 'alpha:f:7002')!.text, /【讲者备注】Remember the NADH shuttle/);
  assert.ok(input.materials.some((m) => m.title === 'Week 6 Overview'));
  assert.ok(!input.materials.some((m) => m.title === 'Week 7 Overview'), 'other weeks are left out');
  assert.ok(input.assignments.some((a) => a.id === 'alpha:a:5002'));
  assert.equal(input.hash, buildGuideInput(db, C, 6).hash);
  run(db, "UPDATE pages SET body_html = '<p>changed</p>' WHERE id = 'alpha:p:60'");
  assert.notEqual(input.hash, buildGuideInput(db, C, 6).hash);
});

test('generateGuide stores a cleaned guide and does not call Claude again for unchanged material', async () => {
  reply(1, GUIDE);
  const r = await generateGuide(db, C, 6);
  assert.equal(r.ok, true, r.message);
  const g = getGuide(db, C, 6)!;
  assert.equal(g.status, 'ready');
  const content = JSON.parse(g.content!);
  assert.deepEqual(content.assignments.map((a: { item_id: string }) => a.item_id), ['alpha:a:5002']);
  assert.deepEqual(content.concepts[0].sources.map((s: { material_id: string }) => s.material_id), ['alpha:f:7001']);
  const prompt = readFileSync(path.join(rec, 'stdin-0.txt'), 'utf8');
  assert.match(prompt, /\[第2页\]/);
  const argv = readFileSync(path.join(rec, 'argv-0.txt'), 'utf8');
  assert.match(argv, /不要写任何日期/);
  assert.equal(guideStale(db, C, 6), false);
  assert.equal((await generateGuide(db, C, 6)).ok, true);
  assert.equal(calls(), 1, 'cached');
});

test('a failure is recorded with a retry time that backs off', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  const r = await generateGuide(db, C, 7);
  assert.equal(r.ok, false);
  const g = getGuide(db, C, 7)!;
  assert.equal(g.status, 'failed');
  assert.equal(g.attempts, 1);
  const wait = Date.parse(g.next_attempt_at!) - Date.now();
  assert.ok(wait > 28 * 60_000 && wait < 32 * 60_000, `retry in ~30 min, got ${wait}`);
});

test('very long material is summarised file by file first', async () => {
  const original = loadText('alpha:f:7001')!;
  saveText({ ...original, pages: [original.pages[0] + ' ' + 'x'.repeat(130_000), ...original.pages.slice(1)] });
  try {
    reply(1, { points: ['糖酵解在细胞质 [第1页]'], terms: ['Glycolysis'] });
    reply(2, GUIDE);
    const r = await generateGuide(db, C, 6, { force: true });
    assert.equal(r.ok, true, r.message);
    assert.equal(calls(), 2, 'one per long file + the final guide');
    assert.match(readFileSync(path.join(rec, 'stdin-1.txt'), 'utf8'), /糖酵解在细胞质/);
  } finally {
    saveText(original);
  }
});

test('autoEnqueueGuides queues the current and next week only', async () => {
  run(db, "DELETE FROM guides");
  process.env.FAKE_CLAUDE_MODE = 'error'; // keep the queued jobs cheap
  const n = autoEnqueueGuides(db, new Date());
  assert.ok(n >= 2);
  assert.ok(aiQueue.has(`guide:${C}#6`));
  assert.ok(aiQueue.has(`guide:${C}#7`));
  assert.ok(!aiQueue.has(`guide:${C}#8`));
  assert.ok(!aiQueue.has(`guide:${C}#5`));
  await aiQueue.onIdle();
  rmSync(rec, { recursive: true, force: true });
});

test('a checkpointed discussion in the week\'s module shows up as its two tasks', () => {
  const ids = buildGuideInput(db, C, 6).assignments.map((a) => a.id);
  assert.ok(ids.includes('alpha:a:5020:reply_to_topic'));
  assert.ok(ids.includes('alpha:a:5020:reply_to_entry'));
});
