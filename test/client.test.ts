import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { startHttp } from './helpers.ts';
import { CookieJar } from '../src/canvas/cookies.ts';
import {
  CanvasClient, SessionExpiredError, CanvasForbiddenError, CanvasNotFoundError, parseLinkNext, stripWhile1,
} from '../src/canvas/client.ts';

const UA = 'Mozilla/5.0 test';
const sessionJar = () => new CookieJar([{ name: 'canvas_session', value: 's1', domain: '127.0.0.1', path: '/', expires: -1, httpOnly: true, secure: false }]);
const noSleep = async () => {};

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function withServer(handler: (req: IncomingMessage, res: ServerResponse) => void, fn: (url: string) => Promise<void>) {
  const srv = await startHttp(handler);
  try {
    await fn(srv.url);
  } finally {
    await srv.close();
  }
}

test('stripWhile1 and parseLinkNext helpers', () => {
  assert.equal(stripWhile1('while(1);[1]'), '[1]');
  assert.equal(stripWhile1('[1]'), '[1]');
  const link = '<https://x.edu/api/v1/c?page=1>; rel="current",<https://x.edu/api/v1/c?page=2>; rel="next",<https://x.edu/api/v1/c?page=9>; rel="last"';
  assert.equal(parseLinkNext(link), 'https://x.edu/api/v1/c?page=2');
  assert.equal(parseLinkNext('<https://x.edu/a>; rel="last"'), null);
  assert.equal(parseLinkNext(null), null);
});

test('session responses prefixed with while(1); are parsed', async () => {
  await withServer((req, res) => {
    assert.equal(req.headers.cookie, 'canvas_session=s1');
    assert.equal(req.headers['user-agent'], UA);
    assert.match(String(req.headers.accept), /application\/json\+canvas-string-ids/);
    json(res, 200, 'while(1);[{"id":"1"}]');
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    assert.deepEqual(await c.get('/api/v1/courses'), [{ id: '1' }]);
    assert.equal(c.requestCount, 1);
  });
});

test('getAll follows Link rel=next across pages', async () => {
  await withServer((req, res) => {
    const u = new URL(req.url!, 'http://127.0.0.1');
    const page = Number(u.searchParams.get('page') ?? '1');
    assert.equal(u.searchParams.get('per_page'), '100');
    const rows = Array.from({ length: page < 3 ? 100 : 50 }, (_, i) => ({ id: `${page}-${i}` }));
    const headers: Record<string, string> = {};
    if (page < 3) headers.Link = `<http://${req.headers.host}/api/v1/items?page=${page + 1}&per_page=100>; rel="next"`;
    json(res, 200, rows, headers);
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    const all = await c.getAll<{ id: string }>('/api/v1/items');
    assert.equal(all.length, 250);
    assert.equal(c.requestCount, 3);
  });
});

test('array params serialize as repeated key[] entries', async () => {
  await withServer((req, res) => json(res, 200, { url: decodeURIComponent(req.url!) }), async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    const r = await c.get<{ url: string }>('/api/v1/courses', { 'include[]': ['term', 'total_scores'], enrollment_state: 'active', skip: undefined });
    assert.equal(r.url, '/api/v1/courses?include[]=term&include[]=total_scores&enrollment_state=active');
  });
});

test('redirect to /login means the session expired', async () => {
  await withServer((_req, res) => { res.writeHead(302, { Location: '/login?redirect=1' }); res.end(); }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    await assert.rejects(c.get('/api/v1/courses'), SessionExpiredError);
  });
});

test('an HTML page instead of JSON means the session expired', async () => {
  await withServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<html>login</html>'); }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    await assert.rejects(c.get('/api/v1/courses'), SessionExpiredError);
  });
});

test('401 unauthenticated → SessionExpiredError; 401 unauthorized → CanvasForbiddenError; 404 → CanvasNotFoundError', async () => {
  await withServer((req, res) => {
    if (req.url!.startsWith('/a')) json(res, 401, { status: 'unauthenticated', errors: [{ message: 'user authorization required' }] });
    else if (req.url!.startsWith('/b')) json(res, 401, { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] });
    else json(res, 404, { errors: [{ message: 'The specified resource does not exist.' }] });
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
    await assert.rejects(c.get('/a'), SessionExpiredError);
    await assert.rejects(c.get('/b'), CanvasForbiddenError);
    await assert.rejects(c.get('/c'), CanvasNotFoundError);
  });
});

test('rate-limited 403 is retried after a backoff sleep', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await withServer((_req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(403, { 'Content-Type': 'text/plain' }); res.end('403 Forbidden (Rate Limit Exceeded)'); return; }
    json(res, 200, { ok: true });
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: async (ms) => { sleeps.push(ms); } });
    assert.deepEqual(await c.get('/api/v1/x'), { ok: true });
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [2000]);
  });
});

test('5xx responses are retried three times, waiting longer each time', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await withServer((_req, res) => {
    calls++;
    if (calls < 4) { json(res, 502, { error: 'bad gateway' }); return; }
    json(res, 200, [1]);
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: async (ms) => { sleeps.push(ms); } });
    assert.deepEqual(await c.get('/api/v1/x'), [1]);
    assert.deepEqual(sleeps, [500, 2000, 6000]);
  });
});

test('429 Too Many Requests waits as long as Retry-After says (capped)', async () => {
  let calls = 0;
  const sleeps: number[] = [];
  await withServer((_req, res) => {
    calls++;
    if (calls === 1) { json(res, 429, { error: 'slow down' }, { 'Retry-After': '3' }); return; }
    if (calls === 2) { json(res, 429, { error: 'slow down' }, { 'Retry-After': '9999' }); return; }
    json(res, 200, [2]);
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: async (ms) => { sleeps.push(ms); } });
    assert.deepEqual(await c.get('/api/v1/x'), [2]);
    assert.deepEqual(sleeps, [3000, 30000]);
  });
});

test('downloads are retried after a server hiccup', async () => {
  let calls = 0;
  await withServer((_req, res) => {
    calls++;
    if (calls === 1) { res.writeHead(503); res.end('busy'); return; }
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end('PDF');
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: noSleep });
    assert.equal(await (await c.fetchRaw(`${url}/files/1/download`)).text(), 'PDF');
    assert.equal(calls, 2);
  });
});

test('low X-Rate-Limit-Remaining slows the next request down', async () => {
  const sleeps: number[] = [];
  await withServer((_req, res) => json(res, 200, [], { 'X-Rate-Limit-Remaining': '12.5' }), async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: async (ms) => { sleeps.push(ms); } });
    await c.get('/api/v1/x');
    await c.get('/api/v1/x');
    assert.deepEqual(sleeps, [1000]);
  });
});

test('Set-Cookie on API responses updates the jar', async () => {
  await withServer((_req, res) => json(res, 200, [], { 'Set-Cookie': 'canvas_session=rotated; path=/; HttpOnly' }), async (url) => {
    const jar = sessionJar();
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar, userAgent: UA } });
    await c.get('/api/v1/x');
    assert.equal(jar.changed, true);
    assert.equal(jar.headerFor(url + '/'), 'canvas_session=rotated');
  });
});

test('token auth sends a bearer header and no cookie', async () => {
  await withServer((req, res) => json(res, 200, { auth: req.headers.authorization ?? null, cookie: req.headers.cookie ?? null }), async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'token', token: 't0k' } });
    assert.deepEqual(await c.get('/api/v1/users/self'), { auth: 'Bearer t0k', cookie: null });
  });
});

test('fetchRaw follows a redirect to another host without leaking cookies', async () => {
  const seen: Record<string, string | null> = {};
  const blob = await startHttp((req, res) => {
    seen.blob = req.headers.cookie ?? null;
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end('%PDF-1.4 data');
  }, 'localhost');
  try {
    await withServer((req, res) => {
      seen.canvas = req.headers.cookie ?? null;
      res.writeHead(302, { Location: `${blob.url}/blob/1?token=x` });
      res.end();
    }, async (url) => {
      const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA } });
      const res = await c.fetchRaw(`${url}/files/1/download?download_frd=1`);
      assert.equal(await res.text(), '%PDF-1.4 data');
      assert.equal(seen.canvas, 'canvas_session=s1');
      assert.equal(seen.blob, null);
    });
  } finally {
    await blob.close();
  }
});

test('no more than 3 requests are in flight at once', async () => {
  let inFlight = 0;
  let max = 0;
  await withServer((_req, res) => {
    inFlight++;
    max = Math.max(max, inFlight);
    setTimeout(() => { inFlight--; json(res, 200, []); }, 30);
  }, async (url) => {
    const c = new CanvasClient({ baseUrl: url, auth: { kind: 'session', jar: sessionJar(), userAgent: UA }, sleep: noSleep });
    await Promise.all(Array.from({ length: 10 }, () => c.get('/api/v1/x')));
    assert.equal(max, 3);
  });
});
