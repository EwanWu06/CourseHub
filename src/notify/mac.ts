// macOS notifications. Delivered through the small "Course Hub" applet (notifier/), so banners carry our name and
// clicking one opens the page it is about; plain osascript when the applet isn't built. Serialized, ≥2 s apart.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { PORT, ROOT_DIR, paths } from '../config.ts';
import { writeFileAtomic } from '../util/fs.ts';
import { log } from '../util/log.ts';

const execFileAsync = promisify(execFile);

export type NoticeKind = 'reminder' | 'change' | 'daily' | 'weekly' | 'login' | 'system';
export interface Notice { title: string; subtitle?: string; body: string; url?: string; kind?: NoticeKind }

let override: ((n: Notice) => Promise<void>) | null = null;
let recorder: ((n: Notice) => void) | null = null;

/** Every notice is also kept in the app (main.ts records them in the database). */
export function setNoticeRecorder(fn: ((n: Notice) => void) | null): void {
  recorder = fn;
}
let chain: Promise<void> = Promise.resolve();

export function setNotifier(fn: ((n: Notice) => Promise<void>) | null): void {
  override = fn;
}

export function appleScriptString(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export const NOTIFIER_APP = path.join(ROOT_DIR, 'notifier', 'Course Hub.app');

/** What the applet reads: title, subtitle, body and url, one per line. */
export function pendingText(n: Notice): string {
  const line = (s: string | undefined) => (s ?? '').replace(/\s*\n\s*/g, ' ').trim();
  return `${line(n.title)}\n${line(n.subtitle)}\n${line(n.body)}\n${line(n.url)}\n`;
}

async function viaApplet(n: Notice): Promise<boolean> {
  // The applet finds data/notify next to itself, so it only serves the default data directory.
  if (!existsSync(NOTIFIER_APP) || paths().notify !== path.join(ROOT_DIR, 'data', 'notify')) return false;
  mkdirSync(paths().notify, { recursive: true });
  const file = path.join(paths().notify, 'pending.txt');
  writeFileAtomic(file, pendingText(n));
  await execFileAsync('/usr/bin/open', ['-g', '-a', NOTIFIER_APP], { timeout: 10_000 });
  // wait until the applet has taken it, so the next notice can't overwrite this one
  for (let i = 0; i < 50 && existsSync(file); i++) await new Promise((r) => setTimeout(r, 100));
  return true;
}

async function deliver(n: Notice): Promise<void> {
  try {
    if (await viaApplet(n)) return;
  } catch (err) {
    log('warn', 'notifier applet failed, falling back to osascript', err);
  }
  await osascript(n);
}

async function osascript(n: Notice): Promise<void> {
  const script = `display notification ${appleScriptString(n.body)} with title ${appleScriptString(n.title)}${n.subtitle ? ` subtitle ${appleScriptString(n.subtitle)}` : ''}`;
  await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 10_000 });
}

export function notify(n: Notice): Promise<void> {
  try {
    recorder?.(n);
  } catch (err) {
    log('warn', 'could not record notice', err);
  }
  // the test suite never shows real banners
  const send = override ?? (process.env.COURSEHUB_NO_NOTIFY === '1' ? async () => undefined : deliver);
  chain = chain
    .then(() => send(n))
    .catch((err) => log('warn', 'notification failed', err))
    .then(() => (override ? undefined : new Promise<void>((r) => setTimeout(r, 2000))));
  return chain;
}

export function loginNeededNotice(school: { name: string; status_detail?: string | null }): Notice {
  return {
    kind: 'login',
    title: `需要重新登录：${school.name}`,
    // the school's own reason when it has one (renewal failed, token expired, no login on this Mac yet)
    body: school.status_detail
      ? `${school.status_detail}（期间截止日期由日历订阅兜底）`
      : '自动续期没成功。打开 Course Hub 设置页点「重新登录」即可（期间截止日期由日历订阅兜底）。',
    url: `http://127.0.0.1:${PORT}/settings`,
  };
}
