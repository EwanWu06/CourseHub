import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appleScriptString, notify, setNotifier, loginNeededNotice } from '../src/notify/mac.ts';
import type { Notice } from '../src/notify/mac.ts';

test('appleScriptString escapes quotes and backslashes', () => {
  assert.equal(appleScriptString('He said "hi" \\ bye'), '"He said \\"hi\\" \\\\ bye"');
});

test('notifications go through the injected notifier, in order', async () => {
  const seen: Notice[] = [];
  setNotifier(async (n) => { seen.push(n); });
  await Promise.all([notify({ title: 'a', body: '1' }), notify({ title: 'b', body: '2' })]);
  assert.deepEqual(seen.map((n) => n.title), ['a', 'b']);
  setNotifier(null);
});

test('login-needed notice names the school and links to settings', () => {
  const n = loginNeededNotice({ name: 'LACCD' });
  assert.match(n.title, /LACCD/);
  assert.match(n.url!, /\/settings$/);
});
