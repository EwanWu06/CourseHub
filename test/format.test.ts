import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDue, fmtCountdown, fmtRelative } from '../web/src/format.ts';
import { matchRoute } from '../web/src/route-match.ts';

const NOW = new Date('2026-10-12T17:00:00Z'); // Monday 10:00 PDT

test('fmtDue speaks in days relative to today', () => {
  assert.equal(fmtDue('2026-10-13T06:59:00Z', NOW), '今天 23:59');
  assert.equal(fmtDue('2026-10-13T16:00:00Z', NOW), '明天 09:00');
  assert.equal(fmtDue('2026-10-12T06:59:00Z', NOW), '昨天 23:59');
  assert.equal(fmtDue('2026-10-16T06:59:00Z', NOW), '周四 23:59');
  assert.equal(fmtDue('2026-10-21T06:59:00Z', NOW), '10月20日 周二 23:59');
  assert.equal(fmtDue('2026-11-02T07:59:00Z', NOW), '11月1日 周日 23:59');
  assert.equal(fmtDue('2027-01-06T07:59:00Z', NOW), '2027年1月5日 周二 23:59');
  assert.equal(fmtDue(null, NOW), '无截止日期');
});

test('fmtCountdown only speaks up near or past the deadline', () => {
  assert.equal(fmtCountdown('2026-10-12T22:00:00Z', NOW), '还剩 5 小时');
  assert.equal(fmtCountdown('2026-10-12T17:30:00Z', NOW), '还剩 30 分钟');
  assert.equal(fmtCountdown('2026-10-14T16:00:00Z', NOW), '还剩 47 小时');
  assert.equal(fmtCountdown('2026-10-15T17:00:00Z', NOW), null);
  assert.equal(fmtCountdown('2026-10-12T14:00:00Z', NOW), '已逾期 3 小时');
  assert.equal(fmtCountdown('2026-10-10T17:00:00Z', NOW), '已逾期 2 天');
  assert.equal(fmtCountdown(null, NOW), null);
});

test('fmtRelative for sync times', () => {
  assert.equal(fmtRelative('2026-10-12T16:59:40Z', NOW), '刚刚');
  assert.equal(fmtRelative('2026-10-12T16:55:00Z', NOW), '5 分钟前');
  assert.equal(fmtRelative('2026-10-12T14:00:00Z', NOW), '3 小时前');
  assert.equal(fmtRelative('2026-10-10T17:00:00Z', NOW), '2 天前');
  assert.equal(fmtRelative(null, NOW), '从未');
});

test('matchRoute handles params and optional segments', () => {
  assert.deepEqual(matchRoute('/courses/:id/:tab?', '/courses/alpha:1'), { id: 'alpha:1' });
  assert.deepEqual(matchRoute('/courses/:id/:tab?', '/courses/alpha%3A1/files'), { id: 'alpha:1', tab: 'files' });
  assert.equal(matchRoute('/courses/:id/:tab?', '/courses'), null);
  assert.equal(matchRoute('/courses/:id', '/courses/a/b'), null);
  assert.deepEqual(matchRoute('/', '/'), {});
  assert.equal(matchRoute('/', '/settings'), null);
});
