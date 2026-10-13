// Orchestrates one school's sync: API first (session or token), ICS fallback when the login lapsed.
import { SessionExpiredError } from '../canvas/client.ts';
import type { CanvasClient } from '../canvas/client.ts';
import { fetchIcs } from '../canvas/ics.ts';
import type { CanvasProfile } from '../canvas/types.ts';
import type { DB } from '../db/index.ts';
import { getSchool, listSchools, updateSchool } from '../db/schools.ts';
import { finishSyncRun, startSyncRun } from '../db/runs.ts';
import { one } from '../db/sql.ts';
import type { SchoolRow } from '../db/types.ts';
import { makeClient, persistClientCookies } from '../auth/store.ts';
import { log } from '../util/log.ts';
import { errorText, newStats } from './context.ts';
import type { SyncContext, SyncStats } from './context.ts';
import { syncCourses } from './courses.ts';
import { markCourseRemovals, syncAssignments, syncCalendarEvents, syncMissing, syncPlanner, syncQuizzes } from './items.ts';
import { mergeIcs } from './icsMerge.ts';
import { syncCourseContent, syncInbox } from './content.ts';
import { rebuildWeeks } from '../weeks/build.ts';
import { extractPendingFiles } from '../content/pipeline.ts';

export interface SyncOptions {
  schoolId?: string;
  reason: string;
  now?: Date;
  relogin?: ((schoolId: string) => Promise<boolean>) | null;
  onLoginNeeded?: (school: SchoolRow) => void;
}

export class SyncBusyError extends Error {
  constructor(schoolId: string) {
    super(`正在同步 ${schoolId}，请稍后`);
    this.name = 'SyncBusyError';
  }
}

let running: string | null = null;

export function syncRunning(): string | null {
  return running;
}

async function guarded(ctx: SyncContext, label: string, fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    ctx.stats.errors.push(`${label}: ${errorText(err)}`);
    log('warn', `sync ${ctx.school.id} ${label} failed`, err);
    return false;
  }
}

async function apiSync(db: DB, school: SchoolRow, client: CanvasClient, now: Date, stats: SyncStats): Promise<void> {
  const ctx: SyncContext = {
    db, school, client, now, firstSync: !school.last_ok_at, stats, complete: new Set(),
    quizToAssignment: new Map(), topicToAssignment: new Map(),
  };
  const profile = await client.get<CanvasProfile>('/api/v1/users/self/profile');
  updateSchool(db, school.id, { user_name: profile.name ?? school.user_name, ics_url: profile.calendar?.ics ?? school.ics_url });

  const courses = await syncCourses(ctx);
  for (const course of courses.filter((c) => !c.hidden)) {
    await guarded(ctx, course.name, async () => {
      const assignments = await syncAssignments(ctx, course);
      const quizzes = await syncQuizzes(ctx, course);
      markCourseRemovals(ctx, course, assignments, quizzes);
      ctx.complete.add(course.id);
    });
    await guarded(ctx, `${course.name} 内容`, () => syncCourseContent(ctx, course));
    await guarded(ctx, `${course.name} 周次`, async () => rebuildWeeks(db, course.id));
  }
  await guarded(ctx, '日历事件', () => syncCalendarEvents(ctx, courses));
  await guarded(ctx, '待办计划', () => syncPlanner(ctx, courses));
  await guarded(ctx, '缺交列表', () => syncMissing(ctx));
  await guarded(ctx, '收件箱', () => syncInbox(ctx));
  await guarded(ctx, '提取文字', () => extractPendingFiles(ctx, { limit: 15 }));

  const icsUrl = getSchool(db, school.id)?.ics_url;
  if (icsUrl) await guarded(ctx, '日历订阅', async () => mergeIcs({ ...ctx, apiOk: true }, await fetchIcs(icsUrl)));

  stats.mode = 'api';
  updateSchool(db, school.id, { status: 'ok', status_detail: null, last_sync_at: now.toISOString(), last_ok_at: now.toISOString() });
}

async function icsOnly(db: DB, school: SchoolRow, now: Date, stats: SyncStats): Promise<void> {
  stats.mode = 'ics';
  if (!school.ics_url) {
    stats.errors.push('没有日历订阅链接，无法获取截止日期');
  } else {
    try {
      await mergeIcs({ db, school, now, firstSync: !school.last_ok_at && !school.last_sync_at, stats, apiOk: false }, await fetchIcs(school.ics_url));
    } catch (err) {
      stats.errors.push(`日历订阅: ${errorText(err)}`);
    }
  }
  updateSchool(db, school.id, { last_sync_at: now.toISOString() });
}

export async function syncSchool(db: DB, schoolId: string, opts: SyncOptions): Promise<SyncStats> {
  if (running) throw new SyncBusyError(running);
  const school = getSchool(db, schoolId);
  if (!school) throw new Error(`学校不存在: ${schoolId}`);
  running = schoolId;
  const now = opts.now ?? new Date();
  const stats = newStats();
  const runId = startSyncRun(db, schoolId);
  let client = makeClient(school);
  try {
    if (!client) {
      await icsOnly(db, school, now, stats);
    } else {
      try {
        await apiSync(db, school, client, now, stats);
      } catch (err) {
        if (!(err instanceof SessionExpiredError)) throw err;
        persistClientCookies(schoolId, client);
        const relogin = opts.relogin ?? null;
        if (relogin && (await relogin(schoolId))) {
          client = makeClient(getSchool(db, schoolId)!);
          if (!client) throw new Error('重新登录后没有保存登录状态');
          await apiSync(db, getSchool(db, schoolId)!, client, now, stats);
        } else {
          updateSchool(db, schoolId, { status: 'needs_login', status_detail: '登录已过期，请重新登录' });
          opts.onLoginNeeded?.(getSchool(db, schoolId)!);
          await icsOnly(db, getSchool(db, schoolId)!, now, stats);
        }
      }
    }
    if (client) {
      persistClientCookies(schoolId, client);
      stats.requests = client.requestCount;
    }
    stats.items = (one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM items WHERE school_id = $id AND removed = 0', { id: schoolId })?.n) ?? 0;
    finishSyncRun(db, runId, stats.errors.length ? 'partial' : 'ok', stats);
  } catch (err) {
    stats.errors.push(errorText(err));
    finishSyncRun(db, runId, 'error', stats, errorText(err));
    updateSchool(db, schoolId, { status: 'error', status_detail: errorText(err), last_sync_at: now.toISOString() });
    log('error', `sync ${schoolId} failed`, err);
  } finally {
    running = null;
  }
  return stats;
}

export async function syncAll(db: DB, opts: SyncOptions): Promise<Record<string, SyncStats>> {
  const out: Record<string, SyncStats> = {};
  for (const school of listSchools(db)) {
    if (opts.schoolId && school.id !== opts.schoolId) continue;
    out[school.id] = await syncSchool(db, school.id, opts);
  }
  return out;
}
