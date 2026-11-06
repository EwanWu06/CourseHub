import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupBlocks, periodLabel, planMinutes, workloadWidth } from '../web/src/lib/reports.ts';

test('report periods read as a day or a Monday–Sunday range', () => {
  assert.equal(periodLabel('daily', '2026-11-01'), '11月1日 周日');
  assert.equal(periodLabel('weekly', '2026-11-02'), '11月2日 – 11月8日');
  assert.equal(periodLabel('weekly', '2026-12-28'), '12月28日 – 1月3日');
});

test('plan blocks are grouped morning → afternoon → evening, empty slots left out', () => {
  const blocks = [
    { slot: '晚上' as const, title: '复习', minutes: 60 },
    { slot: '上午' as const, title: '写 HW', minutes: 45, item_id: 'a' },
    { slot: '晚上' as const, title: '读 slides', minutes: 30 },
  ];
  assert.deepEqual(groupBlocks(blocks).map((g) => [g.slot, g.blocks.map((b) => b.title)]), [['上午', ['写 HW']], ['晚上', ['复习', '读 slides']]]);
  assert.equal(planMinutes(blocks), 135);
});

test('workload bars are relative to the busiest day, with a visible minimum', () => {
  assert.equal(workloadWidth(0, 300), 0);
  assert.equal(workloadWidth(300, 300), 100);
  assert.equal(workloadWidth(150, 300), 50);
  assert.equal(workloadWidth(5, 300), 4);
  assert.equal(workloadWidth(10, 0), 0);
});
