// Orchestrates one school's sync: API first (session or token), ICS fallback when the login lapsed.
import { SessionExpiredError } from '../canvas/client.ts';
import type { CanvasClient, ClientOptions } from '../canvas/client.ts';
import { fetchIcs } from '../canvas/ics.ts';
import type { CanvasProfile } from '../canvas/types.ts';
import type { DB } from '../db/index.ts';
import { getSchool, listSchools, updateSchool } from '../db/schools.ts';
import { finishSyncRun, startSyncRun } from '../db/runs.ts';
import { one } from '../db/sql.ts';
import type { SchoolRow } from '../db/types.ts';
import { makeClient, persistClientCookies } from '../auth/store.ts';
import { silentReloginResult } from '../auth/login.ts';
import { log } from '../util/log.ts';
import { errorText, newStats } from './context.ts';
import type { SyncContext, SyncStats } from './context.ts';
import { syncCourses } from './courses.ts';
import { markCourseRemovals, syncAssignmentGroups, syncAssignments, syncCalendarEvents, syncMissing, syncPlanner, syncQuizzes } from './items.ts';
import { categorizeSchool } from './category.ts';
import { mergeIcs } from './icsMerge.ts';
import { crossCheck } from './crosscheck.ts';
import type { CanvasTodo } from './crosscheck.ts';
import { syncCourseContent, syncInbox } from './content.ts';
import { rebuildWeeks } from '../weeks/build.ts';
import { extractPendingFiles } from '../content/pipeline.ts';
import { findAchieveLaunch, readAchieveInChrome, syncAchieve } from '../platforms/achieve.ts';
import { syncCourseLogic } from './logic.ts';
import type { AchieveReader } from '../platforms/achieve.ts';

export interface SyncOptions {
  schoolId?: string;
  reason: string;
  now?: Date;
  relogin?: ((schoolId: string) => Promise<boolean | 'error'>) | null;
  onLoginNeeded?: (school: SchoolRow) => void;
  /** reads a course's Achieve work (default: headless Chrome); null skips publisher platforms */
  readAchieve?: AchieveReader | null;
  /** Canvas client settings (tests: no waits between retries) */
  client?: Partial<ClientOptions>;
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
    if (ctx.client.offline) throw err; // Canvas can't be reached: every later step would fail the same way
    ctx.stats.errors.push(`${label}: ${errorText(err)}`);
    log('warn', `sync ${ctx.school.id} ${label} failed`, err);
    return false;
  }
}

async function apiSync(db: DB, school: SchoolRow, client: CanvasClient, now: Date, stats: SyncStats, opts: SyncOptions): Promise<void> {
  const ctx: SyncContext = {
    db, school, client, now, firstSync: !school.last_ok_at, stats, complete: new Set(),
    quizToAssignment: new Map(), topicToAssignment: new Map(), evidence: {},
  };
  const profile = await client.get<CanvasProfile>('/api/v1/users/self/profile');
  updateSchool(db, school.id, { user_name: profile.name ?? school.user_name, ics_url: profile.calendar?.ics ?? school.ics_url });

  const courses = await syncCourses(ctx);
  for (const course of courses.filter((c) => !c.hidden)) {
    await guarded(ctx, course.name, async () => {
      await syncAssignmentGroups(ctx, course);
      const assignments = await syncAssignments(ctx, course);
      const quizzes = await syncQuizzes(ctx, course);
      markCourseRemovals(ctx, course, assignments, quizzes);
      ctx.complete.add(course.id);
    });
    await guarded(ctx, `${course.name} 内容`, () => syncCourseContent(ctx, course));
    await guarded(ctx, `${course.name} 周次`, async () => rebuildWeeks(db, course.id));
  }
  // publisher platforms whose work Canvas doesn't hold (Achieve): read after the course itself is current
  const readAchieve = opts.readAchieve === undefined ? readAchieveInChrome : opts.readAchieve;
  for (const course of courses.filter((c) => !c.hidden && readAchieve && findAchieveLaunch(db, c.id))) {
    await guarded(ctx, `${course.name} Achieve`, () => syncAchieve(ctx, course, readAchieve!));
  }
  await guarded(ctx, '日历事件', () => syncCalendarEvents(ctx, courses));
  await guarded(ctx, '待办计划', () => syncPlanner(ctx, courses));
  // what each task takes (replies, peer reviews…) — after the planner, which lists the peer reviews
  for (const course of courses.filter((c) => ctx.complete.has(c.id))) {
    await guarded(ctx, `${course.name} 作业要求`, () => syncCourseLogic(ctx, course));
  }
  await guarded(ctx, '缺交列表', () => syncMissing(ctx));
  await guarded(ctx, '收件箱', () => syncInbox(ctx));
  await guarded(ctx, '提取文字', () => extractPendingFiles(ctx));

  const icsUrl = getSchool(db, school.id)?.ics_url;
  if (icsUrl) {
    await guarded(ctx, '日历订阅', async () => {
      const events = await fetchIcs(icsUrl);
      ctx.evidence!.ics = events;
      await mergeIcs({ ...ctx, apiOk: true }, events);
    });
  }
  await guarded(ctx, 'To Do 列表', async () => {
    ctx.evidence!.todo = await client.get<CanvasTodo[]>('/api/v1/users/self/todo');
  });

  categorizeSchool(db, school.id);
  stats.checks = crossCheck(db, getSchool(db, school.id)!, now, ctx.evidence!);
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
  categorizeSchool(db, school.id);
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
  let client = makeClient(school, opts.client);
  try {
    if (!client) {
      await icsOnly(db, school, now, stats);
    } else {
      try {
        await apiSync(db, school, client, now, stats, opts);
      } catch (err) {
        if (!(err instanceof SessionExpiredError)) throw err;
        persistClientCookies(schoolId, client);
        const isToken = school.auth_mode === 'token';
        const relogin = isToken ? null : opts.relogin === undefined ? (id: string) => silentReloginResult(db, id) : opts.relogin;
        const outcome = relogin ? await relogin(schoolId) : false;
        if (outcome === true) {
          client = makeClient(getSchool(db, schoolId)!, opts.client);
          if (!client) throw new Error('重新登录后没有保存登录状态');
          await apiSync(db, getSchool(db, schoolId)!, client, now, stats, opts);
        } else if (outcome === 'error') {
          // the renewal couldn't run (Chrome didn't start…): not a lost login; keep-alive retries soon
          updateSchool(db, schoolId, { status: 'error', status_detail: '登录过期了，自动续期这次没能运行（Chrome 没启动），稍后会自动再试' });
          await icsOnly(db, getSchool(db, schoolId)!, now, stats);
        } else {
          updateSchool(db, schoolId, {
            status: 'needs_login',
            status_detail: isToken ? '访问令牌无效或已过期，请在设置里更新' : '登录已过期，请重新登录',
          });
          if (school.status !== 'needs_login') opts.onLoginNeeded?.(getSchool(db, schoolId)!); // once, not every sync
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
    if (client?.offline) {
      // offline or asleep (the lid closed in class): the school is fine, so it isn't flagged; the scheduler tries again
      // soon, and the status page counts hours without a good sync if it lasts
      stats.offline = true;
      finishSyncRun(db, runId, 'error', stats, `网络不通，没能连上 Canvas：${errorText(err)}`);
      updateSchool(db, schoolId, { last_sync_at: now.toISOString() });
      log('warn', `sync ${schoolId}: Canvas not reachable (offline or asleep)`, err);
    } else {
      finishSyncRun(db, runId, 'error', stats, errorText(err));
      updateSchool(db, schoolId, { status: 'error', status_detail: errorText(err), last_sync_at: now.toISOString() });
      log('error', `sync ${schoolId} failed`, err);
    }
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
