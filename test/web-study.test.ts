import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSources, pagesLabel } from '../web/src/lib/study.ts';

test('sources are grouped per material with sorted, unique pages', () => {
  const groups = groupSources([
    { material_id: 'f:19', page: 31 }, { material_id: 'f:19', page: 28 }, { material_id: 'p:intro', page: null },
    { material_id: 'f:19', page: 28 }, { material_id: 'f:18', page: 5 },
  ]);
  assert.deepEqual(groups, [
    { material_id: 'f:19', pages: [28, 31] },
    { material_id: 'p:intro', pages: [] },
    { material_id: 'f:18', pages: [5] },
  ]);
});

test('page lists read naturally and collapse runs', () => {
  assert.equal(pagesLabel([]), '');
  assert.equal(pagesLabel([5]), '第 5 页');
  assert.equal(pagesLabel([28, 30, 31, 32, 36]), '第 28、30–32、36 页');
});
