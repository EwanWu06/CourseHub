// Course Hub server entry point (run by the LaunchAgent): local web UI + API on 127.0.0.1.
import { serve } from '@hono/node-server';
import { PORT, ensureDataDirs } from './config.ts';
import { cleanTmp } from './content/download.ts';
import { openDb } from './db/index.ts';
import { createApp } from './server/app.ts';
import { log } from './util/log.ts';

ensureDataDirs();
cleanTmp();
const db = openDb();
const app = createApp(db);
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  log('info', `Course Hub listening on http://127.0.0.1:${info.port}`);
});

function shutdown() {
  server.close();
  db.close();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
