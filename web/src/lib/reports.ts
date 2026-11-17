// Helpers for the report pages (pure; local time).
import { fmtDate } from '../format.ts';

export type Slot = '上午' | '下午' | '晚上';
export interface PlanBlock { slot: Slot; title: string; item_id?: string; minutes: number; note?: string }

const SLOTS: Slot[] = ['上午', '下午', '晚上'];
const noon = (day: string) => new Date(`${day}T12:00:00`);

/** 'daily' → "11月1日 周日"; 'weekly' (period = Monday) → "11月2日 – 11月8日". */
export function periodLabel(type: 'daily' | 'weekly', period: string): string {
  const start = noon(period);
  if (type === 'daily') return fmtDate(start, start);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return `${start.getMonth() + 1}月${start.getDate()}日 – ${end.getMonth() + 1}月${end.getDate()}日`;
}

export function groupBlocks(blocks: PlanBlock[]): { slot: Slot; blocks: PlanBlock[] }[] {
  return SLOTS.map((slot) => ({ slot, blocks: blocks.filter((b) => b.slot === slot) })).filter((g) => g.blocks.length > 0);
}

export function planMinutes(blocks: PlanBlock[]): number {
  return blocks.reduce((n, b) => n + (b.minutes || 0), 0);
}

/** Bar width in % of the busiest day; anything non-zero stays visible. */
export function workloadWidth(minutes: number, max: number): number {
  if (minutes <= 0 || max <= 0) return 0;
  return Math.max(4, Math.round((minutes / max) * 100));
}

export function hoursText(minutes: number): string {
  if (minutes <= 0) return '—';
  return minutes < 60 ? `${minutes} 分钟` : `${Math.round(minutes / 30) / 2} 小时`;
}
