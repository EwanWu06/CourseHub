// Merges a school's ICS feed. With a working API session the API wins and ICS only fills gaps;
// without one, ICS keeps deadlines current (due-date moves are still detected).
import type { IcsEvent } from '../canvas/ics.ts';
import { listCourses } from '../db/courses.ts';
import { getItem, itemToUpsert, upsertItem } from '../db/items.ts';
import type { ItemUpsert } from '../db/items.ts';
import { noteItemChange } from './changes.ts';
import type { SyncContext } from './context.ts';

type IcsCtx = Pick<SyncContext, 'db' | 'school' | 'now' | 'firstSync' | 'stats'> & { apiOk: boolean };

export async function mergeIcs(ctx: IcsCtx, events: IcsEvent[]): Promise<number> {
  const courses = new Map(listCourses(ctx.db, { schoolId: ctx.school.id, includeHidden: true, activeOnly: false }).map((c) => [c.canvas_id, c]));
  let touched = 0;
  for (const ev of events) {
    if (ev.kind === 'other' || !ev.canvasId) continue;
    const course = ev.courseCanvasId ? courses.get(ev.courseCanvasId) : undefined;
    const id = `${ctx.school.id}:${ev.kind === 'assignment' ? 'a' : 'e'}:${ev.canvasId}`;
    const existing = getItem(ctx.db, id);
    if (existing) {
      if (ctx.apiOk && existing.source === 'api') continue;
      if (existing.due_at === ev.start && existing.end_at === (ev.kind === 'event' ? ev.end : existing.end_at)) continue;
      const next: ItemUpsert = { ...itemToUpsert(existing), due_at: ev.start, end_at: ev.kind === 'event' ? ev.end : existing.end_at };
      upsertItem(ctx.db, next);
      noteItemChange(ctx, existing, next);
      touched++;
      continue;
    }
    const title = course || !ev.courseLabel ? ev.title : `${ev.title} [${ev.courseLabel}]`;
    const row: ItemUpsert = {
      id, school_id: ctx.school.id, course_id: course?.id ?? null, kind: ev.kind === 'assignment' ? 'assignment' : 'event', title,
      due_at: ev.start, end_at: ev.kind === 'event' ? ev.end : null, unlock_at: null, lock_at: null, points: null, html_url: ev.url,
      provider: 'canvas', description_html: ev.description, submission_types: null,
      sub_state: ev.kind === 'assignment' ? 'unknown' : null, submitted_at: null, missing: 0, late: 0, excused: 0, score: null,
      grade: null, canvas_done: 0, source: 'ics', module_id: null, group_id: null,
    };
    upsertItem(ctx.db, row);
    noteItemChange(ctx, undefined, row);
    touched++;
  }
  return touched;
}
