import type { DB } from './index.ts';
import { tx } from './index.ts';
import type { GuideRow, WeekRow } from './types.ts';
import { all, insertRow, one, pick, run, updateRow } from './sql.ts';

export function replaceWeeks(db: DB, courseId: string, rows: WeekRow[]): void {
  tx(db, () => {
    run(db, 'DELETE FROM weeks WHERE course_id = $courseId', { courseId });
    for (const r of rows) insertRow(db, 'weeks', { ...r });
  });
}

export function listWeeks(db: DB, courseId: string): WeekRow[] {
  return all<WeekRow>(db, 'SELECT * FROM weeks WHERE course_id = $courseId ORDER BY week', { courseId });
}

export function getGuide(db: DB, courseId: string, week: number): GuideRow | undefined {
  return one<GuideRow>(db, 'SELECT * FROM guides WHERE course_id = $courseId AND week = $week', { courseId, week });
}

export function listGuides(db: DB, courseId: string): GuideRow[] {
  return all<GuideRow>(db, 'SELECT * FROM guides WHERE course_id = $courseId ORDER BY week', { courseId });
}

const GUIDE_FIELDS = ['status', 'content', 'input_hash', 'model', 'generated_at', 'error', 'attempts', 'next_attempt_at'] as const;

export function upsertGuide(db: DB, row: Partial<GuideRow> & { course_id: string; week: number }): void {
  const fields: Record<string, unknown> = pick(row as Record<string, unknown>, GUIDE_FIELDS.filter((k) => k in row));
  if (!getGuide(db, row.course_id, row.week)) {
    insertRow(db, 'guides', { status: 'queued', attempts: 0, ...fields, course_id: row.course_id, week: row.week });
    return;
  }
  updateRow(db, 'guides', fields, 'course_id = $__c AND week = $__w', { __c: row.course_id, __w: row.week });
}

export function listGuidesByStatus(db: DB, statuses: GuideRow['status'][]): GuideRow[] {
  const params: Record<string, unknown> = {};
  statuses.forEach((s, i) => (params[`s${i}`] = s));
  return all<GuideRow>(db, `SELECT * FROM guides WHERE status IN (${statuses.map((_, i) => '$s' + i).join(', ')})`, params);
}
