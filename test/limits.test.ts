import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpDataDir, scratchDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import type { DB } from '../src/db/index.ts';
import { runClaude } from '../src/ai/claude.ts';
import { aiPausedUntil, parseResetTime } from '../src/ai/limits.ts';
import { nextAiRetry } from '../src/reports/daily.ts';

// TZ=America/Los_Angeles (npm test). 2026-11-02 08:00 PST = 16:00Z
const now = new Date('2026-11-02T16:00:00Z');

test('reads the reset time out of the CLI usage-limit messages', () => {
  assert.equal(parseResetTime("You've hit your weekly limit · resets Nov 3 at 5pm (America/Los_Angeles)", now)?.toISOString(), '2026-11-04T01:00:00.000Z');
  assert.equal(parseResetTime('5-hour limit reached ∙ resets 3pm', now)?.toISOString(), '2026-11-02T23:00:00.000Z');
  assert.equal(parseResetTime('5-hour limit reached ∙ resets 7:30am (America/Los_Angeles)', now)?.toISOString(), '2026-11-03T15:30:00.000Z', 'already past today → tomorrow');
  assert.equal(parseResetTime('limit · resets Nov 3 at 5pm (America/New_York)', now)?.toISOString(), '2026-11-03T22:00:00.000Z');
  assert.equal(parseResetTime('Claude AI usage limit reached|1793750400', now)?.toISOString(), '2026-11-04T00:00:00.000Z');
  assert.equal(parseResetTime('Claude AI usage limit reached|1760000000', now), null, 'in the past');
  assert.equal(parseResetTime('limit · resets Dec 30 at 5pm', now), null, 'more than a week away is a misread');
  assert.equal(parseResetTime('Something broke', now), null);
  // "Jan 2" read in late December is next year
  assert.equal(parseResetTime('weekly limit · resets Jan 2 at 9am (America/Los_Angeles)', new Date('2026-12-30T20:00:00Z'))?.toISOString(), '2027-01-02T17:00:00.000Z');
});

test('a report retry waits for the end of a usage-limit pause', () => {
  assert.equal(nextAiRetry(1, now, true).nextAt, '2026-11-02T17:00:00.000Z');
  assert.equal(nextAiRetry(1, now, true, new Date('2026-11-04T01:00:00Z')).nextAt, '2026-11-04T01:00:00.000Z');
  assert.equal(nextAiRetry(1, now, true, new Date('2026-11-02T16:10:00Z')).nextAt, '2026-11-02T17:00:00.000Z', 'never sooner than before');
});

let db: DB;
let rec: string;
let queue: string;
beforeEach(() => {
  tmpDataDir();
  db = openDb();
  rec = scratchDir('fake-claude-');
  queue = scratchDir('fake-claude-queue-');
  process.env.FAKE_CLAUDE_DIR = rec;
  process.env.FAKE_CLAUDE_MODE = 'ok';
  process.env.FAKE_CLAUDE_QUEUE = queue;
});

const calls = () => readdirSync(rec).filter((f) => f.startsWith('argv-')).length;

function limitMessageInTwoDays(): string {
  const t = new Date(Date.now() + 2 * 86_400_000);
  const month = t.toLocaleString('en-US', { month: 'short', timeZone: 'America/Los_Angeles' });
  const day = t.toLocaleString('en-US', { day: 'numeric', timeZone: 'America/Los_Angeles' });
  return `You've hit your weekly limit · resets ${month} ${day} at 5pm (America/Los_Angeles)`;
}

test('after a usage limit, background AI work waits for the reset without starting claude; a typed question still tries', async () => {
  mkdirSync(queue, { recursive: true });
  writeFileSync(path.join(queue, '1.json'), JSON.stringify({ type: 'result', is_error: true, result: limitMessageInTwoDays() }));
  const first = await runClaude(db, { purpose: 'syllabus', system: 's', prompt: 'p' });
  assert.equal(first.ok, false);
  assert.equal(first.rateLimited, true);
  const until = aiPausedUntil(db);
  assert.ok(until && until.getTime() > Date.now() + 86_400_000, 'paused until the reset');
  assert.equal(calls(), 1);

  const second = await runClaude(db, { purpose: 'guide', system: 's', prompt: 'p' });
  assert.equal(second.ok, false);
  assert.equal(second.rateLimited, true);
  assert.match(second.error!, /额度已用完.*恢复/);
  assert.equal(calls(), 1, 'claude was not started while paused');

  const chat = await runClaude(db, { purpose: 'chat', system: 's', prompt: 'p' });
  assert.equal(chat.ok, true, 'the limit had lifted early: the question went through');
  assert.equal(calls(), 2);
  assert.equal(aiPausedUntil(db), null, 'a success lifts the pause');
});

test('a limit message without a usable reset time pauses nothing (hourly retries as before)', async () => {
  process.env.FAKE_CLAUDE_MODE = 'ratelimit'; // "usage limit reached|<a time in the past>"
  const res = await runClaude(db, { purpose: 'daily', system: 's', prompt: 'p' });
  assert.equal(res.rateLimited, true);
  assert.equal(aiPausedUntil(db), null);
});
