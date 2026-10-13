import type { CanvasClient } from '../canvas/client.ts';
import type { CrossCheckResult, Evidence } from './crosscheck.ts';
import type { DB } from '../db/index.ts';
import type { SchoolRow } from '../db/types.ts';

export interface SyncStats {
  mode: 'api' | 'ics' | 'skipped'; courses: number; items: number; changes: number; requests: number; errors: string[];
  /** the after-sync comparison with Canvas's own lists (API syncs only) */
  checks?: CrossCheckResult;
}

export interface SyncContext {
  db: DB;
  school: SchoolRow;
  client: CanvasClient;
  now: Date;
  firstSync: boolean;
  stats: SyncStats;
  complete: Set<string>; // course ids whose assignment listing fully succeeded
  quizToAssignment: Map<string, string>; // canvas quiz id → canvas assignment id
  topicToAssignment: Map<string, string>; // canvas discussion topic id → canvas assignment id
  evidence?: Evidence; // Canvas's own lists, kept for the after-sync cross-check
}

export function newStats(): SyncStats {
  return { mode: 'skipped', courses: 0, items: 0, changes: 0, requests: 0, errors: [] };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
