// Minute-tick scheduler with catch-up: a job is due when its last run is older than its most recent slot
// (or interval), so anything missed while the Mac slept runs once after wake.
import type { DB } from './db/index.ts';
import { getJob, pruneRuns, setJob } from './db/runs.ts';
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
import { flushChangeNotices } from './notify/changes.ts';
import { runReminders } from './notify/reminders.ts';
import { getReport } from './db/reports.ts';
import { weeklyPeriod } from './reports/data.ts';
import { generateDaily } from './reports/daily.ts';
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
}

export function defaultJobs(db: DB, deps: JobDeps): Job[] {
  const daily = deps.generateDaily ?? ((now: Date) => generateDaily(db, { now, notify: true }));
  const weekly = deps.generateWeekly ?? ((now: Date) => generateWeekly(db, { now, notify: true }));
  const reminders = deps.runReminders ?? ((now: Date) => runReminders(db, now));
  const changes = deps.flushChanges ?? ((now: Date) => flushChangeNotices(db, now));
  const networkReady = async () => {
    const hosts = listSchools(db).flatMap((s) => {
      try {
        return [new URL(s.base_url).hostname];
      } catch {
        return [];
      }
    });
    if (!(await waitForNetwork(hosts))) log('warn', 'network still unreachable after waiting; trying anyway');
  };
  const syncNow = async (now: Date) => {
    await networkReady();
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
        await networkReady();
        await keepAliveAll(db, { onLoginNeeded: deps.onLoginNeeded });
      },
    },
    {
      name: 'daily', // settings.dailyTime (07:00); after sleep it runs once on wake. Always syncs first.
      timeoutMs: 40 * 60_000,
      isDue: (now, last, s) => isSlotDue(now, last, parseHHMM(s.dailyTime)) && !getReport(db, `daily:${localDateStr(now)}`),
      run: async (now) => {
        await syncNow(now);
        setJob(db, 'sync', { last_run_at: now.toISOString(), last_status: 'ok', last_error: null }); // counts as the scheduled sync
        await daily(now);
      },
    },
    {
      name: 'weekly', // settings.weeklyDay + weeklyTime (Sunday 20:00), caught up once after sleep
      timeoutMs: 20 * 60_000,
      isDue: (now, last, s) => isSlotDue(now, last, { ...parseHHMM(s.weeklyTime), weekday: s.weeklyDay }) && !getReport(db, `weekly:${weeklyPeriod(now)}`),
      run: async (now) => {
        await weekly(now);
      },
    },
    {
      name: 'sync',
      timeoutMs: 40 * 60_000,
      isDue: (now, last, s) => isIntervalDue(now, last, s.syncIntervalHours, { start: s.syncWindowStart, end: s.syncWindowEnd }),
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
      name: 'cleanup',
      timeoutMs: 10 * 60_000,
      isDue: (now, last) => isSlotDue(now, last, { hour: 3, minute: 0 }),
      run: async () => {
        cleanTmp();
        pruneRuns(db, new Date(Date.now() - 90 * DAY).toISOString());
      },
    },
  ];
}
