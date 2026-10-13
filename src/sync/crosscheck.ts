// A second opinion after every sync: Canvas's own lists — the planner, the calendar feed, the "To Do" list and the
// missing list — are compared with what Course Hub stored. Anything they show that Course Hub lacks or shows
// differently is reported. This is how a new kind of Canvas item, or a mapping mistake, is noticed before the user
// notices it. Hidden and concluded courses are left out on purpose.
import type { IcsEvent } from '../canvas/ics.ts';
import type { CanvasAssignment, CanvasPlannerItem } from '../canvas/types.ts';
import { listCourses } from '../db/courses.ts';
import type { DB } from '../db/index.ts';
import { getItem } from '../db/items.ts';
import { one } from '../db/sql.ts';
import type { ItemRow, SchoolRow } from '../db/types.ts';
import { effectiveDue, makeTaskViewer } from '../reports/data.ts';
import { courseDisplayName } from '../util/course.ts';
import { localDateStr, sameDeadline } from '../util/time.ts';

export interface CanvasTodo {
  type: string; ignore?: string; course_id?: string | null; context_name?: string;
  assignment?: { id: string; name?: string } | null; quiz?: { id: string; title?: string } | null;
}
export interface Evidence { planner?: CanvasPlannerItem[]; ics?: IcsEvent[]; todo?: CanvasTodo[]; missing?: CanvasAssignment[] }
export interface CrossCheckResult { sources: { planner: number; ics: number; todo: number; missing: number }; problems: string[] }

const DAY = 86_400_000;

/** Which Course Hub item a planner entry is; null for a kind Course Hub doesn't know. */
export function plannerItemId(schoolId: string, p: CanvasPlannerItem): string | null {
  const s = schoolId;
  switch (p.plannable_type) {
    case 'assignment': return `${s}:a:${p.plannable_id}`;
    case 'quiz': return p.plannable?.assignment_id ? `${s}:a:${p.plannable.assignment_id}` : `${s}:q:${p.plannable_id}`;
    case 'discussion_topic': return p.plannable?.assignment_id ? `${s}:a:${p.plannable.assignment_id}` : `${s}:d:${p.plannable_id}`;
    case 'sub_assignment': {
      const parent = (p.html_url ?? '').match(/\/assignments\/(\d+)/)?.[1];
      return parent && p.plannable?.sub_assignment_tag ? `${s}:a:${parent}:${p.plannable.sub_assignment_tag}` : null;
    }
    case 'assessment_request': return `${s}:pr:${p.plannable_id}`;
    case 'wiki_page': return `${s}:w:${p.plannable_id}`;
    case 'planner_note': return `${s}:n:${p.plannable_id}`;
    case 'calendar_event': return `${s}:e:${p.plannable_id}`;
    default: return null;
  }
}

const when = (iso: string | null | undefined) => {
  if (!iso) return '无日期';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export function crossCheck(db: DB, school: SchoolRow, now: Date, ev: Evidence): CrossCheckResult {
  const s = school.id;
  const courses = new Map(listCourses(db, { schoolId: s }).map((c) => [c.canvas_id, c]));
  const tracked = (canvasCourseId: string | null | undefined) => !canvasCourseId || courses.has(String(canvasCourseId));
  const where = (canvasCourseId: string | null | undefined) => {
    const c = canvasCourseId ? courses.get(String(canvasCourseId)) : undefined;
    return c ? `（${courseDisplayName(c)}）` : '';
  };
  const live = (id: string): ItemRow | null => {
    const r = getItem(db, id);
    return r && !r.removed ? r : null;
  };
  const view = makeTaskViewer(db, now);
  const problems: string[] = [];
  const sources = { planner: 0, ics: 0, todo: 0, missing: 0 };
  const checkpoints = new Map<string, string>(); // sub-assignment id → checkpoint task

  for (const p of ev.planner ?? []) {
    if (!tracked(p.course_id)) continue;
    const title = `「${p.plannable?.title ?? '(无标题)'}」${where(p.course_id)}`;
    sources.planner++;
    if (p.plannable_type === 'announcement') {
      if (!one(db, 'SELECT 1 AS x FROM topics WHERE id = $id', { id: `${s}:t:${p.plannable_id}` })) problems.push(`Canvas 待办里的公告${title}，Course Hub 里没有`);
      continue;
    }
    const id = plannerItemId(s, p);
    if (!id) {
      problems.push(`Canvas 待办里有一种 Course Hub 还不认识的条目：${title}（${p.plannable_type}），截止 ${when(p.plannable_date)}`);
      continue;
    }
    if (p.plannable_type === 'sub_assignment') checkpoints.set(String(p.plannable_id), id);
    const row = live(id);
    if (!row) problems.push(`Canvas 待办里有${title}，截止 ${when(p.plannable_date)}，Course Hub 里没有`);
    else if (p.plannable_date && !sameDeadline(effectiveDue(row), p.plannable_date)) problems.push(`${title}的时间不一致：Canvas 是 ${when(p.plannable_date)}，Course Hub 是 ${when(effectiveDue(row))}`);
  }

  for (const e of ev.ics ?? []) {
    if (e.kind === 'other' || !e.canvasId || !tracked(e.courseCanvasId)) continue;
    const t = Date.parse(e.start);
    if (t < now.getTime() - 30 * DAY || t > now.getTime() + 120 * DAY) continue;
    sources.ics++;
    const base = `${s}:${e.kind === 'assignment' ? 'a' : 'e'}:${e.canvasId}`;
    const row = live(e.checkpoint ? `${base}:${e.checkpoint}` : base);
    const title = `「${e.title}」${where(e.courseCanvasId)}`;
    if (!row) {
      problems.push(`日历订阅里有${title}，${when(e.start)}，Course Hub 里没有`);
      continue;
    }
    const due = effectiveDue(row);
    const agrees = e.allDay && e.kind === 'assignment' ? !!due && localDateStr(new Date(due)) === localDateStr(new Date(e.start)) : sameDeadline(due, e.start);
    if (!agrees) problems.push(`${title}的日期不一致：日历订阅是 ${e.allDay ? localDateStr(new Date(e.start)) : when(e.start)}，Course Hub 是 ${when(due)}`);
  }

  for (const t of ev.todo ?? []) {
    if (t.type !== 'submitting' || !tracked(t.course_id)) continue;
    const sub = t.ignore?.match(/sub_assignment_(\d+)/)?.[1];
    const id = sub ? checkpoints.get(sub) ?? null : t.assignment ? `${s}:a:${t.assignment.id}` : t.quiz ? `${s}:q:${t.quiz.id}` : null;
    if (!id) continue; // a checkpoint the planner didn't name: nothing to compare with
    sources.todo++;
    const name = t.assignment?.name ?? t.quiz?.title ?? '(无标题)';
    const row = live(id);
    if (!row) problems.push(`Canvas 的 To Do 里有「${name}」${where(t.course_id)}，Course Hub 里没有`);
    else if (view(row).status === 'done' && !row.local_done && !row.canvas_done && !row.excused) problems.push(`Canvas 说「${name}」${where(t.course_id)}还没交，Course Hub 却显示已完成`);
  }

  for (const a of ev.missing ?? []) {
    const courseId = (a as { course_id?: string }).course_id;
    if (!tracked(courseId)) continue;
    sources.missing++;
    const row = live(`${s}:a:${a.id}`);
    if (!row) problems.push(`Canvas 标记缺交的「${a.name}」${where(courseId)}，Course Hub 里没有`);
    else if (!row.missing) problems.push(`Canvas 标记「${a.name}」${where(courseId)}缺交，Course Hub 没有标出来`);
  }
  return { sources, problems };
}
