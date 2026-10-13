import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseDisplayName } from '../src/util/course.ts';

const c = (name: string, code: string | null = null, nickname: string | null = null) => ({ name, code, nickname });

test('real-world course names shrink to the subject + number', () => {
  assert.equal(courseDisplayName(c('2026 Fall - ENGL C1000 (2074) [1..8] - Bonar - (O)', 'SMC 2026 Fall - ENGL C1000 (2074) - Academic Reading and Writing  (O)')), 'ENGL C1000');
  assert.equal(courseDisplayName(c('409680: Cell and Molecular Biology LIFESCI XL 7A (Fall 2026)', '409680')), 'LIFESCI XL 7A');
  assert.equal(courseDisplayName(c('410199: Linear Algebra MATH XL 33A (Fall 2026)', '410199')), 'MATH XL 33A');
  assert.equal(courseDisplayName(c('410633: Policy Training for Continuing Education Students GENINT 750.1 (Fall 2026)', '410633')), 'GENINT 750.1');
});

test('simple codes, nicknames and fallbacks', () => {
  assert.equal(courseDisplayName(c('BIO 3 - General Biology', 'BIO 3')), 'BIO 3');
  assert.equal(courseDisplayName(c('PSYCH 1 - Intro to Psychology', 'PSYCH 1')), 'PSYCH 1');
  assert.equal(courseDisplayName(c('BIO 3 - General Biology', 'BIO 3', '生物')), '生物');
  assert.equal(courseDisplayName(c('Writing Workshop', null)), 'Writing Workshop');
  assert.equal(courseDisplayName(c('A very long course title without any recognizable code in it at all', 'X')), 'X');
});
