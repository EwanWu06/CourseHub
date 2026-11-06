// Everything with a date: assignments (+ submission state), ungraded quizzes, calendar events,
// planner-only items (page to-dos, personal notes) and the missing-submissions flag.
import { CanvasForbiddenError, CanvasNotFoundError } from '../canvas/client.ts';
import type { CanvasAssignment, CanvasAssignmentGroup, CanvasCalendarEvent, CanvasPlannerItem, CanvasQuiz } from '../canvas/types.ts';
import { upsertAssignmentGroup } from '../db/content.ts';
import { all, run } from '../db/sql.ts';
import { CHECKPOINT_LABEL, checkpointsOf, getItem, markRemovedExcept, setItemFlags, upsertItem } from '../db/items.ts';
import { nowIso } from '../db/index.ts';
import type { ItemUpsert } from '../db/items.ts';
import type { CourseRow, ItemKind } from '../db/types.ts';
import { instructionsOf, isCanvasDiscussion, isDiscussionLike } from '../logic/assignment.ts';
import { milestoneDate } from '../logic/instructions.ts';
import { noteItemChange } from './changes.ts';
import type { SyncContext } from './context.ts';
import { detectProvider } from './providers.ts';

const DAY = 86_400_000;

function save(ctx: SyncContext, row: ItemUpsert): void {
  const { prev } = upsertItem(ctx.db, row);
  noteItemChange(ctx, prev, row);
}

function absolute(ctx: SyncContext, url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('http') ? url : ctx.school.base_url + url;
}

function assignmentKind(a: CanvasAssignment): ItemKind {
  const types = a.submission_types ?? [];
  if (a.is_quiz_assignment || a.is_quiz_lti_assignment || types.includes('online_quiz')) return 'quiz';
  if (types.includes('discussion_topic') || a.discussion_topic) return 'discussion';
  return 'assignment';
}

function blankItem(ctx: SyncContext, id: string, course: CourseRow | undefined, kind: ItemKind, title: string): ItemUpsert {
  const prev = getItem(ctx.db, id);
  return {
    id, school_id: ctx.school.id, course_id: course?.id ?? null, kind, title, due_at: null, end_at: null, unlock_at: null,
    lock_at: null, points: null, html_url: null, provider: 'canvas', description_html: null, submission_types: null,
    sub_state: null, submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null,
    canvas_done: prev?.canvas_done ?? 0, source: 'api', module_id: prev?.module_id ?? null, group_id: prev?.group_id ?? null,
  };
}

export function assignmentRow(ctx: SyncContext, course: CourseRow, a: CanvasAssignment): ItemUpsert {
  const id = `${ctx.school.id}:a:${a.id}`;
  const s = a.submission ?? null;
  if (a.quiz_id) ctx.quizToAssignment.set(String(a.quiz_id), a.id);
  if (a.discussion_topic?.id) ctx.topicToAssignment.set(String(a.discussion_topic.id), a.id);
  return {
    ...blankItem(ctx, id, course, assignmentKind(a), a.name),
    due_at: a.due_at ?? null, unlock_at: a.unlock_at ?? null, lock_at: a.lock_at ?? null, points: a.points_possible ?? null,
    html_url: a.html_url ?? `${course.html_url}/assignments/${a.id}`, provider: detectProvider(a),
    description_html: a.description ?? null, submission_types: JSON.stringify(a.submission_types ?? []),
    group_id: a.assignment_group_id ? `${ctx.school.id}:g:${a.assignment_group_id}` : null,
    sub_state: s?.workflow_state ?? null, submitted_at: s?.submitted_at ?? null, missing: s?.missing ? 1 : 0,
    late: s?.late ? 1 : 0, excused: s?.excused ? 1 : 0, score: s?.score ?? null, grade: s?.grade ?? null,
  };
}

const HANDED_IN = new Set(['submitted', 'graded', 'pending_review']);

/**
 * A discussion whose instructions set an earlier deadline for the first post ("Initial Post Due Thursday") while
 * Canvas has one date (Sunday): the first post becomes its own task on that day. Its state is the student's own
 * top-level post where Canvas lists their entries, else the discussion's.
 */
function initialPostRow(ctx: SyncContext, course: CourseRow, a: CanvasAssignment, parent: ItemUpsert): ItemUpsert | null {
  if (a.has_sub_assignments || !a.due_at || !isDiscussionLike(a)) return null;
  const ref = instructionsOf(a).postDue?.value;
  const at = ref ? milestoneDate(a.due_at, ref) : null;
  if (!at) return null;
  const id = `${parent.id}:initial_post`;
  const entries = a.submission?.discussion_entries;
  // the student's own top-level post, when Canvas lists their entries (none listed while Canvas says handed in: unknown)
  const listed = isCanvasDiscussion(a) && Array.isArray(entries) && (entries.length > 0 || !(parent.sub_state && HANDED_IN.has(parent.sub_state)));
  const posted = listed ? entries!.some((e) => !e.parent_id) : null;
  const state = posted === true ? 'submitted' : parent.sub_state === 'graded' ? 'graded'
    : posted === null && parent.sub_state && HANDED_IN.has(parent.sub_state) ? parent.sub_state : 'unsubmitted';
  const kept = blankItem(ctx, id, course, parent.kind, parent.title);
  return {
    ...parent, id, title: `${a.name} · 首帖`, due_at: at, lock_at: null, points: null, description_html: null,
    module_id: kept.module_id ?? parent.module_id, canvas_done: getItem(ctx.db, parent.id)?.canvas_done ?? 0, // ticked off as a whole in the planner
    // nothing posted and Canvas calls the discussion missing: so is its first post (a missing policy may have "graded" it)
    sub_state: state, submitted_at: null, missing: posted === true ? 0 : parent.missing, late: 0, score: null, grade: null,
  };
}

/** A discussion with checkpoints has no due date of its own: it becomes one task per checkpoint, each with its own state. */
export function assignmentRows(ctx: SyncContext, course: CourseRow, a: CanvasAssignment): ItemUpsert[] {
  const parent = assignmentRow(ctx, course, a);
  if (!a.has_sub_assignments || !a.checkpoints?.length) {
    const first = initialPostRow(ctx, course, a, parent);
    return first ? [parent, first] : [parent];
  }
  const subs = a.submission?.sub_assignment_submissions ?? [];
  const parentModule = getItem(ctx.db, parent.id)?.module_id ?? null;
  return a.checkpoints.map((cp) => {
    const id = `${parent.id}:${cp.tag}`;
    const s = subs.find((x) => x.sub_assignment_tag === cp.tag);
    const kept = blankItem(ctx, id, course, parent.kind, parent.title);
    return {
      ...parent, id, title: `${a.name} · ${CHECKPOINT_LABEL[cp.tag] ?? cp.name ?? cp.tag}`,
      canvas_done: kept.canvas_done, module_id: kept.module_id ?? parentModule,
      due_at: cp.due_at ?? cp.overrides?.find((o) => o.due_at)?.due_at ?? null,
      unlock_at: cp.unlock_at ?? parent.unlock_at, lock_at: cp.lock_at ?? parent.lock_at, points: cp.points_possible ?? null,
      // never borrow the parent's state: after the initial post it says "submitted" while replies are still due
      sub_state: s ? s.workflow_state ?? (s.submitted_at ? 'submitted' : 'unsubmitted') : parent.sub_state === 'graded' ? 'graded' : 'unsubmitted',
      submitted_at: s?.submitted_at ?? null, missing: s?.missing ? 1 : 0, late: s?.late ? 1 : 0, excused: s?.excused ? 1 : 0,
      score: s?.score ?? null, grade: s?.grade ?? null,
    };
  });
}

export async function syncAssignmentGroups(ctx: SyncContext, course: CourseRow): Promise<void> {
  try {
    const groups = await ctx.client.getAll<CanvasAssignmentGroup>(`/api/v1/courses/${course.canvas_id}/assignment_groups`);
    for (const g of groups) {
      const rules = g.rules && (g.rules.drop_lowest || g.rules.drop_highest || g.rules.never_drop?.length) ? JSON.stringify(g.rules) : null;
      upsertAssignmentGroup(ctx.db, { id: `${ctx.school.id}:g:${g.id}`, course_id: course.id, name: g.name, weight: g.group_weight ?? null, position: g.position ?? 0, rules });
    }
  } catch (err) {
    if (!(err instanceof CanvasForbiddenError || err instanceof CanvasNotFoundError)) throw err;
  }
}

/** Returns the ids seen; throws if the listing failed (then nothing may be marked removed). */
export async function syncAssignments(ctx: SyncContext, course: CourseRow): Promise<Set<string>> {
  const list = await ctx.client.getAll<CanvasAssignment>(`/api/v1/courses/${course.canvas_id}/assignments`, {
    'include[]': ['submission', 'checkpoints', 'sub_assignment_submissions'], order_by: 'due_at',
  });
  (ctx.raw ??= new Map()).set(course.id, { assignments: list, quizzes: null });
  const seen = new Set<string>();
  for (const a of list) {
    if (a.published === false) continue;
    for (const row of assignmentRows(ctx, course, a)) {
      save(ctx, row);
      seen.add(row.id);
    }
  }
  return seen;
}

/** Practice quizzes / surveys that have no assignment. null = endpoint unavailable (tab hidden). */
export async function syncQuizzes(ctx: SyncContext, course: CourseRow): Promise<Set<string> | null> {
  let list: CanvasQuiz[];
  try {
    list = await ctx.client.getAll<CanvasQuiz>(`/api/v1/courses/${course.canvas_id}/quizzes`);
  } catch (err) {
    if (err instanceof CanvasForbiddenError || err instanceof CanvasNotFoundError) return null;
    throw err;
  }
  const raw = ctx.raw?.get(course.id);
  if (raw) raw.quizzes = list;
  const seen = new Set<string>();
  for (const q of list) {
    if (q.assignment_id || q.published === false) continue;
    const id = `${ctx.school.id}:q:${q.id}`;
    save(ctx, {
      ...blankItem(ctx, id, course, 'quiz', q.title), due_at: q.due_at ?? null, points: q.points_possible ?? null,
      html_url: q.html_url ?? `${course.html_url}/quizzes/${q.id}`, submission_types: '["not_graded"]',
      sub_state: getItem(ctx.db, id)?.sub_state ?? null,
    });
    seen.add(id);
  }
  return seen;
}

/** Flags a:/q: items that Canvas stopped returning; other item kinds in the course are left alone. */
export function markCourseRemovals(ctx: SyncContext, course: CourseRow, assignments: Set<string>, quizzes: Set<string> | null): number {
  const keep = new Set(assignments);
  const aPrefix = `${ctx.school.id}:a:`;
  const qPrefix = `${ctx.school.id}:q:`;
  for (const { id } of all<{ id: string }>(ctx.db, 'SELECT id FROM items WHERE course_id = $courseId', { courseId: course.id })) {
    if (id.startsWith(aPrefix)) continue;
    if (id.startsWith(qPrefix) && quizzes) continue;
    keep.add(id);
  }
  for (const id of quizzes ?? []) keep.add(id);
  return markRemovedExcept(ctx.db, course.id, ['assignment', 'quiz', 'discussion'], keep);
}

export async function syncCalendarEvents(ctx: SyncContext, courses: CourseRow[]): Promise<void> {
  const byCanvas = new Map(courses.map((c) => [c.canvas_id, c]));
  const codes = courses.map((c) => `course_${c.canvas_id}`);
  for (let i = 0; i < codes.length; i += 10) {
    const events = await ctx.client.getAll<CanvasCalendarEvent>('/api/v1/calendar_events', {
      type: 'event', 'context_codes[]': codes.slice(i, i + 10),
      start_date: new Date(ctx.now.getTime() - 30 * DAY).toISOString(), end_date: new Date(ctx.now.getTime() + 180 * DAY).toISOString(),
    });
    for (const e of events) {
      const course = byCanvas.get((e.context_code ?? '').replace('course_', ''));
      const id = `${ctx.school.id}:e:${e.id}`;
      save(ctx, {
        ...blankItem(ctx, id, course, 'event', e.title), due_at: e.start_at ?? null, end_at: e.end_at ?? null,
        html_url: absolute(ctx, e.html_url), description_html: e.description ?? null,
      });
    }
  }
}

// to-dos that only the planner knows about; gone from the planner (inside its window) = gone from Canvas
const PLANNER_ONLY = ['pr', 'w', 'n', 'd'];

export async function syncPlanner(ctx: SyncContext, courses: CourseRow[]): Promise<void> {
  const byCanvas = new Map(courses.map((c) => [c.canvas_id, c]));
  const from = ctx.now.getTime() - 30 * DAY;
  const to = ctx.now.getTime() + 120 * DAY;
  const items = await ctx.client.getAll<CanvasPlannerItem>('/api/v1/planner/items', {
    start_date: new Date(from).toISOString(), end_date: new Date(to).toISOString(),
  });
  if (ctx.evidence) ctx.evidence.planner = items;
  const seen = new Set<string>();
  for (const p of items) {
    const course = p.course_id ? byCanvas.get(String(p.course_id)) : undefined;
    if (p.course_id && !course) continue; // a course Course Hub doesn't track (concluded, restricted): not a courseless task
    const done = p.planner_override?.marked_complete ? 1 : 0;
    const subs = p.submissions || null;
    const assignmentId = p.plannable_type === 'assignment' ? p.plannable_id : p.plannable?.assignment_id ?? null;
    const title = p.plannable?.title ?? '(untitled)';
    const todo = p.plannable?.todo_date ?? p.plannable?.due_at ?? p.plannable_date ?? null;

    if (p.plannable_type === 'assessment_request') {
      // a classmate's work the student must peer-review
      const id = `${ctx.school.id}:pr:${p.plannable_id}`;
      seen.add(id);
      save(ctx, {
        ...blankItem(ctx, id, course, 'review', `${title} · 同伴互评`), due_at: todo, html_url: absolute(ctx, p.html_url), canvas_done: done,
        submission_types: '["peer_review"]', sub_state: p.plannable?.workflow_state === 'completed' ? 'submitted' : 'unsubmitted',
      });
      continue;
    }
    if (p.plannable_type === 'sub_assignment') {
      // one checkpoint of a checkpointed discussion; the parent assignment id is in the link
      const parent = (p.html_url ?? '').match(/\/assignments\/(\d+)/)?.[1];
      const tag = p.plannable?.sub_assignment_tag;
      if (!parent || !tag) continue;
      const id = `${ctx.school.id}:a:${parent}:${tag}`;
      if (getItem(ctx.db, id)) {
        setItemFlags(ctx.db, id, { canvas_done: done });
      } else if (course) {
        save(ctx, {
          ...blankItem(ctx, id, course, 'discussion', `${title} · ${CHECKPOINT_LABEL[tag] ?? tag}`), due_at: p.plannable?.due_at ?? p.plannable_date ?? null,
          points: p.plannable?.points_possible ?? null, html_url: `${course.html_url}/assignments/${parent}`, canvas_done: done,
          submission_types: '["discussion_topic"]', sub_state: subs ? (subs.graded ? 'graded' : subs.submitted ? 'submitted' : 'unsubmitted') : null,
          missing: subs?.missing ? 1 : 0, late: subs?.late ? 1 : 0, excused: subs?.excused ? 1 : 0,
        });
      }
      continue;
    }

    if (assignmentId && ['assignment', 'quiz', 'discussion_topic'].includes(p.plannable_type)) {
      const id = `${ctx.school.id}:a:${assignmentId}`;
      if (getItem(ctx.db, id)) {
        setItemFlags(ctx.db, id, { canvas_done: done });
      } else if (checkpointsOf(ctx.db, id).length) {
        // a checkpointed discussion: its checkpoint tasks already carry the dates
      } else if (course) {
        // assignment list unavailable for this course: keep what the planner knows
        save(ctx, {
          ...blankItem(ctx, id, course, p.plannable_type === 'quiz' ? 'quiz' : p.plannable_type === 'discussion_topic' ? 'discussion' : 'assignment', title),
          due_at: p.plannable?.due_at ?? p.plannable_date ?? null, points: p.plannable?.points_possible ?? null,
          html_url: absolute(ctx, p.html_url), canvas_done: done,
          sub_state: subs ? (subs.graded ? 'graded' : subs.submitted ? 'submitted' : 'unsubmitted') : null,
          missing: subs?.missing ? 1 : 0, late: subs?.late ? 1 : 0, excused: subs?.excused ? 1 : 0,
        });
      }
      continue;
    }
    const kindPrefix: Record<string, [string, ItemKind]> = {
      quiz: ['q', 'quiz'], discussion_topic: ['d', 'discussion'], wiki_page: ['w', 'page'], planner_note: ['n', 'note'],
    };
    const mapped = kindPrefix[p.plannable_type];
    if (!mapped) continue; // calendar events come from their own endpoint
    const id = `${ctx.school.id}:${mapped[0]}:${p.plannable_id}`;
    seen.add(id);
    const existing = getItem(ctx.db, id);
    if (existing && mapped[1] === 'quiz') {
      setItemFlags(ctx.db, id, { canvas_done: done, ...(subs && subs.submitted ? { sub_state: 'submitted' } : {}) });
      continue;
    }
    save(ctx, {
      ...blankItem(ctx, id, course, mapped[1], title), due_at: todo, html_url: absolute(ctx, p.html_url), canvas_done: done,
      submission_types: '["not_graded"]', description_html: p.plannable?.details ?? null,
    });
  }
  // deleted planner notes, withdrawn peer reviews, page to-dos taken down: the planner lists everything in its window
  const like = PLANNER_ONLY.map((p, i) => `id LIKE $p${i}`).join(' OR ');
  const params = Object.fromEntries(PLANNER_ONLY.map((p, i) => [`p${i}`, `${ctx.school.id}:${p}:%`]));
  for (const r of all<{ id: string; due_at: string | null }>(ctx.db, `SELECT id, due_at FROM items WHERE removed = 0 AND (${like})`, params)) {
    const t = r.due_at ? Date.parse(r.due_at) : NaN;
    if (seen.has(r.id) || !(t >= from && t < to)) continue;
    run(ctx.db, 'UPDATE items SET removed = 1, updated_at = $now WHERE id = $id', { id: r.id, now: nowIso() });
  }
}

export async function syncMissing(ctx: SyncContext): Promise<void> {
  const missing = await ctx.client.getAll<CanvasAssignment>('/api/v1/users/self/missing_submissions', { 'filter[]': ['submittable'] });
  if (ctx.evidence) ctx.evidence.missing = missing;
  for (const a of missing) setItemFlags(ctx.db, `${ctx.school.id}:a:${a.id}`, { missing: 1 });
}
