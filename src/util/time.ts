// Calendar helpers. Everything here works in process-local time (the Mac's
// time zone); date strings are 'YYYY-MM-DD' calendar dates.

const pad = (n: number) => String(n).padStart(2, '0');

export function parseDateStr(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

export function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Calendar-day arithmetic on a date string; immune to DST because it never touches wall-clock time. */
export function addDays(dateStr: string, n: number): string {
  const { y, m, d } = parseDateStr(dateStr);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function daysBetween(a: string, b: string): number {
  const pa = parseDateStr(a);
  const pb = parseDateStr(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86_400_000);
}

/** Accepts a Date, an ISO timestamp, or a plain 'YYYY-MM-DD' calendar date. */
function toDateStr(d: Date | string): string {
  if (typeof d !== 'string') return localDateStr(d);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : localDateStr(new Date(d));
}

export function mondayOf(d: Date | string): string {
  const ds = toDateStr(d);
  const { y, m, d: day } = parseDateStr(ds);
  const weekday = new Date(Date.UTC(y, m - 1, day)).getUTCDay(); // 0 = Sunday
  return addDays(ds, -((weekday + 6) % 7));
}

export function atLocal(dateStr: string, hh: number, mm: number): Date {
  const { y, m, d } = parseDateStr(dateStr);
  return new Date(y, m - 1, d, hh, mm, 0, 0);
}

const WEEKDAYS_ZH = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

export function weekdayZh(dateStr: string): string {
  const { y, m, d } = parseDateStr(dateStr);
  return WEEKDAYS_ZH[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

/** Chinese wording of a due time relative to now — the same phrasing as the web UI's fmtDue. */
export function describeDue(iso: string | null, now: Date, opts: { dateOnly?: boolean } = {}): string {
  if (!iso) return '无截止日期';
  const d = new Date(iso);
  const day = localDateStr(d);
  const diff = daysBetween(localDateStr(now), day);
  const time = opts.dateOnly ? '' : ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (diff === 0) return `今天${time}`;
  if (diff === 1) return `明天${time}`;
  if (diff === -1) return `昨天${time}`;
  if (diff >= 2 && diff <= 6) return `${weekdayZh(day)}${time}`;
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`} ${weekdayZh(day)}${time}`;
}

/** Two deadlines are the same when they fall in the same minute (feeds carry seconds, APIs sometimes milliseconds). */
export function sameDeadline(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return Math.abs(Date.parse(a) - Date.parse(b)) < 60_000;
}
