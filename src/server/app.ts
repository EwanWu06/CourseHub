import { Hono } from 'hono';
import { PORT } from '../config.ts';
import type { DB } from '../db/index.ts';
import type { ReportRow } from '../db/types.ts';
import type { interactiveLogin } from '../auth/login.ts';
import type { syncAll, SyncOptions } from '../sync/index.ts';
import { log } from '../util/log.ts';
import { security } from './security.ts';
import { registerCourses } from './routes/courses.ts';
import { registerItems } from './routes/items.ts';
import { registerOverview } from './routes/overview.ts';
import { registerProxy } from './routes/proxy.ts';
import { registerSchools } from './routes/schools.ts';
import { registerSettings } from './routes/settings.ts';
import { registerStatic } from './routes/static.ts';
import { makeSyncStarter, registerSync } from './routes/sync.ts';
import { HttpError } from './routes/util.ts';

export interface AppDeps {
  startLogin?: typeof interactiveLogin;
  runSync?: typeof syncAll;
  syncOptions?: Partial<SyncOptions>;
  enqueueGuide?: (courseId: string, week: number, force: boolean) => boolean;
  generateReport?: (type: 'daily' | 'weekly') => Promise<ReportRow>;
}

export function createApp(db: DB, deps: AppDeps = {}): Hono {
  const app = new Hono();
  app.use('*', security(PORT));
  app.onError((err, c) => {
    if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
    log('error', `${c.req.method} ${c.req.path} failed`, err);
    return c.json({ error: '服务器出错了，请看日志 data/logs/app.log' }, 500);
  });

  const starter = makeSyncStarter(db, deps.runSync, deps.syncOptions);
  app.get('/api/health', (c) => c.json({ ok: true }));
  registerOverview(app, db);
  registerItems(app, db);
  registerCourses(app, db);
  registerSchools(app, db, { startLogin: deps.startLogin, startSync: starter.start });
  registerSync(app, db, starter);
  registerSettings(app, db);
  for (const prefix of ['/api/study', '/api/reports']) {
    app.all(prefix, (c) => c.json({ error: '尚未实现' }, 501));
    app.all(`${prefix}/*`, (c) => c.json({ error: '尚未实现' }, 501));
  }
  app.all('/api/*', (c) => c.json({ error: '不存在' }, 404));
  registerProxy(app, db);
  registerStatic(app);
  return app;
}
