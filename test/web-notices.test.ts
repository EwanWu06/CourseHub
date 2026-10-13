import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLabel, noticeTarget } from '../web/src/lib/notices.ts';

test('a notice link opens inside the app when it points at Course Hub, otherwise in Canvas', () => {
  assert.deepEqual(noticeTarget('http://127.0.0.1:4123/reports/daily:2026-10-12'), { internal: '/reports/daily:2026-10-12' });
  assert.deepEqual(noticeTarget('http://127.0.0.1:4123/'), { internal: '/' });
  assert.deepEqual(noticeTarget('https://ilearn.laccd.edu/courses/1'), { external: 'https://ilearn.laccd.edu/courses/1' });
  assert.equal(noticeTarget(null), null);
  assert.equal(noticeTarget('javascript:alert(1)'), null);
});

test('notices are headed by their local day', () => {
  const now = new Date('2026-10-12T19:00:00-07:00');
  assert.equal(dayLabel('2026-10-13T01:00:00Z', now), '今天');
  assert.equal(dayLabel('2026-10-11T20:00:00Z', now), '昨天');
  assert.equal(dayLabel('2026-10-09T20:00:00Z', now), '10月9日 周五');
});
