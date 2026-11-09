// UI QA environment: two mock schools, synced into a throwaway data dir, served on COURSEHUB_PORT (4198).
//   npm run qa            → synced data
//   npm run qa -- --empty → no schools (empty states)
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';

process.env.COURSEHUB_DATA_DIR ??= mkdtempSync(path.join(tmpdir(), 'coursehub-qa-'));
const { PORT, ensureDataDirs } = await import('../src/config.ts');
const { openDb } = await import('../src/db/index.ts');
const { createSchool } = await import('../src/db/schools.ts');
const { saveAuth } = await import('../src/auth/store.ts');
const { syncSchool } = await import('../src/sync/index.ts');
const { createApp } = await import('../src/server/app.ts');
const { startMockCanvas } = await import('../mock/server.ts');

ensureDataDirs();
const db = openDb();
const alpha = await startMockCanvas({ variant: 'alpha', port: 4301, idp: true });
const beta = await startMockCanvas({ variant: 'beta', port: 4302 });

if (!process.argv.includes('--empty')) {
  for (const [name, mock] of [['Santa Monica College', alpha], ['Pasadena City College', beta]] as const) {
    const school = createSchool(db, { name, base_url: mock.baseUrl });
    saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'qa', cookies: mock.sessionCookies() });
    await syncSchool(db, school.id, { reason: 'qa', relogin: null });
  }
}

const app = createApp(db);
serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, () => {
  console.log(`QA ready http://127.0.0.1:${PORT}  data=${process.env.COURSEHUB_DATA_DIR}`);
});
const stop = async () => {
  await Promise.all([alpha.close(), beta.close()]);
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
