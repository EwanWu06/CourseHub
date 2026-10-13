// Deterministic task views shared by the API, the daily/weekly reports and notifications.
// Everything here comes straight from Canvas data — nothing is AI-generated.
import type { DB } from '../db/index.ts';
import { listCourses } from '../db/courses.ts';
import { listSchools } from '../db/schools.ts';
import type { ItemKind, ItemRow } from '../db/types.ts';
import { courseDisplayName } from '../util/course.ts';

export type TaskStatus = 'done' | 'todo' | 'overdue' | 'missing' | 'past' | 'event';

export interface TaskView {
  id: string; title: string; kind: ItemKind; provider: string; courseId: string | null; courseName: string | null;
  schoolId: string | null; schoolName: string | null; color: string; dueAt: string | null; htmlUrl: string | null;
  points: number | null; status: TaskStatus; estMinutes: number; source: 'api' | 'ics' | 'manual' | 'syllabus'; localDone: boolean;
  category: string | null; categorySource: string | null; syllabusNote: string | null;
  dueFromSyllabus: boolean; dueDateOnly: boolean;
}

const DONE_STATES = new Set(['submitted', 'graded', 'pending_review']);
const NOT_SUBMITTABLE = new Set(['none', 'on_paper', 'not_graded']);

function types(row: ItemRow): string[] {
  try {
    return row.submission_types ? (JSON.parse(row.submission_types) as string[]) : [];
  } catch {
    return [];
  }
}

export function taskStatus(row: ItemRow, now: Date): TaskStatus {
  if (row.kind === 'event') return 'event';
  if (row.local_done || row.canvas_done || row.excused || (row.sub_state && DONE_STATES.has(row.sub_state))) return 'done';
  if (row.missing) return 'missing';
  const due = row.due_at ?? row.syllabus_date;
  if (!due || Date.parse(due) > now.getTime()) return 'todo';
  if (row.category === 'exam') return 'past'; // exams are sat, not submitted
  // Past due and not done. Only call it overdue when Canvas would actually expect an online submission.
  const t = types(row);
  if (t.length > 0 && t.every((x) => NOT_SUBMITTABLE.has(x))) return 'past';
  if (row.kind === 'note' || row.kind === 'page') return 'past';
  if (row.sub_state === 'unknown') return 'past';
  if (row.provider !== 'canvas' && row.provider !== 'manual' && t.includes('external_tool')) return 'past'; // graded on the publisher's site
  return 'overdue';
}

export function isExamLike(title: string, category?: string | null): boolean {
  if (category) return category === 'exam';
  return /\b(exam|midterm|final|quiz)s?\b|考试|期中|期末|测验/i.test(title);
}

const BY_CATEGORY: Record<string, number> = { exam: 120, lab: 120, project: 150, reading: 25, survey: 10, participation: 0, discussion: 40, quiz: 45 };

export function estimateMinutes(row: ItemRow): number {
  if (row.kind === 'event' && row.category !== 'exam') return 0;
  if (row.category && row.category in BY_CATEGORY) return BY_CATEGORY[row.category];
  if (/\b(exam|midterm|final)\b|考试|期中|期末/i.test(row.title)) return 120;
  if (row.kind === 'quiz' && row.category !== 'homework') return 45;
  if (row.kind === 'discussion') return 40;
  if (row.kind === 'page') return 20;
  if (row.kind === 'note') return 30;
  if (row.points === null) return 60;
  if (row.points <= 10) return 45;
  if (row.points <= 50) return 90;
  return 150;
}

/** Builds TaskViews with course/school names and colors looked up once. */
export function makeTaskViewer(db: DB, now: Date): (row: ItemRow) => TaskView {
  const courses = new Map(listCourses(db, { includeHidden: true, activeOnly: false }).map((c) => [c.id, c]));
  const schools = new Map(listSchools(db).map((s) => [s.id, s]));
  return (row) => {
    const course = row.course_id ? courses.get(row.course_id) : undefined;
    const school = row.school_id ? schools.get(row.school_id) : undefined;
    return {
      id: row.id, title: row.title, kind: row.kind, provider: row.provider, courseId: course?.id ?? null,
      courseName: course ? courseDisplayName(course) : null, schoolId: school?.id ?? null,
      schoolName: school?.name ?? null, color: course?.color ?? school?.color ?? '#64748b', dueAt: row.due_at ?? row.syllabus_date, htmlUrl: row.html_url,
      points: row.points, status: taskStatus(row, now), estMinutes: estimateMinutes(row), source: row.source, localDone: !!row.local_done,
      category: row.category ?? null, categorySource: row.category_source ?? null, syllabusNote: row.syllabus_note ?? null,
      dueFromSyllabus: !row.due_at && !!row.syllabus_date, dueDateOnly: !row.due_at && !!row.syllabus_date && !row.syllabus_time_known,
    };
  };
}

export function toTaskView(db: DB, row: ItemRow, now: Date): TaskView {
  return makeTaskViewer(db, now)(row);
}
