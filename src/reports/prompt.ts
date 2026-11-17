// Compact, Chinese-labelled task data for the report prompts. Times are pre-formatted in local time so the
// model never has to do date arithmetic (and is told not to write dates at all).
import { describeDue } from '../util/time.ts';
import type { TaskView } from './data.ts';

const CATEGORY_ZH: Record<string, string> = {
  exam: '考试', quiz: '测验', homework: '作业', lab: '实验', project: '项目/论文', discussion: '讨论',
  reading: '讲课视频/阅读', participation: '出勤/参与', survey: '问卷', other: '其他',
};
const KIND_ZH: Record<string, string> = { assignment: '作业', quiz: '测验', discussion: '讨论', page: '阅读', note: '备忘', event: '日程', manual: '手动' };
const STATUS_ZH: Partial<Record<TaskView['status'], string>> = { overdue: '已逾期', missing: '缺交' };

export function typeLabel(t: TaskView): string {
  return (t.category && CATEGORY_ZH[t.category]) || KIND_ZH[t.kind] || t.kind;
}

export function taskLabel(t: TaskView): string {
  return `${t.courseName ?? ''} ${t.title}`.trim();
}

export function compactTask(t: TaskView, now: Date): Record<string, unknown> {
  return {
    item_id: t.id, course: t.courseName, title: t.title, type: typeLabel(t),
    due: describeDue(t.dueAt, now, { dateOnly: t.dueDateOnly }), minutes: t.estMinutes,
    ...(t.points !== null ? { points: t.points } : {}), ...(STATUS_ZH[t.status] ? { status: STATUS_ZH[t.status] } : {}),
    ...(t.note ? { note: t.note } : {}),
    // "已交" in Canvas but the replies / peer reviews are still owed
    ...(t.remaining && t.status !== 'done' ? { still_needed: t.remaining } : {}),
    ...(t.requirements?.notes.length ? { rules: t.requirements.notes.map((n) => n.text) } : {}),
  };
}

export function hoursLabel(minutes: number): string {
  return minutes < 60 ? `约 ${minutes} 分钟` : `约 ${Math.round(minutes / 30) / 2} 小时`;
}
