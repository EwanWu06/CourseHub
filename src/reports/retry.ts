// When a report's AI part failed (usage limit, network…), try again later — quietly, keeping the report's
// time — for today's daily and the current weekly. Four attempts in all.
import type { DB } from '../db/index.ts';
import { getReport, updateReportContent } from '../db/reports.ts';
import { localDateStr } from '../util/time.ts';
import { weeklyPeriod } from './data.ts';
import { nextAiRetry, planDaily } from './daily.ts';
import type { AiPlan, DailyReport } from './daily.ts';
import { planWeekly } from './weekly.ts';
import type { WeeklyReport } from './weekly.ts';

const MAX_ATTEMPTS = 4;

export async function fillMissingAi(db: DB, now: Date): Promise<number> {
  let filled = 0;
  for (const id of [`daily:${localDateStr(now)}`, `weekly:${weeklyPeriod(now)}`]) {
    const row = getReport(db, id);
    if (!row) continue;
    let r: DailyReport | WeeklyReport;
    try {
      r = JSON.parse(row.content) as DailyReport | WeeklyReport;
    } catch {
      continue;
    }
    if (r.ai || !r.aiRetry || r.aiRetry.attempts >= MAX_ATTEMPTS || Date.parse(r.aiRetry.nextAt) > now.getTime()) continue;
    const plan: AiPlan<unknown> = r.kind === 'daily' ? await planDaily(db, r.data, now) : await planWeekly(db, r.data, now);
    const { aiRetry, ...rest } = r;
    let next: object;
    if (plan.ai) {
      next = { ...rest, ai: plan.ai, aiError: null };
      filled++;
    } else if (!plan.retry) {
      next = { ...rest, aiError: plan.aiError }; // e.g. AI switched off since: stop trying
    } else {
      next = { ...rest, aiError: plan.aiError, aiRetry: nextAiRetry(aiRetry.attempts + 1, now, plan.rateLimited) };
    }
    updateReportContent(db, id, JSON.stringify(next));
  }
  return filled;
}
