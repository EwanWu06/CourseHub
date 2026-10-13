import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { AiRunRow, JobRow, SyncRunRow } from './types.ts';
import { all, insertRow, one, run, updateRow } from './sql.ts';

export function startSyncRun(db: DB, schoolId: string): number {
  const res = insertRow(db, 'sync_runs', { school_id: schoolId, started_at: nowIso(), status: 'running' });
  return Number(res.lastInsertRowid);
}

export function finishSyncRun(db: DB, id: number, status: string, stats: unknown, error?: string | null): void {
  updateRow(db, 'sync_runs', { finished_at: nowIso(), status, stats: JSON.stringify(stats), error: error ?? null }, 'id = $__id', { __id: id });
}

export function recentSyncRuns(db: DB, limit: number, schoolId?: string): SyncRunRow[] {
  return all<SyncRunRow>(db, `SELECT * FROM sync_runs ${schoolId ? 'WHERE school_id = $schoolId' : ''}
      ORDER BY id DESC LIMIT $limit`, schoolId ? { limit, schoolId } : { limit });
}

export function recordAiRun(db: DB, r: Omit<AiRunRow, 'id'>): void {
  insertRow(db, 'ai_runs', { ...r });
}

export function recentAiRuns(db: DB, limit: number): AiRunRow[] {
  return all<AiRunRow>(db, 'SELECT * FROM ai_runs ORDER BY id DESC LIMIT $limit', { limit });
}

export function getJob(db: DB, name: string): JobRow | undefined {
  return one<JobRow>(db, 'SELECT * FROM jobs WHERE name = $name', { name });
}

export function setJob(db: DB, name: string, patch: Partial<Omit<JobRow, 'name'>>): void {
  if (!getJob(db, name)) insertRow(db, 'jobs', { name });
  updateRow(db, 'jobs', { ...patch }, 'name = $__name', { __name: name });
}

export function pruneRuns(db: DB, beforeIso: string): void {
  run(db, 'DELETE FROM sync_runs WHERE started_at < $before', { before: beforeIso });
  run(db, 'DELETE FROM ai_runs WHERE started_at < $before', { before: beforeIso });
}
