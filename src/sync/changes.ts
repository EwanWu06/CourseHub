// Turns differences between the stored and freshly synced item into `changes` rows (dynamic feed + alerts).
import { addChange } from '../db/changes.ts';
import type { ItemUpsert } from '../db/items.ts';
import type { ItemRow } from '../db/types.ts';
import type { SyncContext } from './context.ts';

type ChangeCtx = Pick<SyncContext, 'db' | 'school' | 'now' | 'firstSync' | 'stats'>;

const TRACKED = new Set(['assignment', 'quiz', 'discussion', 'review']);
const instant = (iso: string | null | undefined) => (iso ? Date.parse(iso) : null);

export function noteItemChange(ctx: ChangeCtx, prev: ItemRow | undefined, next: ItemUpsert): void {
  if (!TRACKED.has(next.kind)) return;
  const notified = ctx.firstSync ? 1 : 0;
  const base = { school_id: ctx.school.id, course_id: next.course_id, ref_id: next.id, notified };
  const record = (kind: Parameters<typeof addChange>[1]['kind'], summary: string, data: unknown) => {
    addChange(ctx.db, { ...base, kind, summary, data: JSON.stringify(data) });
    ctx.stats.changes++;
  };
  if (!prev) {
    if (next.due_at && Date.parse(next.due_at) >= ctx.now.getTime()) record('new_item', `新作业：${next.title}`, { due_at: next.due_at });
    return;
  }
  if (instant(prev.due_at) !== instant(next.due_at)) record('due_changed', `截止时间变化：${next.title}`, { from: prev.due_at, to: next.due_at });
  if (prev.score === null && next.score !== null) record('graded', `成绩已公布：${next.title}`, { score: next.score, points: next.points });
  if (!prev.missing && next.missing) record('missing', `被标记缺交：${next.title}`, {});
}
