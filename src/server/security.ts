// Local-only guards: the API must not be reachable from other sites (DNS rebinding, cross-site requests), and the
// app's pages are locked down so that even content which slipped past sanitizing could not run or be framed.
import type { MiddlewareHandler } from 'hono';

/**
 * The page may only run the app's own scripts and talk to its own server. Canvas pages show images and media from
 * anywhere (teachers embed them), so those stay open; nothing may embed the app, and there are no plugins or forms
 * that post elsewhere.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  'img-src * data: blob:',
  'media-src * data: blob:',
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join('; ');

const BASE_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  // another site can't even embed our responses (an <img> of a proxied Canvas file, a <script> of an API reply)
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export function security(port: number): MiddlewareHandler {
  const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const origins = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  return async (c, next) => {
    if (!hosts.has(new URL(c.req.url).host)) return c.text('Forbidden host', 403);
    const origin = c.req.header('origin');
    if (origin && !origins.has(origin)) return c.text('Forbidden origin', 403);
    const method = c.req.method;
    if (method !== 'GET' && method !== 'HEAD' && c.req.header('x-coursehub') !== '1') return c.text('Missing X-CourseHub header', 403);
    await next();
    const headers = c.res.headers;
    for (const [k, v] of Object.entries(BASE_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    if (!headers.has('Content-Security-Policy')) headers.set('Content-Security-Policy', APP_CSP);
  };
}
