// Minute-tick scheduler with catch-up: a job is due when its last run is older than its most recent slot
// (or interval), so anything missed while the Mac slept runs once after wake.
import type { DB } from './db/index.ts';
import { getJob, pruneRuns, recentSyncRuns, setJob } from './db/runs.ts';
import { getSettings } from './db/settings.ts';
import type { Settings } from './db/settings.ts';
import { listSchools } from './db/schools.ts';
import type { SchoolRow } from './db/types.ts';
import { keepAliveAll } from './auth/keepalive.ts';
import { refreshSso } from './auth/login.ts';
import { loadAuth } from './auth/store.ts';
import { cleanTmp } from './content/download.ts';
import { enqueueSyllabus } from './ai/syllabus.ts';
import { autoEnqueueGuides } from './ai/guide.ts';
import { listCourses } from './db/courses.ts';
import { getSettings as readSettings } from './db/settings.ts';
import type { SyncOptions } from './sync/index.ts';
import type { SyncStats } from './sync/context.ts';
import { flushChangeNotices } from './notify/changes.ts';
import { runReminders } from './notify/reminders.ts';
import { backupDb } from './db/backup.ts';
import { maintainDb, pruneOldData, trimBrowserCache } from './maintenance.ts';
import { withChromeLock } from './auth/chrome.ts';
import { pruneNotices } from './db/notices.ts';
import { getReport } from './db/reports.ts';
import { weeklyPeriod } from './reports/data.ts';
import { generateDaily } from './reports/daily.ts';
import { fillMissingAi } from './reports/retry.ts';
import { generateWeekly } from './reports/weekly.ts';
import { log } from './util/log.ts';
import { waitForNetwork } from './util/network.ts';
import { localDateStr } from './util/time.ts';

export interface Slot { hour: number; minute: number; weekday?: number /* 0 = Sunday */ }

export function parseHHMM(s: string): { hour: number; minute: number } {
  const [h, m] = s.split(':').map(Number);
  return { hour: h, minute: m };
}

export function lastSlotAtOrBefore(now: Date, slot: Slot): Date {
  const d = new Date(now);
  d.setHours(slot.hour, slot.minute, 0, 0);
  if (slot.weekday === undefined) {
    if (d > now) d.setDate(d.getDate() - 1);
    return d;
  }
  d.setDate(d.getDate() - ((d.getDay() - slot.weekday + 7) % 7));
  if (d > now) d.setDate(d.getDate() - 7);
  return d;
}

export function isSlotDue(now: Date, lastRun: Date | null, slot: Slot): boolean {
  return !lastRun || lastRun < lastSlotAtOrBefore(now, slot);
}

export function isIntervalDue(now: Date, lastRun: Date | null, hours: number, window: { start: number; end: number }): boolean {
  const h = now.getHours() + now.getMinutes() / 60;
  const inside = window.start <= window.end ? h >= window.start && h < window.end : h >= window.start || h < window.end;
  if (!inside) return false;
  return !lastRun || now.getTime() - lastRun.getTime() >= hours * 3_600_000 - 30_000;
}

export interface Job {
  name: string;
  isDue(now: Date, lastRun: Date | null, s: Settings): boolean;
  run(now: Date): Promise<void>;
  /** a hung job is abandoned after this long so the rest of the schedule keeps running (default 30 min) */
  timeoutMs?: number;
}

const DEFAULT_JOB_TIMEOUT = 30 * 60_000;

export function createScheduler(db: DB, jobs: Job[], opts: { tickMs?: number; clock?: () => Date; settings?: () => Settings } = {}) {
  const clock = opts.clock ?? (() => new Date());
  const settings = opts.settings ?? (() => getSettings(db));
  let busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runJob(job: Job, now: Date): Promise<void> {
    setJob(db, job.name, { last_run_at: now.toISOString(), last_status: 'running' });
    const limit = job.timeoutMs ?? DEFAULT_JOB_TIMEOUT;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const running = job.run(now);
      running.catch(() => undefined); // if abandoned, a late failure must not become an unhandled rejection
      await Promise.race([
        running,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`超时（超过 ${Math.round(limit / 60_000) || 1} 分钟没完成）`)), limit); }),
      ]);
      setJob(db, job.name, { last_status: 'ok', last_error: null });
    } catch (err) {
      setJob(db, job.name, { last_status: 'error', last_error: String((err as Error)?.message ?? err).slice(0, 500) });
      log('error', `job ${job.name} failed`, err);
    } finally {
      clearTimeout(timer);
    }
  }

  async function tick(): Promise<void> {
    if (busy) return;
    busy = true;
    try {
      const now = clock();
      const s = settings();
      for (const job of jobs) {
        const last = getJob(db, job.name)?.last_run_at;
        if (job.isDue(now, last ? new Date(last) : null, s)) await runJob(job, now);
      }
    } finally {
      busy = false;
    }
  }

  return {
    tick,
    start() {
      timer = setInterval(() => void tick(), opts.tickMs ?? 60_000);
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
    },
    async trigger(name: string) {
      const job = jobs.find((j) => j.name === name);
      if (job) await runJob(job, clock());
    },
  };
}

const DAY = 86_400_000;

export interface JobDeps {
  runSync: (opts: SyncOptions) => Promise<unknown>;
  onLoginNeeded: (s: SchoolRow) => void;
  // the rest default to the real thing; tests swap them out
  generateDaily?: (now: Date) => Promise<unknown>;
  generateWeekly?: (now: Date) => Promise<unknown>;
  runReminders?: (now: Date) => Promise<unknown>;
  flushChanges?: (now: Date) => Promise<unknown>;
  fillMissingAi?: (now: Date) => Promise<unknown>;
  /** waits (up to 90 s) for a school's host to resolve; false = the network is still down */
  networkUp?: () => Promise<boolean>;
}

/** After a sync that couldn't reach Canvas (offline, the Mac asleep) the next try comes this soon, not hours later. */
const OFFLINE_RETRY_HOURS = 0.25;

export function defaultJobs(db: DB, deps: JobDeps): Job[] {
  const daily = deps.generateDaily ?? ((now: Date) => generateDaily(db, { now, notify: true }));
  const weekly = deps.generateWeekly ?? ((now: Date) => generateWeekly(db, { now, notify: true }));
  const reminders = deps.runReminders ?? ((now: Date) => runReminders(db, now));
  const changes = deps.flushChanges ?? ((now: Date) => flushChangeNotices(db, now));
  const fillAi = deps.fillMissingAi ?? ((now: Date) => fillMissingAi(db, now));
  const networkUp = deps.networkUp ?? (() => waitForNetwork(listSchools(db).flatMap((s) => {
    try {
      return [new URL(s.base_url).hostname];
    } catch {
      return [];
    }
  })));
  // the latest sync of some school stopped because Canvas couldn't be reached
  const lastSyncOffline = () => listSchools(db).some((s) => {
    const run = recentSyncRuns(db, 1, s.id)[0];
    try {
      return !!run?.stats && (JSON.parse(run.stats) as SyncStats).offline === true;
    } catch {
      return false;
    }
  });
  const syncNow = async (now: Date) => {
    // still tried: the run is recorded as offline, which brings the next try forward
    if (!(await networkUp())) log('warn', 'network still unreachable after waiting; trying anyway');
    await deps.runSync({ reason: 'scheduled', onLoginNeeded: deps.onLoginNeeded });
    await changes(now);
    // Re-read syllabi whose sources changed (the analysis itself skips unchanged input), keep guides queued.
    if (readSettings(db).aiEnabled) for (const c of listCourses(db)) enqueueSyllabus(db, c.id);
    autoEnqueueGuides(db, now);
  };
  return [
    {
      name: 'keepalive', // every 30 minutes, day and night, while the Mac is awake
      timeoutMs: 15 * 60_000,
      isDue: (now, last) => isIntervalDue(now, last, 0.5, { start: 0, end: 24 }),
      run: async () => {
        // no school's host resolves: every request would fail slowly (and a lapsed session can't be renewed either)
        if (!(await networkUp())) {
          log('warn', 'network unreachable: keep-alive skipped this round');
          return;
        }
        await keepAliveAll(db, { onLoginNeeded: deps.onLoginNeeded });
      },
    },
    {
      name: 'daily', // settings.dailyTime (07:00); after sleep it runs once on wake. Always syncs first.
      timeoutMs: 40 * 60_000,
      isDue: (now, last, s) => {
        const slot = parseHHMM(s.dailyTime);
        // Only today's slot counts. A slot skipped because its report already existed leaves the job's last run
        // behind it; without this the next day's report would be made at midnight (and every day after that).
        return isSlotDue(now, last, slot) && localDateStr(lastSlotAtOrBefore(now, slot)) === localDateStr(now) && !getReport(db, `daily:${localDateStr(now)}`);
      },
      run: async (now) => {
        await syncNow(now);
        setJob(db, 'sync', { last_run_at: now.toISOString(), last_status: 'ok', last_error: null }); // counts as the scheduled sync
        await daily(now);
      },
    },
    {
      name: 'weekly', // settings.weeklyDay + weeklyTime (Sunday 20:00), caught up once after sleep
      timeoutMs: 20 * 60_000,
      isDue: (now, last, s) => {
        const slot = { ...parseHHMM(s.weeklyTime), weekday: s.weeklyDay };
        const period = weeklyPeriod(now);
        // the due slot must belong to the week the report is about: on Sunday morning last Sunday's slot doesn't
        return isSlotDue(now, last, slot) && weeklyPeriod(lastSlotAtOrBefore(now, slot)) === period && !getReport(db, `weekly:${period}`);
      },
      run: async (now) => {
        await weekly(now);
      },
    },
    {
      name: 'sync',
      timeoutMs: 40 * 60_000,
      isDue: (now, last, s) => isIntervalDue(now, last, lastSyncOffline() ? OFFLINE_RETRY_HOURS : s.syncIntervalHours, { start: s.syncWindowStart, end: s.syncWindowEnd }),
      run: syncNow,
    },
    {
      name: 'reminders', // every 15 minutes: deadline/exam reminders, and alerts for changes found by manual syncs
      timeoutMs: 5 * 60_000,
      isDue: (now, last) => isIntervalDue(now, last, 0.25, { start: 0, end: 24 }),
      run: async (now) => {
        await reminders(now);
        await changes(now);
      },
    },
    {
      name: 'report-ai', // a report whose AI part failed (usage limit, network) gets it filled in later, quietly
      timeoutMs: 20 * 60_000,
      isDue: (now, last) => isIntervalDue(now, last, 0.25, { start: 0, end: 24 }),
      run: async (now) => {
        await fillAi(now);
      },
    },
    {
      name: 'guides', // keep "this week + next week" study guides ready (only re-runs when material changed)
      timeoutMs: 2 * 60_000,
      isDue: (now, last, s) => isIntervalDue(now, last, 0.5, { start: s.syncWindowStart, end: s.syncWindowEnd }),
      run: async (now) => {
        autoEnqueueGuides(db, now);
      },
    },
    {
      name: 'sso-refresh', // daily at noon: keep each school's SSO "remember me" fresh
      timeoutMs: 20 * 60_000,
      isDue: (now, last) => isSlotDue(now, last, { hour: 12, minute: 0 }),
      run: async () => {
        for (const s of listSchools(db)) {
          if (s.auth_mode !== 'session' || s.status !== 'ok' || !loadAuth(s.id)) continue;
          if (s.login_at && Date.now() - Date.parse(s.login_at) < 20 * 3_600_000) continue; // just logged in
          await refreshSso(db, s.id);
        }
      },
    },
    {
      name: 'backup', // 03:30 daily snapshot of the database, 14 kept; caught up on wake
      timeoutMs: 10 * 60_000,
      isDue: (now, last) => isSlotDue(now, last, { hour: 3, minute: 30 }),
      run: async (now) => {
        backupDb(db, now);
      },
    },
    {
      name: 'cleanup',
      timeoutMs: 10 * 60_000,
      isDue: (now, last) => isSlotDue(now, last, { hour: 3, minute: 0 }),
      run: async (now) => {
        cleanTmp();
        pruneRuns(db, new Date(Date.now() - 90 * DAY).toISOString());
        pruneNotices(db, new Date(Date.now() - 60 * DAY).toISOString());
        const pruned = pruneOldData(db, now);
        const upkeep = maintainDb(db, now);
        const cache = await withChromeLock(async () => trimBrowserCache()); // never while a renewal uses the profile
        log('info', 'nightly cleanup', { pruned, upkeep, cacheFreedMB: Math.round(cache.freedBytes / 1024 ** 2) });
      },
    },
  ];
}
