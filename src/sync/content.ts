// Course content: tabs + syllabus, modules (+ items), pages, file metadata, announcements, discussions, inbox.
// Files are NOT downloaded here — only metadata; text extraction happens transiently in content/pipeline.
import { CanvasForbiddenError, CanvasNotFoundError } from '../canvas/client.ts';
import type {
  CanvasConversation, CanvasCourse, CanvasDiscussionTopic, CanvasFile, CanvasModule, CanvasModuleItem, CanvasPage, CanvasTab,
} from '../canvas/types.ts';
import { addChange } from '../db/changes.ts';
import {
  getFile, getPage, listModuleItems, listPages, pruneModules, upsertConversation, upsertFile, upsertModule, upsertModuleItem,
  upsertPage, upsertTopic,
} from '../db/content.ts';
import { setCourseSyllabus } from '../db/courses.ts';
import { setItemModule } from '../db/items.ts';
import { run } from '../db/sql.ts';
import type { CourseRow } from '../db/types.ts';
import { errorText } from './context.ts';
import type { SyncContext } from './context.ts';

const DAY = 86_400_000;
const DOC_RE = /\.(pdf|pptx?|docx?|rtf|txt|md|key)$/i;

function isOptional(err: unknown): boolean {
  return err instanceof CanvasForbiddenError || err instanceof CanvasNotFoundError;
}

/** Runs a content step; hidden/forbidden sections are skipped silently, other failures are recorded. */
async function step(ctx: SyncContext, label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (isOptional(err)) return;
    if ((err as Error).name === 'SessionExpiredError') throw err;
    ctx.stats.errors.push(`${label}: ${errorText(err)}`);
  }
}

export async function syncTabsAndSyllabus(ctx: SyncContext, course: CourseRow): Promise<string[]> {
  let tabs: string[] = [];
  await step(ctx, `${course.name} 导航`, async () => {
    const list = await ctx.client.getAll<CanvasTab>(`/api/v1/courses/${course.canvas_id}/tabs`);
    tabs = list.filter((t) => !t.hidden && t.visibility !== 'none').map((t) => t.id);
  });
  let syllabus: string | null = null;
  await step(ctx, `${course.name} 大纲`, async () => {
    const c = await ctx.client.get<CanvasCourse>(`/api/v1/courses/${course.canvas_id}`, { 'include[]': ['syllabus_body'] });
    syllabus = c.syllabus_body?.trim() ? c.syllabus_body : null;
  });
  setCourseSyllabus(ctx.db, course.id, syllabus, tabs);
  return tabs;
}

export async function syncModules(ctx: SyncContext, course: CourseRow): Promise<void> {
  const s = ctx.school.id;
  const modules = await ctx.client.getAll<CanvasModule>(`/api/v1/courses/${course.canvas_id}/modules`, { 'include[]': ['items', 'content_details'] });
  const keepModules = new Set<string>();
  const keepItems = new Set<string>();
  for (const m of modules) {
    const moduleId = `${s}:m:${m.id}`;
    upsertModule(ctx.db, { id: moduleId, course_id: course.id, canvas_id: m.id, name: m.name, position: m.position ?? 0, unlock_at: m.unlock_at ?? null });
    keepModules.add(moduleId);
    const items: CanvasModuleItem[] = m.items ?? (m.items_count === 0 ? [] : await ctx.client.getAll<CanvasModuleItem>(`/api/v1/courses/${course.canvas_id}/modules/${m.id}/items`, { 'include[]': ['content_details'] }));
    for (const it of items) {
      const id = `${s}:mi:${it.id}`;
      upsertModuleItem(ctx.db, {
        id, module_id: moduleId, course_id: course.id, title: it.title, type: it.type, content_id: it.content_id ? String(it.content_id) : null,
        page_url: it.page_url ?? null, html_url: it.html_url ?? null, external_url: it.external_url ?? null,
        position: it.position ?? 0, indent: it.indent ?? 0, ref_id: null,
      });
      keepItems.add(id);
    }
  }
  pruneModules(ctx.db, course.id, keepModules, keepItems);
}

export async function syncPages(ctx: SyncContext, course: CourseRow, tabs: string[]): Promise<void> {
  const s = ctx.school.id;
  const fetchBody = async (url: string) => {
    const p = await ctx.client.get<CanvasPage>(`/api/v1/courses/${course.canvas_id}/pages/${encodeURIComponent(url)}`);
    upsertPage(ctx.db, {
      id: `${s}:p:${p.page_id}`, course_id: course.id, url: p.url, title: p.title, updated_at: p.updated_at ?? null,
      front_page: p.front_page ? 1 : 0, html_url: p.html_url ?? `${course.html_url}/pages/${p.url}`, body_html: p.body ?? '',
    });
  };
  let listed = false;
  if (tabs.length === 0 || tabs.includes('pages')) {
    try {
      const pages = await ctx.client.getAll<CanvasPage>(`/api/v1/courses/${course.canvas_id}/pages`, { sort: 'updated_at' });
      listed = true;
      for (const p of pages) {
        const id = `${s}:p:${p.page_id}`;
        const prev = getPage(ctx.db, id);
        upsertPage(ctx.db, {
          id, course_id: course.id, url: p.url, title: p.title, updated_at: p.updated_at ?? null, front_page: p.front_page ? 1 : 0,
          html_url: p.html_url ?? `${course.html_url}/pages/${p.url}`,
        });
        if (!prev || prev.body_html === null || prev.updated_at !== (p.updated_at ?? null)) await step(ctx, `页面 ${p.title}`, () => fetchBody(p.url));
      }
    } catch (err) {
      if (!isOptional(err)) throw err;
    }
  }
  if (!listed) {
    // Pages tab hidden: still read pages that modules link to (once).
    const known = new Set(listPages(ctx.db, course.id).map((p) => p.url));
    for (const it of listModuleItems(ctx.db, course.id)) {
      if (it.type === 'Page' && it.page_url && !known.has(it.page_url)) await step(ctx, `页面 ${it.title}`, () => fetchBody(it.page_url!));
    }
  }
}

export async function syncFiles(ctx: SyncContext, course: CourseRow, tabs: string[]): Promise<void> {
  const s = ctx.school.id;
  const store = (f: CanvasFile) => {
    const id = `${s}:f:${f.id}`;
    const { created } = upsertFile(ctx.db, {
      id, course_id: course.id, canvas_id: String(f.id), name: f.display_name, content_type: f['content-type'] ?? null,
      size: f.size ?? null, updated_at: f.updated_at ?? null, html_url: `${course.html_url}/files/${f.id}`,
    });
    if (created && !ctx.firstSync && DOC_RE.test(f.display_name)) {
      addChange(ctx.db, { school_id: s, course_id: course.id, kind: 'file', ref_id: id, summary: `新文件：${f.display_name}`, data: '{}' });
      ctx.stats.changes++;
    }
  };
  let listed = false;
  if (tabs.length === 0 || tabs.includes('files')) {
    try {
      for (const f of await ctx.client.getAll<CanvasFile>(`/api/v1/courses/${course.canvas_id}/files`, { sort: 'updated_at' })) store(f);
      listed = true;
    } catch (err) {
      if (!isOptional(err)) throw err;
    }
  }
  if (!listed) {
    for (const it of listModuleItems(ctx.db, course.id)) {
      if (it.type !== 'File' || !it.content_id || getFile(ctx.db, `${s}:f:${it.content_id}`)) continue;
      await step(ctx, `文件 ${it.title}`, async () => store(await ctx.client.get<CanvasFile>(`/api/v1/courses/${course.canvas_id}/files/${it.content_id}`)));
    }
  }
}

export async function syncTopics(ctx: SyncContext, course: CourseRow): Promise<void> {
  const s = ctx.school.id;
  const start = course.start_at ?? new Date(ctx.now.getTime() - 120 * DAY).toISOString();
  await step(ctx, `${course.name} 公告`, async () => {
    const list = await ctx.client.getAll<CanvasDiscussionTopic>('/api/v1/announcements', {
      'context_codes[]': [`course_${course.canvas_id}`], start_date: start, end_date: new Date(ctx.now.getTime() + DAY).toISOString(),
    });
    for (const t of list) {
      const id = `${s}:t:${t.id}`;
      const { created } = upsertTopic(ctx.db, {
        id, course_id: course.id, kind: 'announcement', title: t.title, message_html: t.message ?? null, posted_at: t.posted_at ?? null,
        author: t.author?.display_name ?? t.user_name ?? null, html_url: t.html_url ?? `${course.html_url}/discussion_topics/${t.id}`,
        reply_count: t.discussion_subentry_count ?? 0, unread_count: t.unread_count ?? 0, assignment_item_id: null,
      });
      if (created && !ctx.firstSync) {
        addChange(ctx.db, { school_id: s, course_id: course.id, kind: 'announcement', ref_id: id, summary: `新公告：${course.code ?? course.name} — ${t.title}`, data: '{}' });
        ctx.stats.changes++;
      }
    }
  });
  await step(ctx, `${course.name} 讨论`, async () => {
    for (const t of await ctx.client.getAll<CanvasDiscussionTopic>(`/api/v1/courses/${course.canvas_id}/discussion_topics`)) {
      upsertTopic(ctx.db, {
        id: `${s}:t:${t.id}`, course_id: course.id, kind: 'discussion', title: t.title, message_html: t.message ?? null,
        posted_at: t.posted_at ?? null, author: t.author?.display_name ?? t.user_name ?? null,
        html_url: t.html_url ?? `${course.html_url}/discussion_topics/${t.id}`, reply_count: t.discussion_subentry_count ?? 0,
        unread_count: t.unread_count ?? 0, assignment_item_id: t.assignment_id ? `${s}:a:${t.assignment_id}` : null,
      });
    }
  });
}

/** Links module items to the rows they point at (assignment, quiz, page, file, topic). */
export function resolveModuleRefs(ctx: SyncContext, course: CourseRow): void {
  const s = ctx.school.id;
  const pageIdByUrl = new Map(listPages(ctx.db, course.id).map((p) => [p.url, p.id]));
  for (const it of listModuleItems(ctx.db, course.id)) {
    let ref: string | null = null;
    const cid = it.content_id;
    if (it.type === 'Assignment' && cid) ref = `${s}:a:${cid}`;
    else if (it.type === 'Quiz' && cid) ref = ctx.quizToAssignment.has(cid) ? `${s}:a:${ctx.quizToAssignment.get(cid)}` : `${s}:q:${cid}`;
    else if (it.type === 'Discussion' && cid) ref = `${s}:t:${cid}`;
    else if (it.type === 'File' && cid) ref = `${s}:f:${cid}`;
    else if (it.type === 'Page' && it.page_url) ref = pageIdByUrl.get(it.page_url) ?? null;
    if (ref !== it.ref_id) run(ctx.db, 'UPDATE module_items SET ref_id = $ref WHERE id = $id', { ref, id: it.id });
    const itemId = it.type === 'Discussion' && cid && ctx.topicToAssignment.has(cid) ? `${s}:a:${ctx.topicToAssignment.get(cid)}` : ref;
    if (itemId) setItemModule(ctx.db, itemId, it.module_id); // also reaches a checkpointed discussion's tasks
  }
}

export async function syncCourseContent(ctx: SyncContext, course: CourseRow): Promise<void> {
  const tabs = await syncTabsAndSyllabus(ctx, course);
  if (tabs.length === 0 || tabs.includes('modules')) await step(ctx, `${course.name} 模块`, () => syncModules(ctx, course));
  await step(ctx, `${course.name} 页面`, () => syncPages(ctx, course, tabs));
  await step(ctx, `${course.name} 文件`, () => syncFiles(ctx, course, tabs));
  await syncTopics(ctx, course);
  resolveModuleRefs(ctx, course);
}

export async function syncInbox(ctx: SyncContext): Promise<void> {
  const list = await ctx.client.get<CanvasConversation[]>('/api/v1/conversations', { scope: 'inbox', per_page: 50 });
  for (const c of list) {
    upsertConversation(ctx.db, {
      id: `${ctx.school.id}:c:${c.id}`, school_id: ctx.school.id, subject: c.subject?.trim() || '(无主题)', last_message: c.last_message ?? null,
      last_at: c.last_message_at ?? null, participants: (c.participants ?? []).map((p) => p.name).join(', '),
      context_name: c.context_name ?? null, workflow_state: c.workflow_state ?? 'read', html_url: `${ctx.school.base_url}/conversations`,
    });
  }
}
