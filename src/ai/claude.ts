// Runs Claude through the user's own Claude Code login (`claude -p`, Max subscription). Isolated from the
// user's plugins/hooks/MCP servers so each call carries only our prompt, and never handed an API key.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { claudeBin, paths } from '../config.ts';
import type { DB } from '../db/index.ts';
import { recordAiRun } from '../db/runs.ts';
import { getSettings } from '../db/settings.ts';
import { log } from '../util/log.ts';

export type AiPurpose = 'guide' | 'guide-part' | 'syllabus' | 'daily' | 'weekly' | 'chat';

export interface ClaudeRequest {
  purpose: AiPurpose;
  ref?: string;
  system: string;
  prompt: string;
  schema?: object;
  model?: string;
  tools?: string[];
  addDirs?: string[];
  timeoutMs?: number;
}

export interface ClaudeResult<T> {
  ok: boolean;
  data?: T;
  text?: string;
  error?: string;
  rateLimited: boolean;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  durationMs: number;
}

interface CliOutput {
  is_error?: boolean;
  result?: string;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number };
}

const RATE_LIMIT = /usage limit|rate.?limit|quota|overloaded|429|too many requests/i;

export async function runClaude<T = unknown>(db: DB, req: ClaudeRequest): Promise<ClaudeResult<T>> {
  const model = req.model ?? getSettings(db).aiModel;
  const args = [
    '-p', '--output-format', 'json', '--model', model,
    '--setting-sources', 'project', '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
    '--system-prompt', req.system, '--tools', (req.tools ?? []).join(','),
  ];
  if (req.schema) args.push('--json-schema', JSON.stringify(req.schema));
  for (const d of req.addDirs ?? []) args.push('--add-dir', d);

  const cwd = paths().aiWork;
  mkdirSync(cwd, { recursive: true });
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY; // always the subscription login, never metered API billing
  const startedAt = new Date();
  const timeoutMs = req.timeoutMs ?? 10 * 60_000;

  const { code, stdout, stderr, timedOut } = await new Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }>((resolve) => {
    const child = spawn(claudeBin(), args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 3000).unref();
    }, timeoutMs);
    child.stdout.on('data', (b: Buffer) => (out += b.toString('utf8')));
    child.stderr.on('data', (b: Buffer) => (err += b.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: `${err}\n${e.message}`, timedOut });
    });
    child.on('close', (c) => {
      clearTimeout(timer);
      resolve({ code: c, stdout: out, stderr: err, timedOut });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(req.prompt);
  });
  const durationMs = Date.now() - startedAt.getTime();

  let parsed: CliOutput | null = null;
  try {
    parsed = JSON.parse(stdout.trim()) as CliOutput;
  } catch {
    parsed = null;
  }
  let result: ClaudeResult<T>;
  if (timedOut) {
    result = { ok: false, error: `AI 超时（${Math.round(timeoutMs / 1000)} 秒）`, rateLimited: false, durationMs };
  } else if (!parsed || parsed.is_error || code !== 0) {
    const message = parsed?.result || stderr.trim() || `claude 退出码 ${code}`;
    result = { ok: false, error: message.slice(0, 500), rateLimited: RATE_LIMIT.test(message), durationMs };
  } else {
    let data = parsed.structured_output as T | undefined;
    if (data === undefined && req.schema && parsed.result) {
      try {
        data = JSON.parse(parsed.result) as T;
      } catch {
        data = undefined;
      }
    }
    result = req.schema && data === undefined
      ? { ok: false, error: 'AI 没有按要求返回结构化结果', rateLimited: false, durationMs }
      : { ok: true, data, text: parsed.result, rateLimited: false, durationMs };
  }
  const u = parsed?.usage;
  result.costUsd = parsed?.total_cost_usd;
  result.inputTokens = u ? (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) : undefined;
  result.outputTokens = u?.output_tokens;
  recordAiRun(db, {
    purpose: req.purpose, ref: req.ref ?? null, model, started_at: startedAt.toISOString(), duration_ms: durationMs,
    input_tokens: result.inputTokens ?? null, output_tokens: result.outputTokens ?? null, cost_usd: result.costUsd ?? null,
    ok: result.ok ? 1 : 0, error: result.error ?? null,
  });
  if (!result.ok) log('warn', `claude ${req.purpose} ${req.ref ?? ''} failed`, result.error);
  return result;
}

/** One AI job at a time (memory on an 8GB Mac, and the subscription's rate limits). */
export class SerialQueue {
  private queue: { key: string; fn: () => Promise<void> }[] = [];
  private current: string | null = null;
  private idle: (() => void)[] = [];

  get running(): string | null {
    return this.current;
  }

  has(key: string): boolean {
    return this.current === key || this.queue.some((j) => j.key === key);
  }

  pending(): string[] {
    return this.queue.map((j) => j.key);
  }

  add(key: string, fn: () => Promise<void>): boolean {
    if (this.has(key)) return false;
    this.queue.push({ key, fn });
    void this.pump();
    return true;
  }

  /** Runs `fn` in the queue and resolves with its result; `front` puts it ahead of jobs still waiting (reports before guides). */
  run<T>(key: string, fn: () => Promise<T>, opts: { front?: boolean } = {}): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job = { key, fn: () => fn().then(resolve, reject) };
      if (opts.front) this.queue.unshift(job);
      else this.queue.push(job);
      void this.pump();
    });
  }

  onIdle(): Promise<void> {
    if (!this.current && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  private async pump(): Promise<void> {
    if (this.current) return;
    const job = this.queue.shift();
    if (!job) {
      this.idle.splice(0).forEach((r) => r());
      return;
    }
    this.current = job.key;
    try {
      await job.fn();
    } catch (err) {
      log('error', `AI job ${job.key} failed`, err);
    } finally {
      this.current = null;
      void this.pump();
    }
  }
}

export const aiQueue = new SerialQueue();
