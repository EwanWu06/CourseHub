// Local-only guards: the API must not be reachable from other sites (DNS rebinding, cross-site requests).
import type { MiddlewareHandler } from 'hono';

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
  };
}
