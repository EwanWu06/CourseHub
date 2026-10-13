// Macmillan Achieve, the publisher platform some courses run their weekly work on. Canvas only holds its grade
// columns ("Achieve Category: Week 3"); the assignments and their deadlines live in Achieve. Canvas hands out a
// one-time LTI launch link (a GET, like its mobile apps use), a throwaway headless Chrome follows it — Achieve's
// own web app is never run, so nothing is opened, started or changed — and two read-only lists are fetched:
// the student's timeline (what Achieve's week outline shows) and the completion statuses.
import { SessionExpiredError } from '../canvas/client.ts';
import { DEFAULT_USER_AGENT } from '../canvas/client.ts';
import { chromeBin } from '../config.ts';
import type { DB } from '../db/index.ts';
import { listCourses } from '../db/courses.ts';
import { courseDisplayName } from '../util/course.ts';
import { nowIso } from '../db/index.ts';
import { getItem, setItemCategory, upsertItem } from '../db/items.ts';
import type { ItemUpsert } from '../db/items.ts';
import { getPlatformStatus, recordPlatformRead } from '../db/platforms.ts';
import { all, run } from '../db/sql.ts';
import type { CourseRow, ItemKind } from '../db/types.ts';
import type { Category } from '../sync/category.ts';
import { noteItemChange } from '../sync/changes.ts';
import { errorText } from '../sync/context.ts';
import type { SyncContext } from '../sync/context.ts';

export interface AchieveTimelineItem {
  id: string; name: string; tool: string; points: number | null; dueDate: string | null;
  visibilityStartDate: string | null; gradebookCategoryName: string | null;
}
export interface AchieveData { items: AchieveTimelineItem[]; statuses: Record<string, string> }
export type AchieveReader = (launchUrl: string, courseUuid: string) => Promise<AchieveData>;
export interface AchieveLaunch { moduleItemId: string; courseUuid: string; title: string }

export const ACHIEVE = 'achieve';
const LAUNCH = /^https:\/\/(lmslink\.bfwpub\.com|[a-z0-9.-]*\.macmillanlearning\.com)\//i;

/** The Achieve course behind a Canvas course, from the LTI links in its modules (the assignments link preferred). */
export function findAchieveLaunch(db: DB, courseId: string): AchieveLaunch | null {
  const rows = all<{ id: string; title: string; external_url: string }>(db,
    "SELECT id, title, external_url FROM module_items WHERE course_id = $courseId AND type = 'ExternalTool' AND external_url IS NOT NULL ORDER BY position", { courseId });
  const found = rows.flatMap((r) => {
    if (!LAUNCH.test(r.external_url)) return [];
    let uuid: string | null = null;
    try {
      uuid = new URL(r.external_url).searchParams.get('custom_course_id');
    } catch {
      return [];
    }
    return uuid ? [{ moduleItemId: r.id.split(':').pop()!, courseUuid: uuid, title: r.title }] : [];
  });
  return found.find((f) => /assign/i.test(f.title)) ?? found[0] ?? null;
}

/** Dated timeline entries become tasks; undated study tools are optional extras, not deadlines. */
export function achieveRows(schoolId: string, course: CourseRow, moduleItemId: string, data: AchieveData): { row: ItemUpsert; category: Category }[] {
  const link = `${course.html_url}/modules/items/${moduleItemId}`; // opens Achieve the way the student normally does
  return data.items.filter((i) => i.dueDate).map((i) => {
    const status = data.statuses[i.id] ?? '';
    const graded = (i.points ?? 0) > 0 || (!!i.gradebookCategoryName && !/^ungraded$/i.test(i.gradebookCategoryName));
    const kind: ItemKind = i.tool === 'reading' ? 'page' : 'assignment';
    const category: Category = i.tool === 'reading' ? 'reading' : i.tool === 'learningcurve' ? 'quiz' : graded ? 'homework' : 'reading';
    return {
      category,
      row: {
        id: `${schoolId}:ach:${i.id}`, school_id: schoolId, course_id: course.id, kind, title: i.name.trim(),
        due_at: i.dueDate, end_at: null, unlock_at: i.visibilityStartDate ?? null, lock_at: null, points: i.points ?? null,
        html_url: link, provider: 'achieve', description_html: null, submission_types: '["achieve"]',
        sub_state: status === 'Completed' ? 'submitted' : 'unsubmitted', submitted_at: null, missing: status === 'Missed' ? 1 : 0,
        late: 0, excused: 0, score: null, grade: null, canvas_done: 0, source: 'api', module_id: null, group_id: null,
      },
    };
  });
}

/** Reads a course's Achieve work and stores it; on failure keeps what was known, records why, and rethrows. */
export async function syncAchieve(ctx: SyncContext, course: CourseRow, read: AchieveReader): Promise<number | null> {
  const launch = findAchieveLaunch(ctx.db, course.id);
  if (!launch) return null;
  const at = ctx.now.toISOString();
  try {
    const { url } = await ctx.client.get<{ url: string }>(`/api/v1/courses/${course.canvas_id}/external_tools/sessionless_launch`, {
      launch_type: 'module_item', module_item_id: launch.moduleItemId,
    });
    const data = await read(url, launch.courseUuid);
    const rows = achieveRows(ctx.school.id, course, launch.moduleItemId, data);
    // the first import is a catch-up, not 89 pieces of news for the alerts and the daily report
    const firstImport = !getPlatformStatus(ctx.db, course.id, ACHIEVE)?.last_ok_at;
    for (const { row, category } of rows) {
      const { prev } = upsertItem(ctx.db, row);
      if (!firstImport) noteItemChange(ctx, prev, row);
      if (getItem(ctx.db, row.id)?.category_source !== 'user') setItemCategory(ctx.db, row.id, category, 'platform');
    }
    const keep = new Set(rows.map((r) => r.row.id));
    for (const r of all<{ id: string }>(ctx.db, 'SELECT id FROM items WHERE course_id = $courseId AND removed = 0 AND id LIKE $prefix', { courseId: course.id, prefix: `${ctx.school.id}:ach:%` })) {
      if (!keep.has(r.id)) run(ctx.db, 'UPDATE items SET removed = 1, updated_at = $now WHERE id = $id', { id: r.id, now: nowIso() });
    }
    recordPlatformRead(ctx.db, course.id, ACHIEVE, { ok: true, items: rows.length, at });
    return rows.length;
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err; // the Canvas login lapsed: the sync's own fallback handles that
    recordPlatformRead(ctx.db, course.id, ACHIEVE, { ok: false, error: errorText(err), at });
    throw err;
  }
}

export interface AchieveHosts { landing: RegExp; app: RegExp; api: string; gradebook: string }
const PRODUCTION: AchieveHosts = {
  landing: /^https:\/\/achieve\.macmillanlearning\.com\/courses\//,
  app: /^https:\/\/achieve\.macmillanlearning\.com\/.*\.js(\?|$)/,
  api: 'https://cw-services-live.macmillanlearning.com',
  gradebook: 'https://gradebook-api.macmillanlearning.com',
};

/** Follows the LTI launch in a throwaway headless Chrome, then reads the two lists with the session it got. */
export async function readAchieveInChrome(launchUrl: string, courseUuid: string, hosts: AchieveHosts = PRODUCTION, timeoutMs = 45_000): Promise<AchieveData> {
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chromeBin(), headless: true });
  try {
    const context = await browser.newContext({ userAgent: DEFAULT_USER_AGENT });
    // Achieve's web app writes things as it starts (enrollment checks…), so it is never run; the launch is plain navigation
    await context.route(hosts.app, (route) => route.abort());
    await context.route(/\.(png|jpe?g|gif|svg|webp|woff2?|ttf|css)(\?|$)/i, (route) => route.abort());
    const page = await context.newPage();
    await page.goto(launchUrl, { waitUntil: 'commit', timeout: timeoutMs });
    try {
      await page.waitForURL(hosts.landing, { timeout: timeoutMs });
    } catch {
      throw new Error(`没有进入 Achieve 课程页（停在 ${new URL(page.url()).host}）`);
    }
    const get = async (url: string): Promise<unknown> => {
      const res = await context.request.get(url, { headers: { Accept: 'application/json' }, timeout: timeoutMs });
      if (!res.ok()) throw new Error(`Achieve 返回 ${res.status()}（${new URL(url).pathname.split('/').slice(-2).join('/')}）`);
      return res.json();
    };
    const timeline = (await get(`${hosts.api}/api/v1/myCourse/${courseUuid}/timeline?pageSize=500&page=0`)) as { itemCount?: number; items?: Record<string, unknown>[] };
    const statuses = (await get(`${hosts.gradebook}/api/v1/courses/${courseUuid}/assignments/completion-statuses`)) as { assignmentCompletionStatuses?: { assignment_id: string; status: string | null }[] };
    if (!Array.isArray(timeline.items) || !Array.isArray(statuses.assignmentCompletionStatuses)) throw new Error('Achieve 返回的数据格式变了');
    if ((timeline.itemCount ?? 0) > timeline.items.length) throw new Error(`Achieve 只返回了 ${timeline.items.length}/${timeline.itemCount} 项，不按部分结果处理`);
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return {
      items: timeline.items.map((i) => ({
        id: String(i.id), name: String(i.name ?? ''), tool: String(i.tool ?? ''), points: typeof i.points === 'number' ? i.points : null,
        dueDate: str(i.dueDate), visibilityStartDate: str(i.visibilityStartDate), gradebookCategoryName: str(i.gradebookCategoryName),
      })),
      statuses: Object.fromEntries(statuses.assignmentCompletionStatuses.map((s) => [s.assignment_id, s.status ?? ''])),
    };
  } finally {
    await browser.close();
  }
}

export interface PlatformView {
  courseId: string; courseName: string; platform: string; ok: boolean; items: number;
  lastOkAt: string | null; lastTryAt: string | null; error: string | null; url: string;
}

/** Every visible course that runs work on a platform, with how its last read went (shown on Today and the status page). */
export function platformViews(db: DB): PlatformView[] {
  return listCourses(db).flatMap((c) => {
    const launch = findAchieveLaunch(db, c.id);
    if (!launch) return [];
    const st = getPlatformStatus(db, c.id, ACHIEVE);
    return [{
      courseId: c.id, courseName: courseDisplayName(c), platform: 'Achieve', ok: !!st?.last_ok_at && !st.error, items: st?.items ?? 0,
      lastOkAt: st?.last_ok_at ?? null, lastTryAt: st?.last_try_at ?? null, error: st ? st.error : '还没读取过',
      url: `${c.html_url}/modules/items/${launch.moduleItemId}`,
    }];
  });
}
