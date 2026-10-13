import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { getReport, listReports } from '../../db/reports.ts';
import type { ReportRow } from '../../db/types.ts';
import { generateDaily } from '../../reports/daily.ts';
import { generateWeekly } from '../../reports/weekly.ts';
import { headlineOf, refreshReport } from '../../reports/view.ts';
import type { AnyReport } from '../../reports/view.ts';
import { log } from '../../util/log.ts';
import { HttpError } from './util.ts';

type ReportType = ReportRow['type'];
const isType = (t: string | undefined): t is ReportType => t === 'daily' || t === 'weekly';

function parse(row: ReportRow): AnyReport | null {
  try {
    return JSON.parse(row.content) as AnyReport;
  } catch {
    return null;
  }
}

export function registerReports(app: Hono, db: DB, deps: { generate?: (type: ReportType) => Promise<ReportRow> } = {}): void {
  const generate = deps.generate ?? ((type: ReportType) => (type === 'daily' ? generateDaily(db) : generateWeekly(db)));
  const running = new Set<ReportType>();

  app.get('/api/reports', (c) => {
    const type = c.req.query('type');
    if (type !== undefined && !isType(type)) throw new HttpError(400, '报告类型不对');
    return c.json(listReports(db, type).map((row) => {
      const r = parse(row);
      return { id: row.id, type: row.type, period: row.period, createdAt: row.created_at, headline: r ? headlineOf(r) : '', aiError: r?.aiError ?? null };
    }));
  });

  app.get('/api/reports/status', (c) => c.json({ running: [...running] }));

  app.get('/api/reports/:id', (c) => {
    const row = getReport(db, c.req.param('id'));
    if (!row) throw new HttpError(404, '报告不存在');
    const r = parse(row);
    if (!r) throw new HttpError(500, '这份报告的内容损坏了');
    return c.json({ id: row.id, type: row.type, period: row.period, createdAt: row.created_at, headline: headlineOf(r), report: refreshReport(db, r, new Date()) });
  });

  app.post('/api/reports/:type/generate', (c) => {
    const type = c.req.param('type');
    if (!isType(type)) throw new HttpError(400, '报告类型不对');
    if (running.has(type)) return c.json({ error: '正在生成，请稍等' }, 409);
    running.add(type);
    void generate(type)
      .catch((err) => log('error', `report ${type} failed`, err))
      .finally(() => running.delete(type));
    return c.json({ started: true }, 202);
  });
}
