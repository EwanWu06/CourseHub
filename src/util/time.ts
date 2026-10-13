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
