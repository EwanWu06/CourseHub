import type { CanvasCourse } from '../canvas/types.ts';
import { listCourses, markInactive, upsertCourse } from '../db/courses.ts';
import type { CourseRow } from '../db/types.ts';
import type { SyncContext } from './context.ts';

const KEEP_ENDED_FOR_MS = 7 * 86_400_000;

/** Current (non-concluded) courses; everything else for the school is marked inactive. Returns visible+hidden active courses. */
export async function syncCourses(ctx: SyncContext): Promise<CourseRow[]> {
  const raw = await ctx.client.getAll<CanvasCourse>('/api/v1/courses', { enrollment_state: 'active', 'include[]': ['term', 'total_scores'] });
  const cutoff = ctx.now.getTime() - KEEP_ENDED_FOR_MS;
  const keep: string[] = [];
  for (const c of raw) {
    if (c.access_restricted_by_date || !c.name) continue;
    const end = c.end_at ?? c.term?.end_at ?? null;
    if (end && Date.parse(end) < cutoff) continue;
    const enrollment = c.enrollments?.find((e) => e.type === 'student' || e.type === 'StudentEnrollment');
    const id = `${ctx.school.id}:${c.id}`;
    upsertCourse(ctx.db, {
      id, school_id: ctx.school.id, canvas_id: c.id, name: c.name, code: c.course_code ?? null, term_name: c.term?.name ?? null,
      start_at: c.start_at ?? c.term?.start_at ?? null, end_at: end, html_url: `${ctx.school.base_url}/courses/${c.id}`,
      syllabus_html: null, tabs: null, current_score: enrollment?.computed_current_score ?? null,
      current_grade: enrollment?.computed_current_grade ?? null, active: 1, updated_at: ctx.now.toISOString(),
    });
    keep.push(id);
  }
  markInactive(ctx.db, ctx.school.id, keep);
  ctx.stats.courses = keep.length;
  return listCourses(ctx.db, { schoolId: ctx.school.id, includeHidden: true });
}
