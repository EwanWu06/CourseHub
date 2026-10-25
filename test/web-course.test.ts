import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moduleWeekLabel, fileStatus, itemTypeIcon } from '../web/src/lib/course.ts';

test('moduleWeekLabel', () => {
  assert.equal(moduleWeekLabel({ week_start: 6, week_end: 6 }), '第 6 周');
  assert.equal(moduleWeekLabel({ week_start: 3, week_end: 4 }), '第 3–4 周');
  assert.equal(moduleWeekLabel({ week_start: null, week_end: null }), null);
});

test('fileStatus explains what the AI can read', () => {
  assert.deepEqual(fileStatus('ok', null), { label: '已读取文字', tone: 'ok' });
  assert.deepEqual(fileStatus('empty', null), { label: '扫描版 / 无文字', tone: 'warn' });
  assert.deepEqual(fileStatus('pending', '文件暂未开放，开放后会自动读取'), { label: '暂未开放', tone: undefined });
  assert.deepEqual(fileStatus('pending', null), { label: '等待读取', tone: undefined });
  assert.deepEqual(fileStatus('unsupported', null), { label: '不支持', tone: undefined });
  assert.deepEqual(fileStatus('skipped', null), { label: '太大，跳过', tone: undefined });
  assert.deepEqual(fileStatus('failed', 'x'), { label: '读取失败', tone: 'bad' });
});

test('itemTypeIcon covers Canvas module item types', () => {
  for (const t of ['File', 'Page', 'Assignment', 'Quiz', 'Discussion', 'ExternalUrl', 'ExternalTool', 'SubHeader']) assert.ok(itemTypeIcon(t));
  assert.equal(itemTypeIcon('Unknown'), 'dot');
});

test('an unknown course tab falls back to the overview', async () => {
  const { courseTab } = await import('../web/src/lib/course.ts');
  assert.equal(courseTab('files'), 'files');
  assert.equal(courseTab('syllabus'), 'overview');
  assert.equal(courseTab(undefined), 'overview');
  assert.equal(courseTab('study'), 'overview', 'study has its own page');
});
