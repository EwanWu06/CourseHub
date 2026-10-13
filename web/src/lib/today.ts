// Helpers for the Today page: exam countdowns and homework grouped by day (pure; local time).
import { weekdayName } from '../format.ts';
import type { TaskView } from '../types.ts';

const dayIndex = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
const daysUntil = (iso: string, now: Date) => dayIndex(new Date(iso)) - dayIndex(now);

/** "今天" / "明天" / "后天" / "8 天后" */
export function examCountdown(iso: string, now: Date = new Date()): string {
  const d = daysUntil(iso, now);
  if (d <= 0) return '今天';
  if (d === 1) return '明天';
  if (d === 2) return '后天';
  return `${d} 天后`;
}

export function examUrgency(iso: string, now: Date = new Date()): 'hot' | 'soon' | 'later' {
  const d = daysUntil(iso, now);
  return d <= 1 ? 'hot' : d <= 7 ? 'soon' : 'later';
}

/** The "范围：…" part the syllabus reader adds to an exam's note. */
export function examScope(note: string | null): string | null {
  const m = note ? /范围：(.+)$/.exec(note) : null;
  return m ? m[1].trim() : null;
}

export interface HomeworkDay { key: string; label: string; tasks: TaskView[]; minutes: number }

function dayLabel(d: Date, now: Date): string {
  const diff = dayIndex(d) - dayIndex(now);
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return `${diff === 0 ? '今天' : diff === 1 ? '明天' : weekdayName(d)} ${md}`;
}

/** Overdue first, then open work by day (with the day's estimated minutes); finished or passed work set aside. */
export function homeworkDays(tasks: TaskView[], now: Date = new Date()): { overdue: TaskView[]; days: HomeworkDay[]; done: TaskView[] } {
  const overdue = tasks.filter((t) => t.status === 'overdue' || t.status === 'missing');
  const done = tasks.filter((t) => t.status === 'done' || t.status === 'past');
  const open = tasks.filter((t) => t.dueAt && !overdue.includes(t) && !done.includes(t)).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const days: HomeworkDay[] = [];
  for (const t of open) {
    const d = new Date(t.dueAt!);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    let day = days.find((x) => x.key === key);
    if (!day) days.push((day = { key, label: dayLabel(d, now), tasks: [], minutes: 0 }));
    day.tasks.push(t);
    day.minutes += t.estMinutes;
  }
  return { overdue, days, done };
}

/** Header numbers over the work list: overdue/missing, due today, due in the next 3 days (open items only). */
export function homeworkCounts(tasks: TaskView[], now: Date = new Date()): { overdue: number; today: number; next3: number } {
  const open = tasks.filter((t) => t.status === 'todo' && t.dueAt);
  return {
    overdue: tasks.filter((t) => t.status === 'overdue' || t.status === 'missing').length,
    today: open.filter((t) => daysUntil(t.dueAt!, now) === 0).length,
    next3: open.filter((t) => { const d = daysUntil(t.dueAt!, now); return d >= 1 && d <= 3; }).length,
  };
}

export type HomeworkEntry = { task: TaskView } | { key: string; bundle: TaskView[]; minutes: number };

/** 3+ items of one category from one course due at the same moment (a week's lecture videos) become one row. */
export function bundleTasks(tasks: TaskView[]): HomeworkEntry[] {
  const keyOf = (t: TaskView) => `${t.courseId}|${t.category ?? t.kind}|${t.dueAt}`;
  const counts = new Map<string, number>();
  for (const t of tasks) counts.set(keyOf(t), (counts.get(keyOf(t)) ?? 0) + 1);
  const out: HomeworkEntry[] = [];
  const bundles = new Map<string, { key: string; bundle: TaskView[]; minutes: number }>();
  for (const t of tasks) {
    const key = keyOf(t);
    if ((counts.get(key) ?? 0) < 3) {
      out.push({ task: t });
      continue;
    }
    let b = bundles.get(key);
    if (!b) {
      b = { key, bundle: [], minutes: 0 };
      bundles.set(key, b);
      out.push(b);
    }
    b.bundle.push(t);
    b.minutes += t.estMinutes;
  }
  return out;
}
