import { test } from 'node:test';
import assert from 'node:assert/strict';
import { taskStatus, estimateMinutes, isExamLike } from '../src/reports/data.ts';
import type { ItemRow } from '../src/db/types.ts';

const NOW = new Date('2026-10-12T17:00:00Z'); // Mon 10:00 PDT
const past = '2026-10-10T06:59:00Z';
const future = '2026-10-14T06:59:00Z';

function row(p: Partial<ItemRow>): ItemRow {
  return {
    id: 'x', school_id: 's', course_id: 'c', kind: 'assignment', title: 'HW', due_at: future, end_at: null, unlock_at: null,
    lock_at: null, points: 10, html_url: null, provider: 'canvas', description_html: null, submission_types: '["online_upload"]',
    sub_state: 'unsubmitted', submitted_at: null, missing: 0, late: 0, excused: 0, score: null, grade: null, canvas_done: 0,
    local_done: 0, source: 'api', module_id: null, first_seen_at: '', updated_at: '', removed: 0,
    group_id: null, category: null, category_source: null, syllabus_date: null, syllabus_note: null, syllabus_time_known: 0, ...p,
  };
}

test('taskStatus: done when submitted, graded, excused or ticked off anywhere', () => {
  assert.equal(taskStatus(row({ sub_state: 'submitted', due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ sub_state: 'graded' }), NOW), 'done');
  assert.equal(taskStatus(row({ sub_state: 'pending_review' }), NOW), 'done');
  assert.equal(taskStatus(row({ excused: 1, due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ canvas_done: 1, due_at: past }), NOW), 'done');
  assert.equal(taskStatus(row({ local_done: 1, due_at: past }), NOW), 'done');
});

test('taskStatus: missing, overdue, todo', () => {
  assert.equal(taskStatus(row({ missing: 1, due_at: past }), NOW), 'missing');
  assert.equal(taskStatus(row({ due_at: past }), NOW), 'overdue');
  assert.equal(taskStatus(row({ due_at: future }), NOW), 'todo');
  assert.equal(taskStatus(row({ due_at: null }), NOW), 'todo');
  assert.equal(taskStatus(row({ kind: 'manual', provider: 'manual', source: 'manual', sub_state: null, submission_types: null, due_at: past }), NOW), 'overdue');
});

test('taskStatus: things that cannot be submitted online become past, not overdue', () => {
  assert.equal(taskStatus(row({ submission_types: '["on_paper"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ submission_types: '["none"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ kind: 'quiz', submission_types: '["not_graded"]', sub_state: null, due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ sub_state: 'unknown', source: 'ics', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ kind: 'note', submission_types: '["not_graded"]', sub_state: null, due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ provider: 'macmillan', submission_types: '["external_tool"]', due_at: past }), NOW), 'past');
  assert.equal(taskStatus(row({ provider: 'macmillan', submission_types: '["external_tool"]', due_at: past, missing: 1 }), NOW), 'missing');
});

test('taskStatus: calendar events are events', () => {
  assert.equal(taskStatus(row({ kind: 'event', sub_state: null, submission_types: null }), NOW), 'event');
});

test('estimateMinutes and isExamLike', () => {
  assert.equal(estimateMinutes(row({ kind: 'quiz' })), 45);
  assert.equal(estimateMinutes(row({ kind: 'discussion' })), 40);
  assert.equal(estimateMinutes(row({ points: 10 })), 45);
  assert.equal(estimateMinutes(row({ points: 50 })), 90);
  assert.equal(estimateMinutes(row({ points: 100 })), 150);
  assert.equal(estimateMinutes(row({ points: null })), 60);
  assert.equal(estimateMinutes(row({ kind: 'event' })), 0);
  assert.equal(estimateMinutes(row({ title: 'Midterm Exam 1', points: 100 })), 120);
  assert.ok(isExamLike('Midterm Exam'));
  assert.ok(isExamLike('Final'));
  assert.ok(isExamLike('Quiz 3'));
  assert.ok(isExamLike('期中考试'));
  assert.ok(!isExamLike('Homework 3'));
});

test('estimateMinutes follows the real category when known', () => {
  assert.equal(estimateMinutes(row({ category: 'exam', title: 'Knowledge Check 1', points: 100 })), 120);
  assert.equal(estimateMinutes(row({ category: 'lab', title: 'Exp #24' })), 120);
  assert.equal(estimateMinutes(row({ category: 'project', title: 'Research Paper' })), 150);
  assert.equal(estimateMinutes(row({ category: 'reading', title: '15.2 The Rate of a Chemical Reaction', points: 2 })), 25);
  assert.equal(estimateMinutes(row({ category: 'survey', title: 'Getting to Know You Survey' })), 10);
  assert.equal(estimateMinutes(row({ category: 'homework', kind: 'quiz', title: 'Chapter 15 Homework', points: 102 })), 150);
});

test('isExamLike also trusts the category', () => {
  assert.ok(isExamLike('Knowledge Check 1', 'exam'));
  assert.ok(!isExamLike('Chapter 15 Homework', 'homework'));
});
