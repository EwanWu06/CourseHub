import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { ReportRow } from './types.ts';
import { all, one, run } from './sql.ts';

export function saveReport(db: DB, r: { type: ReportRow['type']; period: string; content: string }): ReportRow {
  const id = `${r.type}:${r.period}`;
  run(db, `INSERT INTO reports (id, type, period, content, created_at) VALUES ($id, $type, $period, $content, $created_at)
           ON CONFLICT(id) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
  { id, type: r.type, period: r.period, content: r.content, created_at: nowIso() });
  return getReport(db, id)!;
}

export function getReport(db: DB, id: string): ReportRow | undefined {
  return one<ReportRow>(db, 'SELECT * FROM reports WHERE id = $id', { id });
}

export function listReports(db: DB, type?: ReportRow['type'], limit = 60): ReportRow[] {
  return all<ReportRow>(db, `SELECT * FROM reports ${type ? 'WHERE type = $type' : ''}
      ORDER BY period DESC, created_at DESC LIMIT $limit`, type ? { type, limit } : { limit });
}

export function latestReport(db: DB, type: ReportRow['type']): ReportRow | undefined {
  return one<ReportRow>(db, 'SELECT * FROM reports WHERE type = $type ORDER BY period DESC, created_at DESC LIMIT 1', { type });
}
