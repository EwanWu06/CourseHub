// macOS notifications. Serialized so banners don't trample each other; tests inject their own notifier.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PORT } from '../config.ts';
import { log } from '../util/log.ts';

const execFileAsync = promisify(execFile);

export interface Notice { title: string; subtitle?: string; body: string; url?: string }

let override: ((n: Notice) => Promise<void>) | null = null;
let chain: Promise<void> = Promise.resolve();

export function setNotifier(fn: ((n: Notice) => Promise<void>) | null): void {
  override = fn;
}

export function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function osascript(n: Notice): Promise<void> {
  const script = `display notification ${appleScriptString(n.body)} with title ${appleScriptString(n.title)}${n.subtitle ? ` subtitle ${appleScriptString(n.subtitle)}` : ''}`;
  await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 10_000 });
}

export function notify(n: Notice): Promise<void> {
  const send = override ?? osascript;
  chain = chain
    .then(() => send(n))
    .catch((err) => log('warn', 'notification failed', err))
    .then(() => (override ? undefined : new Promise<void>((r) => setTimeout(r, 1500))));
  return chain;
}

export function loginNeededNotice(school: { name: string }): Notice {
  return {
    title: `需要重新登录：${school.name}`,
    body: '自动续期没成功。打开 Course Hub 设置页点「重新登录」即可（期间截止日期由日历订阅兜底）。',
    url: `http://127.0.0.1:${PORT}/settings`,
  };
}
