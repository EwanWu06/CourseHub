// Real Chrome against a local stand-in for the Canvas → publisher → Achieve launch chain.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHttp, tmpDataDir } from '../helpers.ts';
import { readAchieveInChrome } from '../../src/platforms/achieve.ts';

const UUID = 'c0ffee00-0000-4000-8000-000000000001';

async function chain(opts: { reachAchieve?: boolean; itemCount?: number } = {}) {
  tmpDataDir(); // the throwaway profile lives in the data dir
  const seen: string[] = [];
  const achieve = await startHttp((req, res) => {
    seen.push(`${req.method} ${req.url}`);
    const authed = /accessToken=tok/.test(req.headers.cookie ?? '');
    if (req.url?.startsWith('/courses/')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Achieve</title><script src="/app.js"></script>');
    } else if (req.url === `/api/v1/myCourse/${UUID}/timeline?pageSize=500&page=0`) {
      if (!authed) return void (res.writeHead(401), res.end());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ page: 0, itemCount: opts.itemCount ?? 2, items: [
        { id: 'a1', name: 'Pre-Class Review Questions 8.1-8.3', tool: 'assessment', points: 13, dueDate: '2026-10-14T01:30:00.000Z', gradebookCategoryName: 'Week 4' },
        { id: 'a2', name: '8.1 An Overview of Photosynthesis', tool: 'reading', points: null, dueDate: '2026-10-14T01:30:00.000Z', gradebookCategoryName: 'Ungraded' },
      ] }));
    } else if (req.url === `/api/v1/courses/${UUID}/assignments/completion-statuses`) {
      if (!authed) return void (res.writeHead(401), res.end());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ assignmentCompletionStatuses: [{ assignment_id: 'a1', status: 'Completed' }, { assignment_id: 'a2', status: '' }] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  }, 'localhost');
  const tool = await startHttp((req, res) => {
    seen.push(`tool ${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/lti' && opts.reachAchieve !== false) {
      res.writeHead(302, { Location: `${achieve.url}/courses/abc/overview`, 'Set-Cookie': 'accessToken=tok; Path=/' });
      res.end();
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><p>Your Achieve access has expired.</p>');
    }
  }, 'localhost');
  const canvas = await startHttp((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><form id="f" method="post" action="${tool.url}/lti"><input name="oauth_signature" value="sig"></form><script>document.getElementById('f').submit()</script>`);
  });
  const port = new URL(achieve.url).port;
  const hosts = {
    landing: new RegExp(`^http://localhost:${port}/courses/`), app: new RegExp(`^http://localhost:${port}/.*\\.js(\\?|$)`),
    api: achieve.url, gradebook: achieve.url,
  };
  return { seen, hosts, launchUrl: `${canvas.url}/courses/303/external_tools/sessionless_launch?verifier=v1`, close: () => Promise.all([achieve.close(), tool.close(), canvas.close()]) };
}

test('follows the LTI launch, never runs Achieve\'s own app, and reads the timeline and statuses', { timeout: 90_000 }, async () => {
  const c = await chain();
  try {
    const data = await readAchieveInChrome(c.launchUrl, UUID, c.hosts, 30_000);
    assert.deepEqual(data.items.map((i) => [i.id, i.dueDate, i.points]), [['a1', '2026-10-14T01:30:00.000Z', 13], ['a2', '2026-10-14T01:30:00.000Z', null]]);
    assert.deepEqual(data.statuses, { a1: 'Completed', a2: '' });
    assert.ok(c.seen.includes('tool POST /lti'));
    assert.ok(!c.seen.some((r) => r.includes('/app.js')), 'the platform app never loaded');
    assert.ok(!c.seen.some((r) => /^(PUT|POST|DELETE|PATCH) /.test(r)), 'nothing but reads against Achieve');
  } finally {
    await c.close();
  }
});

test('a launch that never reaches the course says so instead of returning nothing', { timeout: 90_000 }, async () => {
  const c = await chain({ reachAchieve: false });
  try {
    await assert.rejects(readAchieveInChrome(c.launchUrl, UUID, c.hosts, 5_000), /没有进入 Achieve 课程页/);
  } finally {
    await c.close();
  }
});

test('a timeline that admits it is incomplete is an error, never a partial list', { timeout: 90_000 }, async () => {
  const c = await chain({ itemCount: 3 });
  try {
    await assert.rejects(readAchieveInChrome(c.launchUrl, UUID, c.hosts, 30_000), /不按部分结果处理/);
  } finally {
    await c.close();
  }
});
