// Deterministic task views shared by the API, the daily/weekly reports and notifications.
// Everything here comes straight from Canvas data — nothing is AI-generated.
import type { DB } from '../db/index.ts';
import { changesSince } from '../db/changes.ts';
import { listCourses } from '../db/courses.ts';
import { getItem, listItems, listUndated } from '../db/items.ts';
import { allItemLogic } from '../db/logic.ts';
import { remainingText, unmetParts } from '../logic/types.ts';
import type { ItemLogic, LogicNote, LogicPart } from '../logic/types.ts';
import { listSchools } from '../db/schools.ts';
import { all, one } from '../db/sql.ts';
import { getGuide, listWeeks } from '../db/study.ts';
import type { ItemKind, ItemRow } from '../db/types.ts';
import { courseDisplayName } from '../util/course.ts';
import { addDays, atLocal, localDateStr, mondayOf } from '../util/time.ts';
import { weekOf } from '../weeks/infer.ts';
import { currentWeek, lastWeek } from '../weeks/build.ts';

export type TaskStatus = 'done' | 'todo' | 'overdue' | 'missing' | 'past' | 'event';

export interface TaskView {
  id: string; title: string; kind: ItemKind; provider: string; courseId: string | null; courseName: string | null;
  schoolId: string | null; schoolName: string | null; color: string; dueAt: string | null; htmlUrl: string | null;
  points: number | null; status: TaskStatus; estMinutes: number; source: 'api' | 'ics' | 'manual' | 'syllabus'; localDone: boolean;
  category: string | null; categorySource: string | null; syllabusNote: string | null;
  dueFromSyllabus: boolean; dueDateOnly: boolean; note: string | null;
  /** no due date in Canvas: dueAt is when the work closes ("available until") */
  dueIsClose: boolean;
  /** what full credit takes (posts, replies, peer reviews) and rules worth knowing; null = nothing beyond handing it in */
  requirements: { parts: LogicPart[]; notes: LogicNote[] } | null;
  /** "还差 1 条回复": the counted steps still missing */
  remaining: string | null;
  /** why the deadline is this one (a peer review following the teacher's review column, a first-post date from the instructions) */
  dueNote: string | null;
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

const CLOSING_KINDS = new Set(['assignment', 'quiz', 'discussion']);

/** Due only in the sense that it closes: no Canvas due date and no syllabus date, but an "available until". */
export function closesOnly(row: Pick<ItemRow, 'due_at' | 'syllabus_date' | 'lock_at' | 'kind'>): boolean {
  return !row.due_at && !row.syllabus_date && !!row.lock_at && CLOSING_KINDS.has(row.kind);
}

/** Same rule as EFFECTIVE_DUE_SQL. */
export function effectiveDue(row: Pick<ItemRow, 'due_at' | 'syllabus_date' | 'lock_at' | 'kind'>): string | null {
  return row.due_at ?? row.syllabus_date ?? (closesOnly(row) ? row.lock_at : null);
}

/** Nothing is handed in through Canvas: no submission, on paper, or not graded. */
export function nothingToHandIn(row: Pick<ItemRow, 'submission_types'>): boolean {
  const t = types(row as ItemRow);
  return t.length > 0 && t.every((x) => NOT_SUBMITTABLE.has(x));
}

/** A "No Submission" column without a date (Achieve/iClicker grade sync, attendance): a grade, not a to-do. */
export function isGradeColumn(row: Pick<ItemRow, 'submission_types' | 'due_at' | 'syllabus_date' | 'lock_at' | 'kind'>): boolean {
  if (effectiveDue(row)) return false;
  const t = types(row as ItemRow);
  return t.length > 0 && t.every((x) => x === 'none');
}

/**
 * Done means everything the task asks for: Canvas says "submitted" after a discussion's first post, but while
 * counted steps (replies, peer reviews) are missing it stays open. Excused or ticked off by the student (here or in
 * Canvas's planner) is done regardless; graded is done unless Canvas calls it missing — a missing-submission policy
 * grades work nobody handed in — or a module's minimum score isn't met.
 */
export function taskStatus(row: ItemRow, now: Date, logic?: ItemLogic | null): TaskStatus {
  if (row.kind === 'event') return 'event';
  const unmet = unmetParts(logic);
  if (row.local_done || row.canvas_done || row.excused) return 'done';
  if (row.missing) return 'missing';
  if (row.sub_state === 'graded' && !unmet.some((p) => p.kind === 'score')) return 'done';
  const short = unmet.length > 0;
  const counted = (logic?.parts ?? []).some((p) => p.done !== null);
  if (!short && ((row.sub_state && DONE_STATES.has(row.sub_state)) || counted)) return 'done';
  const due = logic?.due?.at ?? effectiveDue(row);
  if (!due || Date.parse(due) > now.getTime()) return 'todo';
  if (closesOnly(row)) return 'past'; // it closed: nothing can be handed in any more
  if (row.category === 'exam') return 'past'; // exams are sat, not submitted
  if (short) return 'overdue'; // replies / peer reviews still owed: Canvas usually still takes them
  // Past due and not done. Only call it overdue when Canvas would actually expect an online submission.
  if (nothingToHandIn(row)) return 'past';
  if (row.kind === 'note' || row.kind === 'page') return 'past';
  const t = types(row);
  if (row.sub_state === 'unknown') return 'past';
  if (row.provider !== 'canvas' && row.provider !== 'manual' && t.includes('external_tool')) return 'past'; // graded on the publisher's site
  return 'overdue';
}

export function isExamLike(title: string, category?: string | null): boolean {
  if (category) return category === 'exam';
  return /\b(exam|midterm|final|quiz)s?\b|考试|期中|期末|测验/i.test(title);
}

const BY_CATEGORY: Record<string, number> = { exam: 120, lab: 120, project: 150, reading: 25, survey: 10, participation: 0, discussion: 40, quiz: 45, review: 30 };

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

/** To-dos with no date of any kind (not grade columns, not done, not calendar events). */
export function undatedTasks(db: DB, now: Date, courseId?: string): TaskView[] {
  const view = makeTaskViewer(db, now);
  return listUndated(db, courseId).filter((r) => !isGradeColumn(r)).map(view).filter((t) => t.status !== 'done' && t.kind !== 'event');
}

/** Builds TaskViews with course/school names and colors looked up once. */
export function makeTaskViewer(db: DB, now: Date): (row: ItemRow) => TaskView {
  const courses = new Map(listCourses(db, { includeHidden: true, activeOnly: false }).map((c) => [c.id, c]));
  const schools = new Map(listSchools(db).map((s) => [s.id, s]));
  const logic = allItemLogic(db);
  return (row) => {
    const course = row.course_id ? courses.get(row.course_id) : undefined;
    const school = row.school_id ? schools.get(row.school_id) : undefined;
    const l = logic.get(row.id) ?? null;
    return {
      id: row.id, title: row.title, kind: row.kind, provider: row.provider, courseId: course?.id ?? null,
      courseName: course ? courseDisplayName(course) : null, schoolId: school?.id ?? null,
      schoolName: school?.name ?? null, color: course?.color ?? school?.color ?? '#64748b', dueAt: l?.due?.at ?? effectiveDue(row), htmlUrl: row.html_url,
      points: row.points, status: taskStatus(row, now, l), estMinutes: estimateMinutes(row), source: row.source, localDone: !!row.local_done,
      category: row.category ?? null, categorySource: row.category_source ?? null, syllabusNote: row.syllabus_note ?? null,
      dueFromSyllabus: !row.due_at && !!row.syllabus_date, dueDateOnly: !row.due_at && !!row.syllabus_date && !row.syllabus_time_known,
      note: row.user_note ?? null, dueIsClose: !l?.due?.at && closesOnly(row),
      requirements: l && (l.parts.length || l.notes.length) ? { parts: l.parts, notes: l.notes } : null,
      remaining: remainingText(l), dueNote: l?.due?.note ?? null,
    };
  };
}

export function toTaskView(db: DB, row: ItemRow, now: Date): TaskView {
  return makeTaskViewer(db, now)(row);
}

// ---- Daily and weekly report data ----

const DAY = 86_400_000;

export interface DailyData {
  date: string;
  overdue: TaskView[]; dueToday: TaskView[]; next3Days: TaskView[]; laterThisWeek: TaskView[]; eventsToday: TaskView[];
  examsSoon: TaskView[];
  announcements: { id: string; courseName: string; title: string; postedAt: string; htmlUrl: string }[];
  grades: { itemId: string; title: string; courseName: string; score: number | null; points: number | null }[];
  dueChanges: { itemId: string; title: string; courseName: string; from: string | null; to: string | null }[];
  loginNeeded: { schoolId: string; name: string }[];
  studyFocus: { courseId: string; courseName: string; week: number; overview: string | null; status: string | null }[];
  totals: { todo: number; minutes: number };
}

export interface WeeklyData {
  weekStart: string; weekEnd: string;
  last: { onTime: number; late: number; missing: number; graded: { title: string; courseName: string; score: number | null; points: number | null }[] };
  next: {
    days: { date: string; items: TaskView[]; minutes: number }[];
    exams: TaskView[];
    topics: { courseId: string; courseName: string; week: number; title: string | null; topics: string[]; overview: string | null }[];
  };
  busiest: string | null;
}

const midnight = (date: string) => atLocal(date, 0, 0).getTime();
const open = (t: TaskView) => t.status === 'todo' || t.status === 'overdue' || t.status === 'missing';
const dueIn = (from: number, to: number) => (t: TaskView) => {
  const x = Date.parse(t.dueAt!);
  return x >= from && x < to;
};
const minutesOf = (ts: TaskView[]) => ts.reduce((n, t) => n + t.estMinutes, 0);

/** "What's new" starts at the previous day's report (an earlier run today doesn't count), else 24 hours ago. */
function dailySince(db: DB, now: Date): string {
  const prev = one<{ created_at: string }>(db, `SELECT created_at FROM reports WHERE type = 'daily' AND period < $today
      ORDER BY period DESC, created_at DESC LIMIT 1`, { today: localDateStr(now) });
  return prev?.created_at ?? new Date(now.getTime() - DAY).toISOString();
}

function guideOverview(db: DB, courseId: string, week: number): { overview: string | null; status: string | null } {
  const g = getGuide(db, courseId, week);
  if (!g) return { overview: null, status: null };
  let overview: string | null = null;
  if (g.status === 'ready' && g.content) {
    try {
      overview = (JSON.parse(g.content) as { overview?: string }).overview ?? null;
    } catch {
      overview = null;
    }
  }
  return { overview, status: g.status };
}

/** Grade and due-date changes since `since`, for visible courses, one entry per item (latest wins; due keeps the first "from"). */
function itemChanges(db: DB, since: string, until: string | null) {
  const visible = new Map(listCourses(db).map((c) => [c.id, courseDisplayName(c)]));
  const grades = new Map<string, DailyData['grades'][number]>();
  const dues = new Map<string, DailyData['dueChanges'][number]>();
  for (const ch of changesSince(db, since)) {
    if (until && ch.created_at >= until) continue;
    if (ch.course_id && !visible.has(ch.course_id)) continue;
    const item = getItem(db, ch.ref_id);
    const title = item?.title ?? ch.summary;
    const courseName = (ch.course_id && visible.get(ch.course_id)) || '';
    let data: { score?: number | null; points?: number | null; from?: string | null; to?: string | null } = {};
    try {
      data = JSON.parse(ch.data) as typeof data;
    } catch {
      data = {};
    }
    if (ch.kind === 'graded') {
      grades.set(ch.ref_id, { itemId: ch.ref_id, title, courseName, score: data.score ?? item?.score ?? null, points: data.points ?? item?.points ?? null });
    } else if (ch.kind === 'due_changed') {
      const earlier = dues.get(ch.ref_id);
      dues.set(ch.ref_id, { itemId: ch.ref_id, title, courseName, from: earlier ? earlier.from : data.from ?? null, to: data.to ?? null });
    }
  }
  return { grades: [...grades.values()], dueChanges: [...dues.values()] };
}

export function computeDaily(db: DB, now: Date): DailyData {
  const view = makeTaskViewer(db, now);
  const today = localDateStr(now);
  const t0 = midnight(today);
  const t1 = midnight(addDays(today, 1));
  const t4 = midnight(addDays(today, 4));
  const tWeek = midnight(addDays(mondayOf(today), 7));
  const tasks = listItems(db, { from: new Date(now.getTime() - 30 * DAY).toISOString(), to: new Date(Math.max(t4, tWeek)).toISOString() }).map(view);
  const work = tasks.filter((t) => t.status !== 'event');

  const overdue = work.filter((t) => Date.parse(t.dueAt!) < t0 && (t.status === 'overdue' || t.status === 'missing'));
  const dueToday = work.filter(dueIn(t0, t1)).filter(open);
  const next3Days = work.filter(dueIn(t1, t4)).filter(open);
  const laterThisWeek = work.filter(dueIn(t4, tWeek)).filter(open);
  const eventsToday = tasks.filter((t) => t.status === 'event').filter(dueIn(t0, t1));
  const examsSoon = listItems(db, { from: now.toISOString(), to: new Date(now.getTime() + 14 * DAY).toISOString() })
    .map(view).filter((t) => isExamLike(t.title, t.category) && t.status !== 'done');

  const since = dailySince(db, now);
  const announcements = all<{ id: string; title: string; posted: string; html_url: string; name: string; code: string | null; nickname: string | null }>(db, `
      SELECT t.id, t.title, COALESCE(t.posted_at, t.first_seen_at) AS posted, t.html_url, c.name, c.code, c.nickname
      FROM topics t JOIN courses c ON c.id = t.course_id
      WHERE t.kind = 'announcement' AND c.hidden = 0 AND c.active = 1 AND COALESCE(t.posted_at, t.first_seen_at) >= $since
      ORDER BY posted DESC LIMIT 20`, { since })
    .map((a) => ({ id: a.id, courseName: courseDisplayName(a), title: a.title, postedAt: a.posted, htmlUrl: a.html_url }));

  const studyFocus: DailyData['studyFocus'] = [];
  for (const c of listCourses(db)) {
    const week = currentWeek(db, c.id, now);
    const last = lastWeek(db, c.id);
    if (week === null || last === null || week < 1 || week > last) continue;
    studyFocus.push({ courseId: c.id, courseName: courseDisplayName(c), week, ...guideOverview(db, c.id, week) });
  }

  const todo = [...overdue, ...dueToday, ...next3Days, ...laterThisWeek];
  return {
    date: today, overdue, dueToday, next3Days, laterThisWeek, eventsToday, examsSoon, announcements,
    ...itemChanges(db, since, null),
    loginNeeded: listSchools(db).filter((s) => s.status === 'needs_login').map((s) => ({ schoolId: s.id, name: s.name })),
    studyFocus,
    totals: { todo: todo.length, minutes: minutesOf(todo) },
  };
}

/** The Monday a weekly report made now is about: on Sunday the coming week, any other day the current one. */
export function weeklyPeriod(now: Date): string {
  const today = localDateStr(now);
  const monday = mondayOf(today);
  return today === addDays(monday, 6) ? addDays(monday, 7) : monday;
}

export function computeWeekly(db: DB, now: Date): WeeklyData {
  const view = makeTaskViewer(db, now);
  const weekStart = weeklyPeriod(now);
  const weekEnd = addDays(weekStart, 6);
  const lastStart = addDays(weekStart, -7);

  const rows = listItems(db, { from: new Date(midnight(weekStart)).toISOString(), to: new Date(midnight(addDays(weekStart, 7))).toISOString() }).map(view);
  const relevant = rows.filter((t) => t.status !== 'done' && (t.status !== 'event' || isExamLike(t.title, t.category)));
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((date) => {
    const items = relevant.filter(dueIn(midnight(date), midnight(addDays(date, 1))));
    return { date, items, minutes: minutesOf(items) };
  });
  const exams = relevant.filter((t) => isExamLike(t.title, t.category));
  const max = Math.max(0, ...days.map((d) => d.minutes));
  const busiest = max > 0 ? days.find((d) => d.minutes === max)!.date : null;

  const lastItems = listItems(db, { from: new Date(midnight(lastStart)).toISOString(), to: new Date(midnight(weekStart)).toISOString() })
    .filter((r) => r.kind !== 'event' && r.kind !== 'note').map((r) => ({ row: r, view: view(r) }));
  const graded = itemChanges(db, new Date(midnight(lastStart)).toISOString(), new Date(midnight(weekStart)).toISOString()).grades
    .map(({ title, courseName, score, points }) => ({ title, courseName, score, points }));

  const topics: WeeklyData['next']['topics'] = [];
  for (const c of listCourses(db)) {
    if (!c.week1) continue;
    const week = weekOf(c.week1, atLocal(weekStart, 12, 0).toISOString());
    const row = listWeeks(db, c.id).find((w) => w.week === week);
    if (!row) continue;
    const entry = { courseId: c.id, courseName: courseDisplayName(c), week, title: row.title, topics: JSON.parse(row.topics) as string[], overview: guideOverview(db, c.id, week).overview };
    if (entry.title || entry.topics.length || entry.overview) topics.push(entry); // nothing known about that week → leave it out
  }

  return {
    weekStart, weekEnd,
    last: {
      onTime: lastItems.filter((x) => x.view.status === 'done' && !x.row.late).length,
      late: lastItems.filter((x) => x.view.status === 'done' && !!x.row.late).length,
      missing: lastItems.filter((x) => x.view.status === 'missing' || x.view.status === 'overdue').length,
      graded,
    },
    next: { days, exams, topics },
    busiest,
  };
}
