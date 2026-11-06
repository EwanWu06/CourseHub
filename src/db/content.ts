import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { AssignmentGroupRow, ConversationRow, FileRow, ModuleItemRow, ModuleRow, PageRow, TextStatus, TopicRow } from './types.ts';
import { all, insertRow, one, pick, run, updateRow } from './sql.ts';

function upsert(db: DB, table: string, row: Record<string, unknown>, cols: readonly string[]): void {
  const r = pick(row, cols);
  run(db, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '$' + c).join(', ')})
           ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`, r);
}

// ---- modules ----
const MODULE_COLS = ['id', 'course_id', 'canvas_id', 'name', 'position', 'unlock_at', 'state', 'prereq_ids'] as const;
const MODULE_ITEM_COLS = ['id', 'module_id', 'course_id', 'title', 'type', 'content_id', 'page_url', 'html_url',
  'external_url', 'position', 'indent', 'ref_id', 'req_type', 'req_min_score', 'req_done'] as const;

export function upsertModule(db: DB, row: Omit<ModuleRow, 'week_start' | 'week_end' | 'week_source' | 'state' | 'prereq_ids'> & Partial<Pick<ModuleRow, 'state' | 'prereq_ids'>>): void {
  upsert(db, 'modules', row as unknown as Record<string, unknown>, MODULE_COLS);
}

export function setModuleWeek(db: DB, id: string, w: { week_start: number | null; week_end: number | null; week_source: string | null }): void {
  updateRow(db, 'modules', w, 'id = $__id', { __id: id });
}

export function upsertModuleItem(db: DB, row: Omit<ModuleItemRow, 'req_type' | 'req_min_score' | 'req_done'> & Partial<Pick<ModuleItemRow, 'req_type' | 'req_min_score' | 'req_done'>>): void {
  upsert(db, 'module_items', row as unknown as Record<string, unknown>, MODULE_ITEM_COLS);
}

/** Drops modules/items of a course that Canvas no longer lists. */
export function pruneModules(db: DB, courseId: string, keepModules: Set<string>, keepItems: Set<string>): void {
  for (const m of all<{ id: string }>(db, 'SELECT id FROM modules WHERE course_id = $courseId', { courseId })) {
    if (!keepModules.has(m.id)) run(db, 'DELETE FROM modules WHERE id = $id', { id: m.id });
  }
  for (const i of all<{ id: string }>(db, 'SELECT id FROM module_items WHERE course_id = $courseId', { courseId })) {
    if (!keepItems.has(i.id)) run(db, 'DELETE FROM module_items WHERE id = $id', { id: i.id });
  }
}

export function listModules(db: DB, courseId: string): ModuleRow[] {
  return all<ModuleRow>(db, 'SELECT * FROM modules WHERE course_id = $courseId ORDER BY position, name', { courseId });
}

export function listModuleItems(db: DB, courseId: string): ModuleItemRow[] {
  return all<ModuleItemRow>(db, `SELECT mi.* FROM module_items mi JOIN modules m ON m.id = mi.module_id
      WHERE mi.course_id = $courseId ORDER BY m.position, mi.position`, { courseId });
}

// ---- pages ----
const PAGE_COLS = ['id', 'course_id', 'url', 'title', 'updated_at', 'front_page', 'html_url'] as const;

export function getPage(db: DB, id: string): PageRow | undefined {
  return one<PageRow>(db, 'SELECT * FROM pages WHERE id = $id', { id });
}

/** body_html undefined → keep the stored body (only metadata was listed). */
export function upsertPage(db: DB, row: Omit<PageRow, 'body_html'> & { body_html?: string | null }): { created: boolean; prev?: PageRow } {
  const prev = getPage(db, row.id);
  upsert(db, 'pages', row as unknown as Record<string, unknown>, PAGE_COLS);
  if (row.body_html !== undefined) updateRow(db, 'pages', { body_html: row.body_html }, 'id = $__id', { __id: row.id });
  return prev ? { created: false, prev } : { created: true };
}

export function listPages(db: DB, courseId: string): PageRow[] {
  return all<PageRow>(db, 'SELECT * FROM pages WHERE course_id = $courseId ORDER BY front_page DESC, title', { courseId });
}

// ---- files ----
const FILE_COLS = ['id', 'course_id', 'canvas_id', 'name', 'content_type', 'size', 'updated_at', 'html_url'] as const;

export function getFile(db: DB, id: string): FileRow | undefined {
  return one<FileRow>(db, 'SELECT * FROM files WHERE id = $id', { id });
}

/** New or changed files go back to text_status 'pending'. */
export function upsertFile(db: DB, row: Omit<FileRow, 'text_status' | 'text_pages' | 'text_error'>): { created: boolean; prev?: FileRow } {
  const prev = getFile(db, row.id);
  upsert(db, 'files', row as unknown as Record<string, unknown>, FILE_COLS);
  if (!prev) return { created: true };
  if (prev.updated_at !== row.updated_at || prev.size !== row.size) {
    updateRow(db, 'files', { text_status: 'pending', text_pages: null, text_error: null }, 'id = $__id', { __id: row.id });
  }
  return { created: false, prev };
}

export function listFiles(db: DB, courseId: string): FileRow[] {
  return all<FileRow>(db, 'SELECT * FROM files WHERE course_id = $courseId ORDER BY name', { courseId });
}

export function filesNeedingText(db: DB, limit: number, courseId?: string): FileRow[] {
  return all<FileRow>(db, `SELECT * FROM files WHERE text_status = 'pending' ${courseId ? 'AND course_id = $courseId' : ''}
      ORDER BY updated_at DESC LIMIT $limit`, courseId ? { limit, courseId } : { limit });
}

export function setFileText(db: DB, id: string, t: { status: TextStatus; pages?: number | null; error?: string | null }): void {
  updateRow(db, 'files', { text_status: t.status, text_pages: t.pages ?? null, text_error: t.error ?? null }, 'id = $__id', { __id: id });
}

// ---- announcements & discussions ----
const TOPIC_COLS = ['id', 'course_id', 'kind', 'title', 'message_html', 'posted_at', 'author', 'html_url',
  'reply_count', 'unread_count', 'assignment_item_id'] as const;

export function upsertTopic(db: DB, row: Omit<TopicRow, 'first_seen_at'>): { created: boolean } {
  const exists = one(db, 'SELECT id FROM topics WHERE id = $id', { id: row.id });
  if (!exists) {
    insertRow(db, 'topics', { ...pick(row as unknown as Record<string, unknown>, TOPIC_COLS), first_seen_at: nowIso() });
    return { created: true };
  }
  const { id: _id, ...rest } = pick(row as unknown as Record<string, unknown>, TOPIC_COLS);
  updateRow(db, 'topics', rest, 'id = $__id', { __id: row.id });
  return { created: false };
}

export function listTopics(db: DB, courseId: string, kind: TopicRow['kind']): TopicRow[] {
  return all<TopicRow>(db, `SELECT * FROM topics WHERE course_id = $courseId AND kind = $kind
      ORDER BY COALESCE(posted_at, first_seen_at) DESC`, { courseId, kind });
}

export function getTopic(db: DB, id: string): TopicRow | undefined {
  return one<TopicRow>(db, 'SELECT * FROM topics WHERE id = $id', { id });
}

// ---- inbox ----
const CONVERSATION_COLS = ['id', 'school_id', 'subject', 'last_message', 'last_at', 'participants', 'context_name',
  'workflow_state', 'html_url'] as const;

export function upsertConversation(db: DB, row: ConversationRow): void {
  upsert(db, 'conversations', row as unknown as Record<string, unknown>, CONVERSATION_COLS);
}

export function listConversations(db: DB, schoolId?: string): ConversationRow[] {
  return all<ConversationRow>(db, `SELECT * FROM conversations ${schoolId ? 'WHERE school_id = $schoolId' : ''}
      ORDER BY last_at DESC`, schoolId ? { schoolId } : {});
}

// ---- assignment groups ----
export function upsertAssignmentGroup(db: DB, row: Omit<AssignmentGroupRow, 'rules'> & { rules?: string | null }): void {
  upsert(db, 'assignment_groups', { rules: null, ...row } as unknown as Record<string, unknown>, ['id', 'course_id', 'name', 'weight', 'position', 'rules']);
}

export function listAssignmentGroups(db: DB, courseId: string): (AssignmentGroupRow & { count: number })[] {
  return all<AssignmentGroupRow & { count: number }>(db, `SELECT g.*, (SELECT COUNT(*) FROM items i WHERE i.group_id = g.id AND i.removed = 0) AS count
      FROM assignment_groups g WHERE g.course_id = $courseId ORDER BY g.position`, { courseId });
}
