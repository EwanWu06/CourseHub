import type { Hono } from 'hono';
import { SessionExpiredError } from '../../canvas/client.ts';
import type { DB } from '../../db/index.ts';
import { getSchool } from '../../db/schools.ts';
import { makeClient } from '../../auth/store.ts';
import { PROXY_ALLOW } from '../../util/html.ts';

/** Shown in place (an <img>, a <video>, a PDF tab); anything else is handed over as a download. */
const VIEWABLE = /^(image\/(png|jpe?g|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)|video\/|audio\/|application\/pdf)/i;

/**
 * Canvas keeps uploaded files on a separate domain so that a file someone uploaded (an .html page, an .svg with a
 * script) can never act as the Canvas site. Passed through here it would be served from Course Hub's own address,
 * so it is sandboxed: it can be looked at, but nothing in it runs. (Chrome won't show a PDF inside a sandbox, and
 * its PDF viewer doesn't give a document's scripts the page anyway, so PDFs are left out.)
 */
export function proxyHeaders(upstreamType: string | null): Record<string, string> {
  const type = upstreamType ?? 'application/octet-stream';
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (!/^application\/pdf/i.test(type)) headers['Content-Security-Policy'] = "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
  if (!VIEWABLE.test(type)) headers['Content-Disposition'] = 'attachment';
  return headers;
}

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
      return new Response(res.body, { status: 200, headers: proxyHeaders(res.headers.get('content-type')) });
    } catch (err) {
      return c.text(err instanceof SessionExpiredError ? 'Login expired' : 'Upstream error', err instanceof SessionExpiredError ? 401 : 502);
    }
  });
}
