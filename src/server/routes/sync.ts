import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { recentSyncRuns } from '../../db/runs.ts';
import { syncAll, syncRunning } from '../../sync/index.ts';
import type { SyncOptions } from '../../sync/index.ts';
import { log } from '../../util/log.ts';
import { HttpError, readJson } from './util.ts';

export type SyncStarter = (opts: SyncOptions) => boolean;
export interface SyncHandle { start: SyncStarter; busy: () => boolean; runAndWait: (opts: SyncOptions) => Promise<boolean> }

/** One sync at a time per server (API clicks, after-login syncs and the scheduler share this guard). */
export function makeSyncStarter(db: DB, runSync: typeof syncAll = syncAll, extra: Partial<SyncOptions> = {}): SyncHandle {
  let inFlight: Promise<unknown> | null = null;
  const busy = () => inFlight !== null || syncRunning() !== null;
  const launch = (opts: SyncOptions) => {
    inFlight = runSync(db, { ...extra, ...opts })
      .catch((err) => log('error', 'sync failed', err))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };
  const start: SyncStarter = (opts) => {
    if (busy()) return false;
    void launch(opts);
    return true;
  };
  const runAndWait = async (opts: SyncOptions) => {
    if (busy()) return false;
    await launch(opts);
    return true;
  };
  return { start, busy, runAndWait };
}

export function registerSync(app: Hono, db: DB, starter: SyncHandle): void {
  app.post('/api/sync', async (c) => {
    const body = await readJson<{ schoolId?: string }>(c).catch(() => ({ schoolId: undefined }));
    if (!starter.start({ schoolId: body.schoolId, reason: 'manual' })) throw new HttpError(409, '正在同步，请稍后再试');
    return c.json({ status: 'started' }, 202);
  });
  app.get('/api/sync', (c) => c.json({ running: starter.busy(), recent: recentSyncRuns(db, 20) }));
}
