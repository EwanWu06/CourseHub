// Helpers for the notification history page.
import { fmtDate } from '../format.ts';

export const NOTICE_KIND: Record<string, string> = { reminder: '提醒', change: '变化', daily: '日报', weekly: '周报', login: '登录', system: '系统' };

/** Course Hub links open in the app; Canvas links in a new tab; anything else is ignored. */
export function noticeTarget(url: string | null): { internal: string } | { external: string } | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.hostname === '127.0.0.1' || u.hostname === 'localhost') return { internal: `${u.pathname}${u.search}` };
  return { external: u.toString() };
}

const dayIndex = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);

export function dayLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = dayIndex(now) - dayIndex(d);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  return fmtDate(d, now);
}
