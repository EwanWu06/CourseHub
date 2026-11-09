// Keeps a long-running install lean: old bookkeeping pruned, the database tidied, Chrome's caches trimmed,
// disk space watched. Runs from the 03:00 cleanup job.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, rmSync, statSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { dataDir, paths } from './config.ts';
import type { DB } from './db/index.ts';
import { all, one, run } from './db/sql.ts';
import { addDays, localDateStr } from './util/time.ts';

const DAY = 86_400_000;

const n = (r: { changes: number | bigint }) => Number(r.changes);

/** Deletes what is no longer useful; never anything pending or recent. */
export function pruneOldData(db: DB, now: Date): { changes: number; reminders: number; reports: number; items: number; texts: number } {
  const before = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
  const changes = n(run(db, 'DELETE FROM changes WHERE notified = 1 AND created_at < $t', { t: before(120) }));
  const reminders = n(run(db, 'DELETE FROM reminders_sent WHERE sent_at < $t', { t: before(120) }));
  const reports = n(run(db, "DELETE FROM reports WHERE type = 'daily' AND period < $p", { p: addDays(localDateStr(now), -400) }));
  const items = n(run(db, 'DELETE FROM items WHERE removed = 1 AND updated_at < $t', { t: before(180) }));

  // extracted slide text for files Canvas no longer lists
  let texts = 0;
  const dir = paths().text;
  if (existsSync(dir)) {
    const keep = new Set(all<{ id: string }>(db, 'SELECT id FROM files').map((f) => `${f.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`));
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || keep.has(name)) continue;
      rmSync(path.join(dir, name), { force: true });
      texts++;
    }
  }
  return { changes, reminders, reports, items, texts };
}

/** Planner statistics, WAL folded back into the main file, and a VACUUM when a lot of space is free inside it. */
export function maintainDb(db: DB, _now: Date): { vacuumed: boolean } {
  db.exec('PRAGMA optimize');
  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
  const pages = Number(Object.values(one<object>(db, 'PRAGMA page_count') ?? { n: 0 })[0]);
  const free = Number(Object.values(one<object>(db, 'PRAGMA freelist_count') ?? { n: 0 })[0]);
  if (free > 500 && free / Math.max(1, pages) > 0.2) {
    db.exec('VACUUM');
    return { vacuumed: true };
  }
  return { vacuumed: false };
}

// pure caches inside the login profile; cookies, Local Storage and IndexedDB (where logins live) are untouched
const CACHE_DIRS = [
  'Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/DawnGraphiteCache', 'Default/DawnWebGPUCache',
  'Default/Service Worker/CacheStorage', 'Default/Service Worker/ScriptCache', 'GraphiteDawnCache', 'GrShaderCache',
  'ShaderCache', 'component_crx_cache', 'BrowserMetrics',
];

function sizeOf(p: string): number {
  try {
    const st = statSync(p);
    if (!st.isDirectory()) return st.size;
    return readdirSync(p).reduce((sum, name) => sum + sizeOf(path.join(p, name)), 0);
  } catch {
    return 0;
  }
}

function profileInUse(profileDir: string): boolean {
  try {
    execFileSync('/usr/bin/pgrep', ['-f', profileDir], { stdio: 'ignore' });
    return true; // some process (a login window, a renewal) has the profile open
  } catch {
    return false;
  }
}

export function trimBrowserCache(profileDir: string = paths().profile, opts: { chromeRunning?: () => boolean } = {}): { trimmed: boolean; freedBytes: number } {
  if ((opts.chromeRunning ?? (() => profileInUse(profileDir)))()) return { trimmed: false, freedBytes: 0 };
  let freedBytes = 0;
  for (const rel of CACHE_DIRS) {
    const p = path.join(profileDir, rel);
    if (!existsSync(p)) continue;
    freedBytes += sizeOf(p);
    rmSync(p, { recursive: true, force: true });
  }
  return { trimmed: true, freedBytes };
}

export function diskFreeBytes(dir: string = dataDir()): number | null {
  try {
    const s = statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch {
    return null;
  }
}

export const LOW_DISK_BYTES = 2 * 1024 ** 3;
