import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir, scratchDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { recentAiRuns } from '../src/db/runs.ts';
import { runClaude, SerialQueue } from '../src/ai/claude.ts';

let db: DB;
let rec: string;
beforeEach(() => {
  tmpDataDir();
  db = openDb();
  rec = scratchDir('fake-claude-');
  process.env.COURSEHUB_CLAUDE_BIN = path.resolve('test/fixtures/fake-claude.sh');
  process.env.FAKE_CLAUDE_DIR = rec;
  process.env.FAKE_CLAUDE_MODE = 'ok';
});

const schema = { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] };

test('runs claude -p isolated, prompt on stdin, structured output parsed, usage recorded', async () => {
  const res = await runClaude<{ answer: number }>(db, { purpose: 'guide', ref: 'c:1', system: 'You are a TA.', prompt: '讲讲第 6 周', schema, model: 'sonnet', tools: ['Read'], addDirs: ['/tmp/x'] });
  assert.equal(res.ok, true, res.error ?? "");
  assert.deepEqual(res.data, { answer: 42 });
  const argv = readFileSync(path.join(rec, 'argv-0.txt'), 'utf8').split('\n');
  for (const flag of ['-p', '--output-format', 'json', '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  assert.equal(argv[argv.indexOf('--system-prompt') + 1], 'You are a TA.');
  assert.equal(argv[argv.indexOf('--tools') + 1], 'Read');
  assert.deepEqual(JSON.parse(argv[argv.indexOf('--json-schema') + 1]), schema);
  assert.equal(argv[argv.indexOf('--add-dir') + 1], '/tmp/x');
  assert.ok(!argv.includes('--bare'), '--bare would require an API key');
  assert.equal(readFileSync(path.join(rec, 'stdin-0.txt'), 'utf8'), '讲讲第 6 周');
  const [run] = recentAiRuns(db, 1);
  assert.equal(run.ok, 1);
  assert.equal(run.purpose, 'guide');
  assert.equal(run.input_tokens, 150);
  assert.equal(run.output_tokens, 45);
  assert.equal(run.cost_usd, 0.0123);
});

test('no tools by default, model from settings, and never an API key', async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-should-not-leak';
  try {
    await runClaude(db, { purpose: 'daily', system: 's', prompt: 'p' });
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
  const argv = readFileSync(path.join(rec, 'argv-0.txt'), 'utf8').split('\n');
  assert.equal(argv[argv.indexOf('--tools') + 1], '');
  assert.equal(argv[argv.indexOf('--model') + 1], 'sonnet');
  assert.equal(readFileSync(path.join(rec, 'apikey-0.txt'), 'utf8'), '', 'uses the Max subscription login, not API billing');
});

test('errors, rate limits and timeouts are reported, not thrown', async () => {
  process.env.FAKE_CLAUDE_MODE = 'error';
  const e = await runClaude(db, { purpose: 'guide', system: 's', prompt: 'p' });
  assert.equal(e.ok, false);
  assert.match(e.error!, /Something broke/);
  assert.equal(e.rateLimited, false);
  process.env.FAKE_CLAUDE_MODE = 'ratelimit';
  const r = await runClaude(db, { purpose: 'guide', system: 's', prompt: 'p' });
  assert.equal(r.ok, false);
  assert.equal(r.rateLimited, true);
  process.env.FAKE_CLAUDE_MODE = 'slow';
  const t = await runClaude(db, { purpose: 'guide', system: 's', prompt: 'p', timeoutMs: 300 });
  assert.equal(t.ok, false);
  assert.match(t.error!, /超时/);
  assert.equal(recentAiRuns(db, 10).filter((x) => x.ok === 0).length, 3);
});

test('SerialQueue runs one job at a time and ignores duplicate keys', async () => {
  const q = new SerialQueue();
  const order: string[] = [];
  let release: () => void = () => {};
  assert.equal(q.add('a', () => new Promise<void>((r) => { order.push('a'); release = r; })), true);
  assert.equal(q.add('b', async () => { order.push('b'); }), true);
  assert.equal(q.add('a', async () => { order.push('a2'); }), false);
  assert.equal(q.running, 'a');
  assert.deepEqual(q.pending(), ['b']);
  assert.ok(q.has('b'));
  release();
  await q.onIdle();
  assert.deepEqual(order, ['a', 'b']);
  assert.equal(q.running, null);
});

test('SerialQueue.run resolves with the job\'s result and can jump ahead of waiting jobs', async () => {
  const q = new SerialQueue();
  const order: string[] = [];
  let release: () => void = () => {};
  q.add('guide-1', () => new Promise<void>((r) => { order.push('guide-1'); release = r; }));
  q.add('guide-2', async () => { order.push('guide-2'); });
  const report = q.run('report', async () => { order.push('report'); return 42; }, { front: true });
  assert.deepEqual(q.pending(), ['report', 'guide-2']);
  release();
  assert.equal(await report, 42);
  await q.onIdle();
  assert.deepEqual(order, ['guide-1', 'report', 'guide-2']);
  await assert.rejects(q.run('boom', async () => { throw new Error('boom'); }), /boom/);
});
