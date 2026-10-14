import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import { all, one, run } from './sql.ts';
import type { ItemLogic } from '../logic/types.ts';

function parse(data: string): ItemLogic | null {
  try {
    const v = JSON.parse(data) as ItemLogic;
    return v && Array.isArray(v.parts) && Array.isArray(v.notes) ? v : null;
  } catch {
    return null;
  }
}

export function getItemLogic(db: DB, itemId: string): ItemLogic | null {
  const r = one<{ data: string }>(db, 'SELECT data FROM item_logic WHERE item_id = $itemId', { itemId });
  return r ? parse(r.data) : null;
}

export function allItemLogic(db: DB): Map<string, ItemLogic> {
  const out = new Map<string, ItemLogic>();
  for (const r of all<{ item_id: string; data: string }>(db, 'SELECT item_id, data FROM item_logic')) {
    const v = parse(r.data);
    if (v) out.set(r.item_id, v);
  }
  return out;
}

/** The course's logic is worked out as a whole: rows for tasks no longer in `rows` go. */
export function replaceCourseLogic(db: DB, schoolId: string, courseId: string, rows: Map<string, ItemLogic>): void {
  const now = nowIso();
  for (const r of all<{ item_id: string }>(db, 'SELECT item_id FROM item_logic WHERE course_id = $courseId', { courseId })) {
    if (!rows.has(r.item_id)) run(db, 'DELETE FROM item_logic WHERE item_id = $id', { id: r.item_id });
  }
  for (const [itemId, logic] of rows) {
    if (!logic.parts.length && !logic.notes.length && !logic.due) {
      run(db, 'DELETE FROM item_logic WHERE item_id = $itemId', { itemId });
      continue;
    }
    const data = JSON.stringify(logic);
    run(db, `INSERT INTO item_logic (item_id, school_id, course_id, data, updated_at) VALUES ($itemId, $schoolId, $courseId, $data, $now)
             ON CONFLICT(item_id) DO UPDATE SET school_id = excluded.school_id, course_id = excluded.course_id, data = excluded.data,
             updated_at = CASE WHEN item_logic.data = excluded.data THEN item_logic.updated_at ELSE excluded.updated_at END`,
    { itemId, schoolId, courseId, data, now });
  }
}

/** Who wrote each post (by entry id) — authors never change, so a post is looked up once. */
export function entryAuthors(db: DB, schoolId: string, entryIds: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const id of entryIds) {
    const r = one<{ user_id: string }>(db, 'SELECT user_id FROM entry_authors WHERE school_id = $schoolId AND entry_id = $id', { schoolId, id });
    if (r) out.set(id, r.user_id);
  }
  return out;
}

export function saveEntryAuthors(db: DB, schoolId: string, list: { entryId: string; userId: string }[]): void {
  for (const e of list) {
    run(db, 'INSERT OR REPLACE INTO entry_authors (school_id, entry_id, user_id) VALUES ($schoolId, $entryId, $userId)', { schoolId, entryId: e.entryId, userId: e.userId });
  }
}
