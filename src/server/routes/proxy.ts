import type { Hono } from 'hono';
import { SessionExpiredError } from '../../canvas/client.ts';
import type { DB } from '../../db/index.ts';
import { getSchool } from '../../db/schools.ts';
import { makeClient } from '../../auth/store.ts';
import { PROXY_ALLOW } from '../../util/html.ts';

/** Fetches whitelisted Canvas media (images in pages, equation images) with the stored session. */
export function registerProxy(app: Hono, db: DB): void {
  app.get('/proxy/:schoolId/*', async (c) => {
    const schoolId = c.req.param('schoolId');
    const url = new URL(c.req.url);
    const canvasPath = url.pathname.slice(`/proxy/${schoolId}`.length);
    if (!PROXY_ALLOW.some((re) => re.test(canvasPath))) return c.text('Not found', 404);
    const school = getSchool(db, schoolId);
    const client = school ? makeClient(school) : null;
    if (!school || !client) return c.text('Not found', 404);
    try {
      const res = await client.fetchRaw(`${school.base_url}${canvasPath}${url.search}`);
      return new Response(res.body, {
        status: 200,
        headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=3600' },
      });
    } catch (err) {
      return c.text(err instanceof SessionExpiredError ? 'Login expired' : 'Upstream error', err instanceof SessionExpiredError ? 401 : 502);
    }
  });
}
