import { randomUUID } from 'node:crypto';
import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { ItemKind, ItemRow } from './types.ts';
import { all, insertRow, one, pick, placeholders, run, updateRow } from './sql.ts';
import { getCourse } from './courses.ts';

export type ItemUpsert = Omit<ItemRow, 'first_seen_at' | 'updated_at' | 'local_done' | 'removed'>;

const COLS = ['id', 'school_id', 'course_id', 'kind', 'title', 'due_at', 'end_at', 'unlock_at', 'lock_at', 'points',
  'html_url', 'provider', 'description_html', 'submission_types', 'sub_state', 'submitted_at', 'missing', 'late',
  'excused', 'score', 'grade', 'canvas_done', 'source', 'module_id'] as const;

export function getItem(db: DB, id: string): ItemRow | undefined {
  return one<ItemRow>(db, 'SELECT * FROM items WHERE id = $id', { id });
}

/** Inserts or updates; never touches local_done; resurrects removed rows. */
export function upsertItem(db: DB, row: ItemUpsert): { created: boolean; prev?: ItemRow } {
  const r = pick(row as unknown as Record<string, unknown>, COLS);
  const prev = getItem(db, row.id);
  const now = nowIso();
  if (!prev) {
    insertRow(db, 'items', { ...r, first_seen_at: now, updated_at: now, local_done: 0, removed: 0 });
    return { created: true };
  }
  const p = prev as unknown as Record<string, unknown>;
  const changed = prev.removed === 1 || COLS.some((c) => (p[c] ?? null) !== (r[c] ?? null));
  const { id: _id, ...rest } = r;
  updateRow(db, 'items', { ...rest, removed: 0, updated_at: changed ? now : prev.updated_at }, 'id = $__id', { __id: row.id });
  return { created: false, prev };
}

interface ListQuery { from?: string; to?: string; courseId?: string; schoolId?: string; includeRemoved?: boolean; includeHiddenCourses?: boolean }

function filters(q: ListQuery): { where: string[]; params: Record<string, unknown> } {
  const where = ['(c.id IS NULL OR c.active = 1)'];
  const params: Record<string, unknown> = {};
  if (q.courseId) { where.push('i.course_id = $courseId'); params.courseId = q.courseId; }
  if (q.schoolId) { where.push('i.school_id = $schoolId'); params.schoolId = q.schoolId; }
  if (!q.includeRemoved) where.push('i.removed = 0');
  if (!q.includeHiddenCourses) where.push('(c.id IS NULL OR c.hidden = 0)');
  return { where, params };
}

/** Dated items ordered by due date. */
export function listItems(db: DB, q: ListQuery = {}): ItemRow[] {
  const { where, params } = filters(q);
  where.push('i.due_at IS NOT NULL');
  if (q.from) { where.push('i.due_at >= $from'); params.from = q.from; }
  if (q.to) { where.push('i.due_at < $to'); params.to = q.to; }
  return all<ItemRow>(db, `SELECT i.* FROM items i LEFT JOIN courses c ON c.id = i.course_id
                           WHERE ${where.join(' AND ')} ORDER BY i.due_at, i.title`, params);
}

export function listUndated(db: DB, courseId?: string): ItemRow[] {
  const { where, params } = filters({ courseId });
  where.push('i.due_at IS NULL');
  return all<ItemRow>(db, `SELECT i.* FROM items i LEFT JOIN courses c ON c.id = i.course_id
                           WHERE ${where.join(' AND ')} ORDER BY i.course_id, i.title`, params);
}

export function setLocalDone(db: DB, id: string, done: boolean): void {
  run(db, 'UPDATE items SET local_done = $done WHERE id = $id', { id, done: done ? 1 : 0 });
}

export function createManual(db: DB, input: { title: string; course_id?: string | null; due_at: string | null; html_url?: string | null }): ItemRow {
  const title = input.title.trim();
  if (!title) throw new Error('请输入任务标题');
  const course = input.course_id ? getCourse(db, input.course_id) : undefined;
  if (input.course_id && !course) throw new Error('课程不存在');
  const id = `manual:${randomUUID()}`;
  const now = nowIso();
  insertRow(db, 'items', {
    id, school_id: course?.school_id ?? null, course_id: course?.id ?? null, kind: 'manual', title, due_at: input.due_at,
    html_url: input.html_url ?? null, provider: 'manual', source: 'manual', first_seen_at: now, updated_at: now,
  });
  return getItem(db, id)!;
}

export function deleteManual(db: DB, id: string): void {
  const row = getItem(db, id);
  if (!row) return;
  if (row.source !== 'manual') throw new Error('只能删除手动添加的任务');
  run(db, 'DELETE FROM items WHERE id = $id', { id });
}

/** After a complete listing of a course: items of these kinds that Canvas no longer returns are flagged removed. */
export function markRemovedExcept(db: DB, courseId: string, kinds: ItemKind[], keepIds: Set<string>): number {
  const ph = placeholders('k', kinds);
  const rows = all<{ id: string }>(db, `SELECT id FROM items WHERE course_id = $courseId AND removed = 0
      AND source IN ('api', 'ics') AND kind IN (${ph.sql})`, { ...ph.params, courseId });
  const gone = rows.filter((r) => !keepIds.has(r.id));
  for (const r of gone) run(db, 'UPDATE items SET removed = 1, updated_at = $now WHERE id = $id', { id: r.id, now: nowIso() });
  return gone.length;
}

/** Small flag updates coming from secondary endpoints (planner, missing_submissions). */
export function setItemFlags(db: DB, id: string, patch: { missing?: number; canvas_done?: number; sub_state?: string | null }): void {
  const row = getItem(db, id);
  if (!row) return;
  const changed = Object.entries(patch).filter(([k, v]) => (row as unknown as Record<string, unknown>)[k] !== v);
  if (changed.length === 0) return;
  updateRow(db, 'items', { ...Object.fromEntries(changed), updated_at: nowIso() }, 'id = $__id', { __id: id });
}

export function itemToUpsert(row: ItemRow): ItemUpsert {
  const { first_seen_at: _f, updated_at: _u, local_done: _l, removed: _r, ...rest } = row;
  return rest;
}

export function setItemModule(db: DB, id: string, moduleId: string | null): void {
  run(db, 'UPDATE items SET module_id = $moduleId WHERE id = $id AND (module_id IS NOT $moduleId)', { id, moduleId });
}
