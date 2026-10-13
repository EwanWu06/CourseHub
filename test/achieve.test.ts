import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpDataDir } from './helpers.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getCourse, upsertCourse } from '../src/db/courses.ts';
import { upsertModule, upsertModuleItem } from '../src/db/content.ts';
import { achieveRows, findAchieveLaunch } from '../src/platforms/achieve.ts';
import type { AchieveData } from '../src/platforms/achieve.ts';

const UUID = '3de09d3e-5572-4b21-9c29-76961c25e2bc';
const LINK = (resource: string) => `https://lmslink.bfwpub.com/index.php?custom_action=openItem&custom_resource_id=${resource}&custom_template_root=&custom_course_id=${UUID}`;

function world() {
  tmpDataDir();
  const db = openDb();
  const s = createSchool(db, { name: 'UCLA Extension', base_url: 'https://my.uclaextension.edu' });
  for (const id of ['60417', '60992']) {
    upsertCourse(db, {
      id: `${s.id}:${id}`, school_id: s.id, canvas_id: id, name: `Course ${id}`, code: null, term_name: null, start_at: null, end_at: null,
      html_url: `https://my.uclaextension.edu/courses/${id}`, syllabus_html: null, tabs: null, current_score: null, current_grade: null, active: 1,
      updated_at: new Date().toISOString(),
    });
  }
  upsertModule(db, { id: `${s.id}:m:1`, course_id: `${s.id}:60417`, canvas_id: '1', name: 'Achieve eBook', position: 1, unlock_at: null });
  const item = (id: string, title: string, url: string) => upsertModuleItem(db, {
    id: `${s.id}:mi:${id}`, module_id: `${s.id}:m:1`, course_id: `${s.id}:60417`, title, type: 'ExternalTool', content_id: null, page_url: null,
    html_url: null, external_url: url, position: Number(id) % 10, indent: 0, ref_id: null,
  });
  item('3917459', 'Achieve E-book Link', LINK('mwtool_602'));
  item('3917458', 'Achieve Assignments Link', LINK('mwtool_600'));
  return { db, s: s.id, course: getCourse(db, `${s.id}:60417`)! };
}

const DATA: AchieveData = {
  items: [
    { id: 'r1', name: '7.3 Pyruvate Oxidation', tool: 'reading', points: null, dueDate: '2026-10-14T01:30:00.000Z', visibilityStartDate: '2026-09-22T07:00:00.000Z', gradebookCategoryName: 'Ungraded' },
    { id: 'q1', name: 'Pre-Class Review Questions 7.3-7.7 ', tool: 'assessment', points: 19, dueDate: '2026-10-14T01:30:00.000Z', visibilityStartDate: null, gradebookCategoryName: 'Week 4' },
    { id: 'p1', name: 'Week 3 Practice Exam Questions', tool: 'assessment', points: 5, dueDate: '2026-10-15T06:59:00.000Z', visibilityStartDate: null, gradebookCategoryName: 'PEQS (all weeks)' },
    { id: 'lc', name: 'Ch 17 Adaptive Quizzing', tool: 'learningcurve', points: null, dueDate: '2026-11-06T02:30:00.000Z', visibilityStartDate: null, gradebookCategoryName: 'Ungraded' },
    { id: 's1', name: 'Study Session 1: Learn and Practice', tool: 'mapi', points: null, dueDate: null, visibilityStartDate: null, gradebookCategoryName: 'Assignments' },
  ],
  statuses: { r1: 'Completed', q1: 'Completed', p1: '', lc: '', zz: 'Missed' },
};

test('the Achieve course behind a Canvas course is found from its launch link, the assignments link preferred', () => {
  const { db, s, course } = world();
  assert.deepEqual(findAchieveLaunch(db, course.id), { moduleItemId: '3917458', courseUuid: UUID, title: 'Achieve Assignments Link' });
  assert.equal(findAchieveLaunch(db, `${s}:60992`), null);
});

test('Achieve work becomes tasks with the real deadline, points and completion; undated study tools are not deadlines', () => {
  const { s, course } = world();
  const rows = achieveRows(s, course, '3917458', DATA);
  assert.deepEqual(rows.map((r) => r.row.id).sort(), [`${s}:ach:lc`, `${s}:ach:p1`, `${s}:ach:q1`, `${s}:ach:r1`]);
  const q1 = rows.find((r) => r.row.id === `${s}:ach:q1`)!;
  assert.equal(q1.row.title, 'Pre-Class Review Questions 7.3-7.7');
  assert.equal(q1.row.kind, 'assignment');
  assert.equal(q1.row.points, 19);
  assert.equal(q1.row.due_at, '2026-10-14T01:30:00.000Z');
  assert.equal(q1.row.sub_state, 'submitted');
  assert.equal(q1.row.provider, 'achieve');
  assert.equal(q1.row.course_id, course.id);
  assert.equal(q1.row.html_url, 'https://my.uclaextension.edu/courses/60417/modules/items/3917458'); // opens Achieve the way the student does
  assert.equal(q1.category, 'homework');
  const p1 = rows.find((r) => r.row.id === `${s}:ach:p1`)!;
  assert.equal(p1.row.sub_state, 'unsubmitted');
  assert.equal(p1.category, 'homework', 'practice exam questions are homework, not an exam');
  assert.equal(rows.find((r) => r.row.id === `${s}:ach:r1`)!.row.kind, 'page');
  assert.equal(rows.find((r) => r.row.id === `${s}:ach:r1`)!.category, 'reading');
  assert.equal(rows.find((r) => r.row.id === `${s}:ach:lc`)!.category, 'quiz');
  const missed = achieveRows(s, course, '3917458', { ...DATA, statuses: { ...DATA.statuses, p1: 'Missed' } }).find((r) => r.row.id === `${s}:ach:p1`)!;
  assert.equal(missed.row.missing, 1);
});
