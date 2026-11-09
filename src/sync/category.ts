// What an item really is (exam vs homework vs lab …). Canvas types are often misleading — a chapter homework
// submitted through a quiz, an exam that is a plain assignment — so we look at the assignment group first.
// Users can override (category_source 'user'); the AI syllabus pass may refine (category_source 'syllabus').

export type Category = 'exam' | 'quiz' | 'homework' | 'lab' | 'project' | 'discussion' | 'reading' | 'participation' | 'survey' | 'review' | 'other';
export const CATEGORIES: Category[] = ['exam', 'quiz', 'homework', 'lab', 'project', 'discussion', 'reading', 'participation', 'survey', 'review', 'other'];
/** What the syllabus pass may pick from (a peer review is known from Canvas, never guessed). */
export const SYLLABUS_CATEGORIES: Category[] = CATEGORIES.filter((c) => c !== 'review');

export interface GroupInfo { name: string; weight: number; count: number }
export interface Classified { category: Category; source: 'group' | 'group-shape' | 'title' | 'kind' }

const STRONG_EXAM = /\b(mid-?terms?|final exams?|exams?)\b|考试|期中|期末/i;

const GROUP_RULES: [RegExp, Category][] = [
  [/exam|midterm|final|\btests?\b|考试|期中|期末/i, 'exam'],
  [/quiz|测验|reflection/i, 'quiz'],
  [/\blabs?\b|experiment|实验/i, 'lab'],
  [/discussion|forum|讨论/i, 'discussion'],
  [/project|paper|essay|portfolio|presentation|论文|写作/i, 'project'],
  [/video|lecture|reading|textbook|阅读/i, 'reading'],
  [/participation|attendance|参与|出勤/i, 'participation'],
  [/survey/i, 'survey'],
  [/homework|\bhw\b|assignment|problem|worksheet|exercise|作业/i, 'homework'],
];

const TITLE_RULES: [RegExp, Category][] = [
  [/\btests?\b/i, 'exam'],
  [/survey|questionnaire/i, 'survey'],
  [/\b(labs?|experiment|exp\s*#?\s*\d+|pre-?lab)\b/i, 'lab'],
  [/\bquiz(zes)?\b|测验/i, 'quiz'],
  [/discussion|forum/i, 'discussion'],
  [/essay|paper|project|presentation|portfolio/i, 'project'],
  [/homework|\bhw\b|problem set|worksheet|exercise/i, 'homework'],
];

export function classifyItem(item: { title: string; kind: string; submission_types?: string[] | null }, group: GroupInfo | null): Classified {
  if (item.kind === 'note') return { category: 'other', source: 'kind' }; // the user's own planner notes
  if (item.kind === 'review') return { category: 'review', source: 'kind' }; // reviewing a classmate's "Midterm essay" is not an exam
  if (STRONG_EXAM.test(item.title)) return { category: 'exam', source: 'title' };
  if (item.kind === 'discussion') return { category: 'discussion', source: 'kind' };
  if (group) {
    for (const [re, category] of GROUP_RULES) if (re.test(group.name)) return { category, source: 'group' };
    // A heavy group with only a handful of items ("Knowledge Checks 25%, 4 items") is almost always exams.
    if (group.weight >= 15 && group.count > 0 && group.count <= 6) return { category: 'exam', source: 'group-shape' };
  }
  for (const [re, category] of TITLE_RULES) if (re.test(item.title)) return { category, source: 'title' };
  if (item.kind === 'event') return { category: 'other', source: 'kind' };
  if (item.kind === 'page') return { category: 'reading', source: 'kind' };
  if (item.kind === 'quiz') return { category: 'quiz', source: 'kind' };
  if (item.kind === 'note') return { category: 'other', source: 'kind' };
  return { category: 'homework', source: 'kind' };
}

import type { DB } from '../db/index.ts';
import { listAssignmentGroups } from '../db/content.ts';
import { setItemCategory } from '../db/items.ts';
import { all } from '../db/sql.ts';

/** (Re)classifies a school's items; never overrides the user's or the syllabus pass's decision. */
export function categorizeSchool(db: DB, schoolId: string): number {
  const groups = new Map<string, GroupInfo>();
  const courseIds = all<{ id: string }>(db, 'SELECT id FROM courses WHERE school_id = $schoolId', { schoolId }).map((c) => c.id);
  for (const courseId of courseIds) {
    for (const g of listAssignmentGroups(db, courseId)) groups.set(g.id, { name: g.name, weight: g.weight ?? 0, count: g.count });
  }
  let changed = 0;
  const rows = all<{ id: string; title: string; kind: string; submission_types: string | null; group_id: string | null; category: string | null; category_source: string | null }>(db,
    'SELECT id, title, kind, submission_types, group_id, category, category_source FROM items WHERE school_id = $schoolId AND removed = 0', { schoolId });
  for (const r of rows) {
    if (r.category_source === 'user' || r.category_source === 'syllabus' || r.category_source === 'platform') continue;
    let types: string[] = [];
    try {
      types = r.submission_types ? (JSON.parse(r.submission_types) as string[]) : [];
    } catch {
      types = [];
    }
    const { category, source } = classifyItem({ title: r.title, kind: r.kind, submission_types: types }, r.group_id ? groups.get(r.group_id) ?? null : null);
    if (category !== r.category || source !== r.category_source) {
      setItemCategory(db, r.id, category, source);
      changed++;
    }
  }
  return changed;
}
