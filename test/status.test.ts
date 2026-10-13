import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statusIssues } from '../src/server/routes/status.ts';

const now = new Date('2026-10-12T20:00:00Z');
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();

test('status issues are spelled out in plain words, each with what to do', () => {
  const issues = statusIssues({
    now,
    schools: [
      { name: 'LACCD', status: 'needs_login', statusDetail: null, lastOkAt: hoursAgo(1) },
      { name: 'SMC', status: 'ok', statusDetail: null, lastOkAt: hoursAgo(10) },
      { name: 'UCLA', status: 'error', statusDetail: '网络错误', lastOkAt: hoursAgo(3) },
      { name: 'Fine', status: 'ok', statusDetail: null, lastOkAt: hoursAgo(1) },
    ],
    jobs: [{ name: 'sync', label: '同步', lastStatus: 'error', lastError: 'boom' }, { name: 'daily', label: '日报', lastStatus: 'ok', lastError: null }],
    latestBackup: null,
    applet: false,
    lastAi: { ok: false, error: 'usage limit reached', at: hoursAgo(0.5) },
  });
  assert.deepEqual(issues.map((i) => i.kind), ['login', 'stale', 'sync-error', 'job', 'backup', 'notifier', 'ai']);
  assert.match(issues[0].text, /LACCD.*重新登录/);
  assert.equal(issues[0].action, 'login');
  assert.match(issues[1].text, /SMC.*10 小时/);
  assert.match(issues[3].text, /同步.*boom/);
});

test('a healthy setup has no issues', () => {
  assert.deepEqual(statusIssues({
    now, schools: [{ name: 'Fine', status: 'ok', statusDetail: null, lastOkAt: hoursAgo(1) }],
    jobs: [], latestBackup: '2026-10-12', applet: true, lastAi: { ok: true, error: null, at: hoursAgo(2) },
  }), []);
});

test('low disk space is an issue before it becomes a crash', () => {
  const issues = statusIssues({
    now, schools: [], jobs: [], latestBackup: '2026-10-12', applet: true, lastAi: null, diskFreeBytes: 1.5 * 1024 ** 3,
  });
  assert.equal(issues[0].kind, 'disk');
  assert.match(issues[0].text, /1\.5 GB/);
  assert.deepEqual(statusIssues({ now, schools: [], jobs: [], latestBackup: '2026-10-12', applet: true, lastAi: null, diskFreeBytes: 20 * 1024 ** 3 }), []);
});
