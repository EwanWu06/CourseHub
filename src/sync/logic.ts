// What each task in a course takes for full credit and how far the student is: from Canvas's own settings, the
// teacher's instructions, the student's own discussion entries and the peer reviews the planner lists. Runs after
// the planner (peer reviews come from it) and is written to item_logic, which the task views read.
import { SessionExpiredError } from '../canvas/client.ts';
import type { CanvasAssignment, CanvasQuiz } from '../canvas/types.ts';
import { getItem } from '../db/items.ts';
import { entryAuthors, replaceCourseLogic, saveEntryAuthors } from '../db/logic.ts';
import { listModuleItems, listModules } from '../db/content.ts';
import { all, one } from '../db/sql.ts';
import type { CourseRow, ItemRow } from '../db/types.ts';
import { instructionsOf, isCanvasDiscussion, isDiscussionLike } from '../logic/assignment.ts';
import { discussionProgress } from '../logic/progress.ts';
import type { DiscussionProgress } from '../logic/progress.ts';
import type { ItemLogic, LogicNote, LogicPart } from '../logic/types.ts';
import type { SyncContext } from './context.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const WEEKDAY = '日一二三四五六';
/** "10/20 周二 23:59" — a stored note must not say "明天". */
function when(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} 周${WEEKDAY[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const HANDED_IN = new Set(['submitted', 'graded', 'pending_review']);

function teacherIds(course: CourseRow): Set<string> {
  try {
    return new Set((JSON.parse(course.teacher_ids ?? '[]') as string[]).map(String));
  } catch {
    return new Set();
  }
}

function ownEntries(a: CanvasAssignment) {
  const list = a.submission?.discussion_entries;
  return Array.isArray(list) ? list.map((e) => ({ id: String(e.id), parent_id: e.parent_id ? String(e.parent_id) : null })) : null;
}

/** The classmates' posts the student replied to (not the student's own). */
function repliedTo(entries: { id: string; parent_id: string | null }[]): string[] {
  const own = new Set(entries.map((e) => e.id));
  return [...new Set(entries.filter((e) => e.parent_id && !own.has(e.parent_id)).map((e) => e.parent_id!))];
}

/** Who wrote the posts the student replied to: looked up once per post (entry_list), then kept. */
async function lookUpAuthors(ctx: SyncContext, course: CourseRow, list: CanvasAssignment[]): Promise<void> {
  for (const a of list) {
    const entries = isCanvasDiscussion(a) ? ownEntries(a) : null;
    if (!entries || !a.discussion_topic?.id) continue;
    const parents = repliedTo(entries);
    const known = entryAuthors(ctx.db, ctx.school.id, parents);
    const missing = parents.filter((p) => !known.has(p));
    if (!missing.length) continue;
    try {
      const got = await ctx.client.get<{ id: string; user_id?: string | null }[]>(
        `/api/v1/courses/${course.canvas_id}/discussion_topics/${a.discussion_topic.id}/entry_list`, { 'ids[]': missing });
      saveEntryAuthors(ctx.db, ctx.school.id, (Array.isArray(got) ? got : []).filter((e) => e.user_id).map((e) => ({ entryId: String(e.id), userId: String(e.user_id) })));
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      // a group discussion, a locked topic: the replies are still counted, only not who they went to
    }
  }
}

function progressOf(ctx: SyncContext, a: CanvasAssignment, teachers: Set<string>): DiscussionProgress | null {
  const entries = isCanvasDiscussion(a) ? ownEntries(a) : null;
  if (!entries) return null;
  // Canvas says something was posted but lists none of it (a group discussion keeps entries in the group's copy):
  // nothing can be counted — Canvas's own state stands
  const handedIn = [a.submission, ...(a.submission?.sub_assignment_submissions ?? [])].some((x) => !!x?.submitted_at || HANDED_IN.has(x?.workflow_state ?? ''));
  if (!entries.length && handedIn) return null;
  const authors = entryAuthors(ctx.db, ctx.school.id, repliedTo(entries));
  return discussionProgress(entries, a.submission?.user_id ? String(a.submission.user_id) : null, (id) => authors.get(id), teachers);
}

function repliesPart(need: number, source: LogicPart['source'], quote: string | undefined, p: DiscussionProgress | null): LogicPart {
  const part: LogicPart = { kind: 'replies', need, done: p ? p.people ?? p.replies : null, source, ...(quote ? { quote } : {}) };
  if (p && p.people !== null && p.replies > p.people) part.detail = `回复了 ${p.replies} 条，算作 ${p.people} 位同学（同一个人只算一次，回复老师不算）`;
  else if (p && p.people === null && p.replies) part.detail = `回复了 ${p.replies} 条（没能确认是几位不同的同学）`;
  return part;
}

function notesFor(a: CanvasAssignment, quiz: CanvasQuiz | undefined): LogicNote[] {
  const f = instructionsOf(a);
  const notes: LogicNote[] = [];
  if (f.words && isDiscussionLike(a)) {
    const { min, max } = f.words.value;
    notes.push({ kind: 'words', text: max ? `主帖 ${min}–${max} 词` : `主帖至少 ${min} 词`, quote: f.words.quote });
  }
  const attempts = quiz?.allowed_attempts ?? a.allowed_attempts ?? -1;
  if (attempts === 1) notes.push({ kind: 'one_attempt', text: quiz || a.is_quiz_assignment ? '只能做一次' : '只能提交一次', ...(f.oneAttempt ? { quote: f.oneAttempt.quote } : {}) });
  else if (f.oneAttempt) notes.push({ kind: 'one_attempt', text: '只有一次机会：做完再点提交', quote: f.oneAttempt.quote });
  else if (attempts > 1) notes.push({ kind: 'attempts', text: quiz || a.is_quiz_assignment ? `可以做 ${attempts} 次` : `最多提交 ${attempts} 次` });
  if (quiz?.time_limit) notes.push({ kind: 'time_limit', text: `限时 ${quiz.time_limit} 分钟` });
  if (f.inPerson) notes.push({ kind: 'in_person', text: '只能在实验室 / 课堂现场完成', quote: f.inPerson.quote });
  // only where a file is handed in: a PlayPosit video can carry a stray file-type setting
  const exts = (a.submission_types ?? []).includes('online_upload') ? (a.allowed_extensions ?? []).map((x) => x.replace(/^\./, '').toUpperCase()).filter(Boolean) : [];
  if (exts.length) notes.push({ kind: 'file_types', text: `只收 ${exts.join(' / ')} 文件` });
  if (a.discussion_topic?.require_initial_post) notes.push({ kind: 'post_first', text: '要先发自己的帖，才能看到同学的帖子' });
  if (!isCanvasDiscussion(a) && isDiscussionLike(a) && f.replies) {
    notes.push({ kind: 'replies_elsewhere', text: `要回复 ${f.replies.value} 位同学（在外部平台完成，Course Hub 数不到）`, quote: f.replies.quote });
  }
  return notes;
}

/** The peer-reviewed assignment a "Peer Reviews …" grade column belongs to: the last one due before it. */
function reviewedBy(column: CanvasAssignment, reviewed: CanvasAssignment[]): CanvasAssignment | null {
  const due = column.due_at ? Date.parse(column.due_at) : null;
  const before = reviewed.filter((t) => t.due_at && due !== null && Date.parse(t.due_at) <= due);
  if (before.length) return before.sort((x, y) => Date.parse(y.due_at!) - Date.parse(x.due_at!))[0];
  if (reviewed.length === 1) return reviewed[0];
  const words = (x: string) => new Set((x.toLowerCase().match(/[a-z0-9#]+/g) ?? []).filter((w) => !['peer', 'review', 'reviews', 'for', 'the', 'of', 'a'].includes(w)));
  const mine = words(column.name);
  const scored = reviewed.map((t) => ({ t, n: [...words(t.name)].filter((w) => mine.has(w)).length })).sort((x, y) => y.n - x.n);
  return scored[0]?.n ? scored[0].t : null;
}

/** Peer reviews: the reviewed assignment says how many; a "Peer Reviews …" column counts them and sets their deadline. */
function peerReviews(ctx: SyncContext, course: CourseRow, list: CanvasAssignment[], out: Map<string, ItemLogic>): void {
  const s = ctx.school.id;
  const reviewed = list.filter((a) => a.peer_reviews);
  if (!reviewed.length) return;
  const requests = all<ItemRow>(ctx.db, "SELECT * FROM items WHERE course_id = $courseId AND removed = 0 AND kind = 'review'", { courseId: course.id });
  const columns = list.filter((a) => !a.peer_reviews && /peer[\s-]*reviews?/i.test(a.name)
    && (a.submission_types ?? []).every((x) => x === 'none' || x === 'not_graded' || x === 'on_paper'));
  const columnOf = new Map<string, CanvasAssignment>();
  for (const col of columns) {
    const target = reviewedBy(col, reviewed);
    if (target && !columnOf.has(String(target.id))) columnOf.set(String(target.id), col);
  }
  const entry = (id: string) => {
    if (!out.has(id)) out.set(id, { parts: [], notes: [] });
    return out.get(id)!;
  };
  for (const t of reviewed) {
    const col = columnOf.get(String(t.id));
    const mine = requests.filter((p) => new RegExp(`/assignments/${t.id}(?:[?#/]|$)`).test(p.html_url ?? ''));
    const fromText = col ? instructionsOf(col).reviews : undefined;
    const need = t.peer_review_count || fromText?.value || mine.length || 1;
    entry(`${s}:a:${t.id}`).notes.push({
      kind: 'peer_reviews', text: `交了以后要给 ${need} 位同学互评${col?.due_at ? `，截止 ${when(col.due_at)}（「${col.name.trim()}」）` : ''}`,
    });
    if (!col) continue;
    const handedIn = !!t.submission && HANDED_IN.has(t.submission.workflow_state ?? '');
    const completed = mine.filter((p) => p.sub_state === 'submitted' || p.canvas_done).length;
    entry(`${s}:a:${col.id}`).parts.push({
      kind: 'reviews', need, done: completed, source: t.peer_review_count ? 'canvas' : 'text',
      ...(!t.peer_review_count && fromText ? { quote: fromText.quote } : {}),
      detail: mine.length ? `已分配 ${mine.length} 份` : handedIn ? '互评还没分配下来' : `交了「${t.name.trim()}」以后才会分配`,
    });
    for (const p of mine) {
      if (!col.due_at || (p.due_at && Date.parse(p.due_at) >= Date.parse(col.due_at))) continue;
      entry(p.id).due = { at: col.due_at, note: `互评截止按老师的「${col.name.trim()}」${p.due_at ? `（Canvas 待办里显示的是 ${when(p.due_at)}）` : ''}` };
    }
  }
}

/**
 * Canvas module requirements: a minimum score the module asks for (a quiz can be graded and still not count), and
 * work sitting in a module that stays locked until earlier modules are complete.
 */
function moduleRules(ctx: SyncContext, course: CourseRow, out: Map<string, ItemLogic>): void {
  const modules = listModules(ctx.db, course.id);
  if (!modules.length) return;
  const byCanvas = new Map(modules.map((m) => [m.canvas_id, m]));
  const items = listModuleItems(ctx.db, course.id);
  const entry = (id: string) => {
    if (!out.has(id)) out.set(id, { parts: [], notes: [] });
    return out.get(id)!;
  };
  // the tasks a module item stands for: a discussion is its assignment, a checkpointed one its checkpoint tasks
  const tasksOf = (ref: string | null): string[] => {
    if (!ref) return [];
    let id = ref;
    if (ref.includes(':t:')) id = one<{ a: string | null }>(ctx.db, 'SELECT assignment_item_id AS a FROM topics WHERE id = $ref', { ref })?.a ?? '';
    if (!id || !/:(a|q):/.test(id)) return [];
    return all<{ id: string }>(ctx.db, `SELECT id FROM items WHERE removed = 0 AND (id = $id OR substr(id, 1, length($id) + 1) = $id || ':')`, { id }).map((r) => r.id);
  };
  const prereqs = (m: { prereq_ids: string | null }) => {
    try {
      return (JSON.parse(m.prereq_ids ?? '[]') as string[]).map((id) => byCanvas.get(String(id))).filter((x) => !!x);
    } catch {
      return [];
    }
  };
  const unlocks = (moduleCanvasId: string) => modules.filter((m) => prereqs(m).some((p) => p!.canvas_id === moduleCanvasId)).map((m) => m.name.trim());
  for (const it of items) {
    const m = modules.find((x) => x.id === it.module_id);
    if (!m) continue;
    if ((it.req_type === 'min_score' || it.req_type === 'min_percentage') && it.req_min_score !== null && it.req_done !== null) {
      for (const id of tasksOf(it.ref_id)) {
        const row = one<{ score: number | null; points: number | null }>(ctx.db, 'SELECT score, points FROM items WHERE id = $id', { id });
        const pct = it.req_type === 'min_percentage';
        const have = row?.score == null ? null : pct ? (row.points ? (row.score / row.points) * 100 : null) : row.score;
        const need = it.req_min_score;
        const later = unlocks(m.canvas_id);
        entry(id).parts.push({
          kind: 'score', need, done: it.req_done ? Math.max(have ?? need, need) : have !== null && have < need ? have : null, source: 'canvas',
          detail: `模块「${m.name.trim()}」要求至少 ${need}${pct ? '%' : ' 分'}${later.length ? `，才能打开「${later.join('」「')}」` : ''}`,
        });
      }
    }
    if (m.state === 'locked') {
      const before = prereqs(m).filter((p) => p!.state !== 'completed').map((p) => p!.name.trim());
      if (!before.length) continue;
      for (const id of tasksOf(it.ref_id)) {
        const e = entry(id);
        if (!e.notes.some((n) => n.kind === 'locked')) e.notes.push({ kind: 'locked', text: `所在模块「${m.name.trim()}」还锁着：先完成「${before.join('」「')}」` });
      }
    }
  }
}

export async function syncCourseLogic(ctx: SyncContext, course: CourseRow): Promise<void> {
  const raw = ctx.raw?.get(course.id);
  if (!raw) return;
  const s = ctx.school.id;
  const list = raw.assignments.filter((a) => a.published !== false);
  await lookUpAuthors(ctx, course, list);
  const teachers = teacherIds(course);
  const quizOf = new Map((raw.quizzes ?? []).filter((q) => q.assignment_id).map((q) => [String(q.assignment_id), q]));
  const out = new Map<string, ItemLogic>();

  for (const a of list) {
    const id = `${s}:a:${a.id}`;
    const f = instructionsOf(a);
    const notes = notesFor(a, quizOf.get(String(a.id)));
    const progress = progressOf(ctx, a, teachers);
    if (a.has_sub_assignments && a.checkpoints?.length) {
      // Canvas's "Required Replies (n)" says submitted at the first reply: count the replies ourselves
      const required = a.discussion_topic?.reply_to_entry_required_count ?? 0;
      const fromText = (f.replies?.value ?? 0) > required;
      const need = Math.max(required, f.replies?.value ?? 0) || 1;
      for (const cp of a.checkpoints) {
        if (cp.tag === 'reply_to_topic') out.set(`${id}:reply_to_topic`, { parts: [{ kind: 'post', need: 1, done: progress?.posts ?? null, source: 'canvas' }], notes });
        if (cp.tag === 'reply_to_entry') out.set(`${id}:reply_to_entry`, { parts: [repliesPart(need, fromText ? 'text' : 'canvas', fromText ? f.replies!.quote : undefined, progress)], notes });
      }
      continue;
    }
    const parts: LogicPart[] = [];
    if (isCanvasDiscussion(a)) {
      parts.push({ kind: 'post', need: f.posts?.value ?? 1, done: progress?.posts ?? null, source: f.posts ? 'text' : 'canvas', ...(f.posts ? { quote: f.posts.quote } : {}) });
      if (f.replies) parts.push(repliesPart(f.replies.value, 'text', f.replies.quote, progress));
    }
    out.set(id, { parts, notes });
    const first = getItem(ctx.db, `${id}:initial_post`);
    if (first && !first.removed && f.postDue) {
      out.set(first.id, {
        parts: progress ? [{ kind: 'post', need: 1, done: progress.posts, source: 'text', quote: f.postDue.quote }] : [],
        notes: [],
        due: { at: null, note: `首帖截止来自作业说明「${f.postDue.quote}」${f.postDue.value.time === null ? '；原文没写几点，按这项作业截止的同一时刻算' : ''}` },
      });
    }
  }
  for (const q of raw.quizzes ?? []) {
    if (q.assignment_id || q.published === false) continue;
    const notes: LogicNote[] = [];
    if (q.time_limit) notes.push({ kind: 'time_limit', text: `限时 ${q.time_limit} 分钟` });
    if (q.allowed_attempts === 1) notes.push({ kind: 'one_attempt', text: '只能做一次' });
    else if ((q.allowed_attempts ?? -1) > 1) notes.push({ kind: 'attempts', text: `可以做 ${q.allowed_attempts} 次` });
    out.set(`${s}:q:${q.id}`, { parts: [], notes });
  }
  peerReviews(ctx, course, list, out);
  moduleRules(ctx, course, out);
  replaceCourseLogic(ctx.db, s, course.id, out);
}
