import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lunarDate, lunarDayName, zhMonth } from '../web/src/lib/almanac.ts';

test('months are written in Chinese numerals the way an almanac prints them', () => {
  assert.equal(zhMonth(1), '一月');
  assert.equal(zhMonth(10), '十月');
  assert.equal(zhMonth(11), '十一月');
  assert.equal(zhMonth(12), '十二月');
});

test('lunar day names: 初一 … 初十, 十一 … 十九, 二十, 廿一 … 廿九, 三十', () => {
  assert.deepEqual([1, 5, 10, 11, 15, 19, 20, 21, 29, 30].map(lunarDayName), ['初一', '初五', '初十', '十一', '十五', '十九', '二十', '廿一', '廿九', '三十']);
});

test('the lunar date of a day, year name included', () => {
  assert.equal(lunarDate(new Date('2026-10-24T20:00:00-07:00')), '丙午年 九月十五');
  assert.equal(lunarDate(new Date('2026-02-17T12:00:00-08:00')), '丙午年 正月初一', 'the 2026 lunar new year');
});
