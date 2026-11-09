// Course Hub server entry point (run by the LaunchAgent): local web UI + API on 127.0.0.1, plus the scheduler
// (keep logins alive, sync + change alerts, 7:00 daily / Sunday 20:00 weekly reports, deadline reminders,
// study guides, daily SSO refresh, cleanup).
import { serve } from '@hono/node-server';
import path from 'node:path';
import { PORT, ensureDataDirs, paths } from './config.ts';
import { cleanTmp } from './content/download.ts';
import { checkDatabase, repairFromBackup } from './db/backup.ts';
import { openDb } from './db/index.ts';
import { recordNotice } from './db/notices.ts';
import type { SchoolRow } from './db/types.ts';
import { loginNeededNotice, notify, setNoticeRecorder } from './notify/mac.ts';
import { createScheduler, defaultJobs } from './scheduler.ts';
import { createApp } from './server/app.ts';
import { makeSyncStarter } from './server/routes/sync.ts';
import { syncAll } from './sync/index.ts';
import { resumeQueuedGuides } from './ai/guide.ts';
import { resumePendingQuestions } from './ai/ask.ts';
import { probeInstance } from './server/instance.ts';
import { log } from './util/log.ts';
import { consumeWatchdogNote, killOrphans, startWatchdog } from './watchdog.ts';

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
// Chromes an earlier Course Hub started and left running (crash, forced restart) hold profiles and memory
const orphans = killOrphans([paths().profile, paths().achieveProfile]);
if (orphans) log('warn', `stopped ${orphans} Chrome process(es) an earlier Course Hub left running`);
cleanTmp();
// A damaged database is set aside and the newest good daily backup restored before anything opens it.
let repaired: { restored: string | null } | null = null;
const dbState = checkDatabase(paths().db);
if (dbState === 'corrupt') {
  repaired = repairFromBackup(paths().db);
  log('error', `database was damaged; restored from ${repaired.restored ?? '(no backup — starting fresh)'}`);
} else if (dbState === 'unreadable') {
  log('warn', 'database could not be checked right now (locked or permissions); leaving it as it is');
}
const db = openDb();
setNoticeRecorder((n) => recordNotice(db, n));
if (consumeWatchdogNote(db, paths().watchdogNote)) log('warn', 'the previous run was stuck and was restarted by the watchdog');
// a wedged main thread is killed after 2 minutes so launchd starts a fresh one
if (!process.env.COURSEHUB_NO_WATCHDOG) startWatchdog({ notePath: paths().watchdogNote });
const onLoginNeeded = (school: SchoolRow) => void notify(loginNeededNotice(school));
const starter = makeSyncStarter(db, syncAll, { onLoginNeeded });
const app = createApp(db, { starter });
const scheduler = createScheduler(db, defaultJobs(db, { runSync: (opts) => starter.runAndWait(opts), onLoginNeeded }));

const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  log('info', `Course Hub listening on http://127.0.0.1:${info.port}`);
  resumeQueuedGuides(db);
  resumePendingQuestions(db);
  scheduler.start();
  if (repaired) {
    const from = repaired.restored ? path.basename(repaired.restored).replace(/^coursehub-|\.sqlite$/g, '') : null;
    void notify({
      kind: 'system',
      title: '数据库已自动修复',
      body: from ? `数据文件损坏，已从 ${from} 的备份恢复；之后勾选的完成和备注可能要重做。` : '数据文件损坏且没有备份，已重新开始；请在设置里重新登录各学校。',
      url: `http://127.0.0.1:${PORT}/`,
    });
  }
});

function shutdown() {
  scheduler.stop();
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
