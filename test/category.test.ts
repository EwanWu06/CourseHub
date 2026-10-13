import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyItem } from '../src/sync/category.ts';
import type { GroupInfo } from '../src/sync/category.ts';

const g = (name: string, weight: number, count: number): GroupInfo => ({ name, weight, count });
const item = (title: string, kind = 'assignment', extra: Partial<{ submission_types: string[] }> = {}) => ({ title, kind, submission_types: extra.submission_types ?? ['online_upload'] });

test('real CHEM 102 groups (LACCD) map to the right categories', () => {
  assert.equal(classifyItem(item('Knowledge Check 1'), g('Knowledge Checks', 25, 4)).category, 'exam');
  assert.equal(classifyItem(item('Final Hurrah'), g('Final Hurrah', 20, 1)).category, 'exam');
  assert.equal(classifyItem(item('Chapter 15 Homework', 'quiz', { submission_types: ['external_tool'] }), g('Homework', 10, 9)).category, 'homework');
  assert.equal(classifyItem(item('Faster Reaction or More Product? - Initial Response Due Thursday', 'discussion'), g('Homework', 10, 9)).category, 'discussion');
  assert.equal(classifyItem(item('15.2 The Rate of a Chemical Reaction', 'assignment', { submission_types: ['external_tool'] }), g('Lecture Videos', 10, 50)).category, 'reading');
  assert.equal(classifyItem(item('Exp #24: A Rate Law and Activation Energy', 'quiz'), g('Lab', 25, 5)).category, 'lab');
  assert.equal(classifyItem(item('Chapter 15 Reflection', 'assignment', { submission_types: ['none'] }), g('Chapter Reflections', 10, 2)).category, 'quiz');
});

test('explicit exam words win; big groups are not mistaken for exams', () => {
  assert.equal(classifyItem(item('Midterm Exam'), null).category, 'exam');
  assert.equal(classifyItem(item('Unit 2 Test'), g('Tests', 30, 3)).category, 'exam');
  assert.equal(classifyItem(item('Essay 1 Draft'), g('Essays', 40, 3)).category, 'project');
  assert.equal(classifyItem(item('Research Paper'), g('Research Paper', 20, 1)).category, 'project');
  assert.equal(classifyItem(item('Quiz 3', 'quiz'), g('Quizzes', 15, 10)).category, 'quiz');
  assert.equal(classifyItem(item('HW 4'), g('Assignments', 40, 12)).category, 'homework');
});

test('without groups, titles and Canvas kinds decide', () => {
  assert.equal(classifyItem(item('Getting to Know You Survey', 'quiz'), null).category, 'survey');
  assert.equal(classifyItem(item('Lab Report 3'), null).category, 'lab');
  assert.equal(classifyItem(item('Reading Quiz 6', 'quiz'), null).category, 'quiz');
  assert.equal(classifyItem(item('Discussion: Ethics', 'discussion'), null).category, 'discussion');
  assert.equal(classifyItem(item('Homework 6: Cell Respiration'), null).category, 'homework');
  assert.equal(classifyItem(item('Week 7 Overview', 'page'), null).category, 'reading');
  assert.equal(classifyItem(item('Midterm Exam', 'event'), null).category, 'exam');
  assert.equal(classifyItem(item('Office hours', 'event'), null).category, 'other');
});

test('the reason names the evidence', () => {
  assert.match(classifyItem(item('Knowledge Check 1'), g('Knowledge Checks', 25, 4)).source, /group/);
  assert.equal(classifyItem(item('Midterm Exam'), null).source, 'title');
});

test('personal planner notes are never exams even if they mention one', () => {
  assert.equal(classifyItem(item('Study group for BIO midterm', 'note'), null).category, 'other');
});
