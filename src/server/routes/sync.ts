import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { recentSyncRuns } from '../../db/runs.ts';
import { syncAll, syncRunning } from '../../sync/index.ts';
import type { SyncOptions } from '../../sync/index.ts';
import { log } from '../../util/log.ts';
import { HttpError, readJson } from './util.ts';

export type SyncStarter = (opts: SyncOptions) => boolean;

/** One sync at a time per server; returns a starter that refuses while a run is in flight. */
export function makeSyncStarter(db: DB, runSync: typeof syncAll = syncAll, extra: Partial<SyncOptions> = {}): { start: SyncStarter; busy: () => boolean } {
  let inFlight: Promise<unknown> | null = null;
  const busy = () => inFlight !== null || syncRunning() !== null;
  const start: SyncStarter = (opts) => {
    if (busy()) return false;
    inFlight = runSync(db, { ...extra, ...opts })
      .catch((err) => log('error', 'sync failed', err))
      .finally(() => {
        inFlight = null;
      });
    return true;
  };
  return { start, busy };
}

export function registerSync(app: Hono, db: DB, starter: { start: SyncStarter; busy: () => boolean }): void {
  app.post('/api/sync', async (c) => {
    const body = await readJson<{ schoolId?: string }>(c).catch(() => ({ schoolId: undefined }));
    if (!starter.start({ schoolId: body.schoolId, reason: 'manual' })) throw new HttpError(409, '正在同步，请稍后再试');
    return c.json({ status: 'started' }, 202);
  });
  app.get('/api/sync', (c) => c.json({ running: starter.busy(), recent: recentSyncRuns(db, 20) }));
}
