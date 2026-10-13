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
import { listCourses } from './db/courses.ts';
import { getSettings as readSettings } from './db/settings.ts';
import type { SyncOptions } from './sync/index.ts';
import { log } from './util/log.ts';

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

export interface Job { name: string; isDue(now: Date, lastRun: Date | null, s: Settings): boolean; run(now: Date): Promise<void> }

export function createScheduler(db: DB, jobs: Job[], opts: { tickMs?: number; clock?: () => Date; settings?: () => Settings } = {}) {
  const clock = opts.clock ?? (() => new Date());
  const settings = opts.settings ?? (() => getSettings(db));
  let busy = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  async function runJob(job: Job, now: Date): Promise<void> {
    setJob(db, job.name, { last_run_at: now.toISOString(), last_status: 'running' });
    try {
      await job.run(now);
      setJob(db, job.name, { last_status: 'ok', last_error: null });
    } catch (err) {
      setJob(db, job.name, { last_status: 'error', last_error: String((err as Error)?.message ?? err).slice(0, 500) });
      log('error', `job ${job.name} failed`, err);
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

export function defaultJobs(db: DB, deps: { runSync: (opts: SyncOptions) => Promise<unknown>; onLoginNeeded: (s: SchoolRow) => void }): Job[] {
  return [
    {
      name: 'keepalive', // every 30 minutes, day and night, while the Mac is awake
      isDue: (now, last) => isIntervalDue(now, last, 0.5, { start: 0, end: 24 }),
      run: async () => {
        await keepAliveAll(db, { onLoginNeeded: deps.onLoginNeeded });
      },
    },
    {
      name: 'sync',
      isDue: (now, last, s) => isIntervalDue(now, last, s.syncIntervalHours, { start: s.syncWindowStart, end: s.syncWindowEnd }),
      run: async () => {
        await deps.runSync({ reason: 'scheduled', onLoginNeeded: deps.onLoginNeeded });
        // Re-read syllabi whose sources changed (the analysis itself skips unchanged input).
        if (readSettings(db).aiEnabled) for (const c of listCourses(db)) enqueueSyllabus(db, c.id);
      },
    },
    {
      name: 'sso-refresh', // daily at noon: keep each school's SSO "remember me" fresh
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
      isDue: (now, last) => isSlotDue(now, last, { hour: 3, minute: 0 }),
      run: async () => {
        cleanTmp();
        pruneRuns(db, new Date(Date.now() - 90 * DAY).toISOString());
      },
    },
  ];
}
