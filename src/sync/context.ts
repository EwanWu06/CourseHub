import type { CanvasClient } from '../canvas/client.ts';
import type { DB } from '../db/index.ts';
import type { SchoolRow } from '../db/types.ts';

export interface SyncStats { mode: 'api' | 'ics' | 'skipped'; courses: number; items: number; changes: number; requests: number; errors: string[] }

export interface SyncContext {
  db: DB;
  school: SchoolRow;
  client: CanvasClient;
  now: Date;
  firstSync: boolean;
  stats: SyncStats;
  complete: Set<string>; // course ids whose assignment listing fully succeeded
}

export function newStats(): SyncStats {
  return { mode: 'skipped', courses: 0, items: 0, changes: 0, requests: 0, errors: [] };
}

export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
