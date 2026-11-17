import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { recentAiRuns } from '../../db/runs.ts';
import { getSettings, updateSettings } from '../../db/settings.ts';
import type { Settings } from '../../db/settings.ts';
import { all } from '../../db/sql.ts';
import { HttpError, readJson } from './util.ts';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateSettings(p: Partial<Settings>): Partial<Settings> {
  const bad = (msg: string) => {
    throw new HttpError(400, msg);
  };
  const int = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
  if (p.dailyTime !== undefined && !HHMM.test(p.dailyTime)) bad('日报时间格式应为 HH:MM');
  if (p.weeklyTime !== undefined && !HHMM.test(p.weeklyTime)) bad('周报时间格式应为 HH:MM');
  if (p.weeklyDay !== undefined && !int(p.weeklyDay, 0, 6)) bad('周报日期应为 0–6（0 = 周日）');
  if (p.syncIntervalHours !== undefined && !int(p.syncIntervalHours, 1, 12)) bad('同步间隔应为 1–12 小时');
  if (p.syncWindowStart !== undefined && !int(p.syncWindowStart, 0, 23)) bad('同步开始时间应为 0–23');
  if (p.syncWindowEnd !== undefined && !int(p.syncWindowEnd, 1, 24)) bad('同步结束时间应为 1–24');
  if (p.reminderHours !== undefined && (!Array.isArray(p.reminderHours) || p.reminderHours.length > 4 || p.reminderHours.some((h) => !int(h, 1, 72)))) bad('提醒时间应为 1–72 小时');
  if (p.aiModel !== undefined && !['sonnet', 'opus', 'haiku'].includes(p.aiModel)) bad('AI 模型只能是 sonnet / opus / haiku');
  if (p.aiAutoWeeks !== undefined && !int(p.aiAutoWeeks, 0, 4)) bad('自动生成周数应为 0–4');
  for (const k of ['reminders', 'notifyChanges', 'aiEnabled'] as const) if (p[k] !== undefined && typeof p[k] !== 'boolean') bad(`${k} 应为 true/false`);
  return p;
}

export function registerSettings(app: Hono, db: DB): void {
  app.get('/api/settings', (c) => c.json(getSettings(db)));
  app.put('/api/settings', async (c) => {
    const patch = validateSettings(await readJson<Partial<Settings>>(c));
    const merged = { ...getSettings(db), ...patch };
    if (merged.syncWindowEnd <= merged.syncWindowStart) throw new HttpError(400, '同步结束时间要晚于开始时间');
    return c.json(updateSettings(db, patch));
  });
  app.get('/api/ai/usage', (c) => {
    const totals = all<{ runs: number; ok: number; cost: number | null }>(db, `SELECT COUNT(*) AS runs, SUM(ok) AS ok, SUM(cost_usd) AS cost
        FROM ai_runs WHERE started_at >= $since`, { since: new Date(Date.now() - 7 * 86_400_000).toISOString() })[0];
    return c.json({ last7Days: { runs: totals.runs, ok: totals.ok ?? 0, costUsd: totals.cost ?? 0 }, recent: recentAiRuns(db, 50) });
  });
}
