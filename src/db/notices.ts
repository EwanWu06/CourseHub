import type { Notice, NoticeKind } from '../notify/mac.ts';
import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import { all, one, run } from './sql.ts';

export interface NoticeRow { id: number; kind: NoticeKind; title: string; subtitle: string | null; body: string; url: string | null; created_at: string; read_at: string | null }

export function recordNotice(db: DB, n: Notice): void {
  run(db, `INSERT INTO notices (kind, title, subtitle, body, url, created_at) VALUES ($kind, $title, $subtitle, $body, $url, $at)`, {
    kind: n.kind ?? 'system', title: n.title, subtitle: n.subtitle ?? null, body: n.body, url: n.url ?? null, at: nowIso(),
  });
}

export function listNotices(db: DB, limit = 50): NoticeRow[] {
  return all<NoticeRow>(db, 'SELECT * FROM notices ORDER BY created_at DESC, id DESC LIMIT $limit', { limit });
}

export function unreadNotices(db: DB): number {
  return one<{ n: number }>(db, 'SELECT count(*) AS n FROM notices WHERE read_at IS NULL')?.n ?? 0;
}

export function markNoticesRead(db: DB): void {
  run(db, 'UPDATE notices SET read_at = $at WHERE read_at IS NULL', { at: nowIso() });
}

export function pruneNotices(db: DB, beforeIso: string): void {
  run(db, 'DELETE FROM notices WHERE created_at < $before', { before: beforeIso });
}
