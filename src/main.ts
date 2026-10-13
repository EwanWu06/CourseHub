// Course Hub server entry point (run by the LaunchAgent): local web UI + API on 127.0.0.1, plus the scheduler
// (keep logins alive, sync + change alerts, 7:00 daily / Sunday 20:00 weekly reports, deadline reminders,
// study guides, daily SSO refresh, cleanup).
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
import { resumeQueuedGuides } from './ai/guide.ts';
import { probeInstance } from './server/instance.ts';
import { log } from './util/log.ts';

// Stay up: log stray promise failures; on a truly unexpected exception exit so launchd restarts a clean process.
process.on('unhandledRejection', (reason) => log('error', 'unhandled promise rejection', reason));
process.on('uncaughtException', (err) => {
  log('error', 'uncaught exception — exiting so launchd restarts Course Hub', err);
  process.exit(1);
});

ensureDataDirs();
// Only one Course Hub at a time (the LaunchAgent and a manual start must not fight over the port).
const existing = await probeInstance(`http://127.0.0.1:${PORT}`);
if (existing === 'ours') {
  log('info', 'Course Hub is already running; this copy exits');
  process.exit(0);
}
if (existing === 'other') {
  log('error', `port ${PORT} is taken by another program; Course Hub can't start`);
  process.exit(1);
}
cleanTmp();
const db = openDb();
const onLoginNeeded = (school: SchoolRow) => void notify(loginNeededNotice(school));
const starter = makeSyncStarter(db, syncAll, { onLoginNeeded });
const app = createApp(db, { starter });
const scheduler = createScheduler(db, defaultJobs(db, { runSync: (opts) => starter.runAndWait(opts), onLoginNeeded }));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  log('info', `Course Hub listening on http://127.0.0.1:${info.port}`);
  resumeQueuedGuides(db);
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
