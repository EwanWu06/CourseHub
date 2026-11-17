// What a task takes for full credit, and how far the student is. Shared by the sync (which works it out), the task
// views (status, Today, reminders) and the web page.

/** post / replies / reviews are counts; score is points against a module's minimum score */
export type PartKind = 'post' | 'replies' | 'reviews' | 'score';

/** A countable step: `done` null = can't be counted (an external tool, a lookup that failed). */
export interface LogicPart {
  kind: PartKind; need: number; done: number | null;
  /** canvas = Canvas's own setting; text = the teacher's instructions (quote = their sentence) */
  source: 'canvas' | 'text'; quote?: string; detail?: string;
}

export type NoteKind = 'words' | 'one_attempt' | 'attempts' | 'in_person' | 'file_types' | 'time_limit' | 'peer_reviews' | 'post_first' | 'replies_elsewhere' | 'locked';

/** A rule worth knowing before starting (one attempt, in the lab only, PDF only…). */
export interface LogicNote { kind: NoteKind; text: string; quote?: string }

export interface ItemLogic {
  parts: LogicPart[];
  notes: LogicNote[];
  /** a deadline that differs from Canvas's for this task (at), or why its date is what it is (at null) */
  due?: { at: string | null; note: string } | null;
}

/** Steps that can be counted and aren't met yet. */
export function unmetParts(logic: Pick<ItemLogic, 'parts'> | null | undefined): LogicPart[] {
  return (logic?.parts ?? []).filter((p) => p.done !== null && p.done < p.need);
}

/** "还差 1 条回复", "还差首帖", "还差 2 份互评" — the next thing to do, for lists and reminders. */
export function remainingText(logic: Pick<ItemLogic, 'parts'> | null | undefined): string | null {
  const left = unmetParts(logic).map((p) => {
    const n = p.need - (p.done ?? 0);
    if (p.kind === 'post') return p.need === 1 ? '首帖' : `${n} 篇主帖`;
    if (p.kind === 'replies') return `${n} 条回复`;
    if (p.kind === 'score') return `${Math.round(n * 10) / 10} 分`;
    return `${n} 份互评`;
  });
  if (!left.length) return null;
  const text = left.join('、');
  return /^\d/.test(text) ? `还差 ${text}` : `还差${text}`;
}
