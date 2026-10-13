// Pure helpers for task lists and the calendar (kept DOM-free so Node tests can import them).
import { fmtDate } from '../format.ts';
import type { ItemKind, TaskStatus, TaskView } from '../types.ts';

export const KIND_LABEL: Record<ItemKind, string> = {
  assignment: '作业', quiz: '测验', discussion: '讨论', page: '阅读', note: '备忘', event: '日程', manual: '手动',
};

export const CATEGORY_LABEL: Record<string, string> = {
  exam: '考试', quiz: '测验', homework: '作业', lab: '实验', project: '项目 / 论文', discussion: '讨论',
  reading: '讲课视频 / 阅读', participation: '出勤 / 参与', survey: '问卷', other: '其他',
};

export const STATUS_LABEL: Record<TaskStatus, string> = {
  done: '已完成', todo: '待完成', overdue: '已逾期', missing: '缺交', past: '已过', event: '日程',
};

const PROVIDERS: Record<string, string> = {
  macmillan: 'Macmillan', gradescope: 'Gradescope', pearson: 'Pearson', 'mcgraw-hill': 'McGraw-Hill',
  zybooks: 'zyBooks', webassign: 'WebAssign', cengage: 'Cengage', external: '外部工具',
};

export function providerNote(provider: string): string | null {
  if (provider === 'macmillan') return 'Macmillan · 以 Achieve 为准';
  const name = PROVIDERS[provider];
  return name ? `${name} · 以平台为准` : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function dayDiff(a: Date, b: Date): number {
  return Math.round((Date.UTC(a.getFullYear(), a.getMonth(), a.getDate()) - Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())) / 86_400_000);
}

export interface DayGroup { key: string; rel: string; date: string; tasks: TaskView[] }

export function groupByDay(tasks: TaskView[], now: Date = new Date()): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const t of [...tasks].filter((x) => x.dueAt).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))) {
    const d = new Date(t.dueAt!);
    const key = dateKey(d);
    if (!groups.has(key)) {
      const diff = dayDiff(d, now);
      groups.set(key, { key, rel: diff === 0 ? '今天' : diff === 1 ? '明天' : diff === -1 ? '昨天' : '', date: fmtDate(d, now), tasks: [] });
    }
    groups.get(key)!.tasks.push(t);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** A red seal for what needs attention first: 缺 missing, 逾 overdue, 考 exam, 急 due within 24h. */
export function sealFor(t: TaskView, now: Date = new Date()): string | null {
  if (t.status === 'missing') return '缺';
  if (t.status === 'overdue') return '逾';
  if (t.category === 'exam' && t.status !== 'done' && t.status !== 'past') return '考';
  if (t.status === 'todo' && t.dueAt) {
    const ms = Date.parse(t.dueAt) - now.getTime();
    if (ms >= 0 && ms < 24 * 3_600_000) return '急';
  }
  return null;
}

export function monthGrid(year: number, month: number): { date: string; inMonth: boolean; day: number }[] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7; // Monday-first
  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, 1 - offset + i);
    cells.push({ date: dateKey(d), inMonth: d.getMonth() === month, day: d.getDate() });
  }
  return cells;
}
