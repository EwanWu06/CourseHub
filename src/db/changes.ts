import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { ChangeRow } from './types.ts';
import { all, insertRow, placeholders, run } from './sql.ts';

export function addChange(db: DB, c: Omit<ChangeRow, 'id' | 'created_at' | 'notified'> & { notified?: number }): void {
  insertRow(db, 'changes', { ...c, notified: c.notified ?? 0, created_at: nowIso() });
}

export function pendingChanges(db: DB): ChangeRow[] {
  return all<ChangeRow>(db, 'SELECT * FROM changes WHERE notified = 0 ORDER BY id');
}

export function markNotified(db: DB, ids: number[]): void {
  if (ids.length === 0) return;
  const ph = placeholders('i', ids);
  run(db, `UPDATE changes SET notified = 1 WHERE id IN (${ph.sql})`, ph.params);
}

export function changesSince(db: DB, iso: string): ChangeRow[] {
  return all<ChangeRow>(db, 'SELECT * FROM changes WHERE created_at >= $iso ORDER BY id', { iso });
}
