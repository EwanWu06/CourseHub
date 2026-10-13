// Persists the week model for a course: courses.week1, modules.week_*, and one `weeks` row per week.
import type { DB } from '../db/index.ts';
import { getCourse, setCourseWeek1 } from '../db/courses.ts';
import { listModules, setModuleWeek } from '../db/content.ts';
import { all, one } from '../db/sql.ts';
import { listWeeks, replaceWeeks } from '../db/study.ts';
import type { WeekRow } from '../db/types.ts';
import { addDays } from '../util/time.ts';
import { assignModuleWeeks, inferWeek1, weekOf } from './infer.ts';

const MAX_WEEKS = 30;

export function rebuildWeeks(db: DB, courseId: string): void {
  const course = getCourse(db, courseId);
  if (!course) return;
  const modules = listModules(db, courseId);
  const dated = all<{ module_id: string | null; due_at: string }>(db,
    'SELECT module_id, due_at FROM items WHERE course_id = $courseId AND due_at IS NOT NULL AND removed = 0', { courseId });
  const week1 = inferWeek1({
    courseStart: course.start_at, termStart: null,
    dates: [...dated.map((d) => d.due_at), ...modules.map((m) => m.unlock_at).filter((u): u is string => !!u)],
  });
  setCourseWeek1(db, courseId, week1);

  const dueByModule = new Map<string, string[]>();
  for (const d of dated) if (d.module_id) dueByModule.set(d.module_id, [...(dueByModule.get(d.module_id) ?? []), d.due_at]);
  const assigned = assignModuleWeeks(modules.map((m) => ({ id: m.id, name: m.name, unlockAt: m.unlock_at, dueDates: dueByModule.get(m.id) ?? [] })), week1);
  for (const m of modules) {
    if (m.week_source === 'syllabus') continue; // AI mapping from the syllabus wins over heuristics
    const w = assigned.get(m.id)!;
    if (m.week_start !== w.start || m.week_end !== w.end || m.week_source !== w.source) {
      setModuleWeek(db, m.id, { week_start: w.start, week_end: w.end, week_source: w.source });
    }
  }
  if (!week1) {
    replaceWeeks(db, courseId, []);
    return;
  }

  const fresh = listModules(db, courseId);
  const moduleWeekMax = Math.max(0, ...fresh.map((m) => m.week_end ?? 0));
  const endWeek = course.end_at ? weekOf(week1, course.end_at) : 0;
  const count = Math.min(MAX_WEEKS, Math.max(endWeek, moduleWeekMax, 1));
  const previous = new Map(listWeeks(db, courseId).map((w) => [w.week, w]));
  const rows: WeekRow[] = [];
  for (let week = 1; week <= count; week++) {
    const names = fresh.filter((m) => m.week_start !== null && m.week_start <= week && (m.week_end ?? m.week_start) >= week).map((m) => m.name);
    const prev = previous.get(week);
    rows.push({
      course_id: courseId, week, start_date: addDays(week1, 7 * (week - 1)), title: names.length ? names.join(' / ') : null,
      topics: prev?.topics ?? '[]', source: prev?.source === 'syllabus' ? 'syllabus' : 'calc',
    });
  }
  replaceWeeks(db, courseId, rows);
}

export function currentWeek(db: DB, courseId: string, now: Date): number | null {
  const week1 = getCourse(db, courseId)?.week1;
  return week1 ? weekOf(week1, now.toISOString()) : null;
}

export function lastWeek(db: DB, courseId: string): number | null {
  return one<{ w: number | null }>(db, 'SELECT MAX(week) AS w FROM weeks WHERE course_id = $courseId', { courseId })?.w ?? null;
}
