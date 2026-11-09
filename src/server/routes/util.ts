import type { Context } from 'hono';
import { listCourses } from '../../db/courses.ts';
import { listPages } from '../../db/content.ts';
import type { DB } from '../../db/index.ts';
import { getSchool } from '../../db/schools.ts';
import { rewriteCanvasHtml } from '../../util/html.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJson<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, '请求内容不是有效的 JSON');
  }
}

/** Rewrites Canvas HTML of one school for in-app viewing (see util/html.ts). */
export function htmlRewriter(db: DB, schoolId: string): (html: string | null) => string | null {
  const school = getSchool(db, schoolId);
  if (!school) return (h) => h;
  const courses = listCourses(db, { schoolId, includeHidden: true, activeOnly: false });
  const courseMap = new Map(courses.map((c) => [c.canvas_id, c.id]));
  const pageMap = new Map<string, string>();
  for (const c of courses) for (const p of listPages(db, c.id)) pageMap.set(`${c.canvas_id}/${p.url}`, p.id);
  return (html) => (html === null ? null : rewriteCanvasHtml(html, { schoolId, baseUrl: school.base_url, courseMap, pageMap }));
}

export function isUrl(s: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(s).protocol);
  } catch {
    return false;
  }
}
