import type { DB } from './index.ts';
import type { CourseRow } from './types.ts';
import { all, one, pick, placeholders, run, updateRow } from './sql.ts';

export type CourseUpsert = Omit<CourseRow, 'nickname' | 'color' | 'hidden' | 'week1'>;

const COLS = ['id', 'school_id', 'canvas_id', 'name', 'code', 'term_name', 'start_at', 'end_at', 'html_url',
  'syllabus_html', 'tabs', 'current_score', 'current_grade', 'active', 'updated_at'] as const;
// syllabus_html/tabs are filled by the content sync; a null from the course listing must not wipe them.
const KEEP_IF_NULL = new Set(['syllabus_html', 'tabs']);

export function upsertCourse(db: DB, row: CourseUpsert): void {
  const r = pick(row as unknown as Record<string, unknown>, COLS);
  const updates = COLS.filter((c) => c !== 'id').map((c) =>
    KEEP_IF_NULL.has(c) ? `${c} = COALESCE(excluded.${c}, courses.${c})` : `${c} = excluded.${c}`);
  run(db, `INSERT INTO courses (${COLS.join(', ')}) VALUES (${COLS.map((c) => '$' + c).join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${updates.join(', ')}`, r);
}

export function setCourseSyllabus(db: DB, id: string, syllabus_html: string | null, tabs: string[] | null): void {
  updateRow(db, 'courses', { syllabus_html, tabs: tabs ? JSON.stringify(tabs) : null }, 'id = $__id', { __id: id });
}

export function getCourse(db: DB, id: string): CourseRow | undefined {
  return one<CourseRow>(db, 'SELECT * FROM courses WHERE id = $id', { id });
}

export function listCourses(db: DB, opts: { includeHidden?: boolean; activeOnly?: boolean; schoolId?: string } = {}): CourseRow[] {
  const where: string[] = [];
  const params: Record<string, unknown> = {};
  if (!opts.includeHidden) where.push('hidden = 0');
  if (opts.activeOnly ?? true) where.push('active = 1');
  if (opts.schoolId) {
    where.push('school_id = $schoolId');
    params.schoolId = opts.schoolId;
  }
  return all<CourseRow>(db, `SELECT * FROM courses ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY school_id, name`, params);
}

export function updateCourseUser(db: DB, id: string, patch: { nickname?: string | null; color?: string | null; hidden?: boolean }): void {
  const p: Record<string, unknown> = {};
  if ('nickname' in patch) p.nickname = patch.nickname?.trim() || null;
  if ('color' in patch) p.color = patch.color ?? null;
  if ('hidden' in patch) p.hidden = patch.hidden ? 1 : 0;
  updateRow(db, 'courses', p, 'id = $__id', { __id: id });
}

export function setCourseWeek1(db: DB, id: string, week1: string | null): void {
  updateRow(db, 'courses', { week1 }, 'id = $__id', { __id: id });
}

/** Courses of a school not in keepIds become inactive (dropped or concluded). */
export function markInactive(db: DB, schoolId: string, keepIds: string[]): void {
  const ph = placeholders('k', keepIds);
  const keep = keepIds.length ? `id IN (${ph.sql})` : '0';
  run(db, `UPDATE courses SET active = CASE WHEN ${keep} THEN 1 ELSE 0 END WHERE school_id = $schoolId`, { ...ph.params, schoolId: schoolId });
}
