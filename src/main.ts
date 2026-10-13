// Course Hub server entry point (run by the LaunchAgent): local web UI + API on 127.0.0.1, plus the scheduler
// (keep logins alive, sync, daily SSO refresh, cleanup).
import { serve } from '@hono/node-server';
import { PORT, ensureDataDirs } from './config.ts';
import { cleanTmp } from './content/download.ts';
import { openDb } from './db/index.ts';
import type { SchoolRow } from './db/types.ts';
import { loginNeededNotice, notify } from './notify/mac.ts';
import { createScheduler, defaultJobs } from './scheduler.ts';
import { createApp } from './server/app.ts';
import { makeSyncStarter } from './server/routes/sync.ts';
import { syncAll } from './sync/index.ts';
import { log } from './util/log.ts';

ensureDataDirs();
cleanTmp();
const db = openDb();
const onLoginNeeded = (school: SchoolRow) => void notify(loginNeededNotice(school));
const starter = makeSyncStarter(db, syncAll, { onLoginNeeded });
const app = createApp(db, { starter });
const scheduler = createScheduler(db, defaultJobs(db, { runSync: (opts) => starter.runAndWait(opts), onLoginNeeded }));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  log('info', `Course Hub listening on http://127.0.0.1:${info.port}`);
  scheduler.start();
});

function shutdown() {
  scheduler.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
