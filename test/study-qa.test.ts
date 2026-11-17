import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir, scratchDir } from './helpers.ts';
import { startMockCanvas } from '../mock/server.ts';
import type { MockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { aiQueue } from '../src/ai/claude.ts';
import { askQuestion, listQuestions } from '../src/ai/ask.ts';

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
function replyText(n: number, text: string) {
  writeFileSync(path.join(queue, `${n}.json`), JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 900, output_tokens: 200 } }));
}

test('a question about a week is answered from that week\'s material and kept', async () => {
  replyText(1, '糖酵解发生在**细胞质**里（Week6_Cell_Respiration.pdf · 第 1 页）。');
  const id = askQuestion(db, C, 6, '  糖酵解在哪里发生？  ');
  assert.equal(listQuestions(db, C, 6)[0].status, 'pending');
  await aiQueue.onIdle();
  const [qa] = listQuestions(db, C, 6);
  assert.equal(qa.id, id);
  assert.equal(qa.question, '糖酵解在哪里发生？');
  assert.equal(qa.status, 'done');
  assert.match(qa.answer!, /细胞质/);
  const prompt = readFileSync(path.join(rec, 'stdin-0.txt'), 'utf8');
  assert.match(prompt, /糖酵解在哪里发生？/);
  assert.match(prompt, /\[第2页\]/, 'the slides are in the prompt');
  assert.match(readFileSync(path.join(rec, 'argv-0.txt'), 'utf8'), /只根据/);
});

test('a failed answer is recorded and can be asked again; empty or huge questions are refused', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  askQuestion(db, C, 6, '什么是 ATP？');
  await aiQueue.onIdle();
  const qa = listQuestions(db, C, 6)[0];
  assert.equal(qa.status, 'failed');
  assert.ok(qa.error);
  assert.throws(() => askQuestion(db, C, 6, '   '), /问题/);
  assert.throws(() => askQuestion(db, C, 6, 'x'.repeat(1001)), /1000/);
});
