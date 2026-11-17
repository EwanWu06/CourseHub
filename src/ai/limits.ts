// When the Claude subscription's usage limit is hit, background AI work waits for the reset time the CLI reports
// ("You've hit your weekly limit · resets Nov 3 at 5pm (America/Los_Angeles)") instead of retrying every hour.
import type { DB } from '../db/index.ts';
import { getKV, setKV } from '../db/settings.ts';

const KEY = 'ai_paused_until';
const MAX_PAUSE_MS = 8 * 86_400_000; // a weekly limit at most; anything further out is a misread
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function partsIn(t: number, timeZone: string | undefined): Record<'year' | 'month' | 'day' | 'hour' | 'minute', number> {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(new Date(t));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** The instant a wall-clock time in `timeZone` happens (month 1–12). */
function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string | undefined): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const offset = (t: number) => {
    const p = partsIn(t, timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000;
  };
  let t = wall - offset(wall);
  t = wall - offset(t); // second pass settles a guess that landed across a DST change
  return t;
}

/** When the usage limit in a Claude CLI error message lifts; null when the message doesn't say (or says nonsense). */
export function parseResetTime(message: string, now: Date = new Date()): Date | null {
  const nowMs = now.getTime();
  const sane = (t: number) => (Number.isFinite(t) && t > nowMs && t - nowMs <= MAX_PAUSE_MS ? new Date(t) : null);
  const epoch = message.match(/limit reached\|(\d{10})\b/i); // older CLIs: "Claude AI usage limit reached|1730000000"
  if (epoch) return sane(Number(epoch[1]) * 1000);
  const m = message.match(/resets\s+(?:on\s+)?(?:([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?(?:\s*\(([^)]+)\))?/i);
  if (!m) return null;
  let tz: string | undefined = m[7]?.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch {
    tz = undefined; // unknown zone name: the Mac's own
  }
  const hour = (Number(m[4]) % 12) + (m[6].toLowerCase() === 'p' ? 12 : 0);
  const minute = Number(m[5] ?? 0);
  const today = partsIn(nowMs, tz);
  if (m[1]) {
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    if (month === 0) return null;
    let year = m[3] ? Number(m[3]) : today.year;
    let t = zonedTime(year, month, Number(m[2]), hour, minute, tz);
    if (!m[3] && t < nowMs - 86_400_000) t = zonedTime(++year, month, Number(m[2]), hour, minute, tz); // "Jan 2" seen in late December
    return sane(t);
  }
  let t = zonedTime(today.year, today.month, today.day, hour, minute, tz);
  if (t <= nowMs) t += 86_400_000; // "resets 5pm" said after 5pm means tomorrow
  return sane(t);
}

/** Background AI work is on hold until this time (the usage limit was hit); null = go ahead. */
export function aiPausedUntil(db: DB, now: Date = new Date()): Date | null {
  const raw = getKV(db, KEY);
  const t = raw ? Date.parse(raw) : NaN;
  return Number.isFinite(t) && t > now.getTime() ? new Date(t) : null;
}

/** Records the outcome of a real call: a limit message with a reset time pauses AI until then, a success lifts it. */
export function noteAiOutcome(db: DB, outcome: { ok: boolean; rateLimited: boolean; error?: string }, now: Date = new Date()): void {
  if (outcome.ok) {
    if (getKV(db, KEY)) setKV(db, KEY, '');
    return;
  }
  if (!outcome.rateLimited || !outcome.error) return;
  const until = parseResetTime(outcome.error, now);
  if (until) setKV(db, KEY, until.toISOString());
}

/** "11月3日 17:00" — when AI work resumes, for messages. */
export function formatResume(t: Date): string {
  const p = partsIn(t.getTime(), undefined);
  return `${p.month}月${p.day}日 ${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** The earliest a retry is worth making: `wanted`, or the end of a usage-limit pause if that is later. */
export function notBeforePause(db: DB, wanted: Date, now: Date = new Date()): Date {
  const until = aiPausedUntil(db, now);
  return until && until > wanted ? until : wanted;
}
