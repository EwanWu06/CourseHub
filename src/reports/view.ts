// Helpers for showing stored reports: a one-line headline, and today's status for the tasks they list.
import type { DB } from '../db/index.ts';
import { getItem } from '../db/items.ts';
import { makeTaskViewer } from './data.ts';
import type { TaskView } from './data.ts';
import { dailyTitle } from './daily.ts';
import type { DailyReport } from './daily.ts';
import { weeklyCounts } from './weekly.ts';
import type { WeeklyReport } from './weekly.ts';

export type AnyReport = DailyReport | WeeklyReport;

export function headlineOf(r: AnyReport): string {
  if (r.ai?.headline) return r.ai.headline;
  if (r.kind === 'daily') return dailyTitle(r.data);
  const { deadlines, exams } = weeklyCounts(r.data);
  return `${deadlines} 项截止${exams ? ` · ${exams} 场考试` : ''}`;
}

/** Reports are snapshots; this re-reads each listed task so ticks and submissions made since show up. */
export function refreshReport(db: DB, r: AnyReport, now: Date): AnyReport {
  const view = makeTaskViewer(db, now);
  const fresh = (t: TaskView): TaskView => {
    const row = getItem(db, t.id);
    return row && !row.removed ? view(row) : t;
  };
  const list = (ts: TaskView[] | undefined) => (ts ?? []).map(fresh);
  if (r.kind === 'daily') {
    const d = r.data;
    return {
      ...r,
      data: { ...d, overdue: list(d.overdue), dueToday: list(d.dueToday), next3Days: list(d.next3Days), laterThisWeek: list(d.laterThisWeek), eventsToday: list(d.eventsToday), examsSoon: list(d.examsSoon) },
    };
  }
  const n = r.data.next;
  return { ...r, data: { ...r.data, next: { ...n, days: n.days.map((x) => ({ ...x, items: list(x.items) })), exams: list(n.exams) } } };
}
