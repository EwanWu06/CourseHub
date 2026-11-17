// One search box for everything: tasks/exams, courses, files, pages, announcements and discussions.
import { EFFECTIVE_DUE_SQL } from '../../db/items.ts';
import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { all } from '../../db/sql.ts';
import type { CourseRow, ItemRow } from '../../db/types.ts';
import { makeTaskViewer } from '../../reports/data.ts';
import { courseDisplayName } from '../../util/course.ts';

type CourseBits = { name: string; code: string | null; nickname: string | null };

export function registerSearch(app: Hono, db: DB): void {
  app.get('/api/search', (c) => {
    const q = (c.req.query('q') ?? '').trim().slice(0, 100);
    if (!q) return c.json({ q, groups: [] });
    const like = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    const visible = 'c.hidden = 0 AND c.active = 1';
    const view = makeTaskViewer(db, new Date());

    const tasks = all<ItemRow>(db, `SELECT i.* FROM items i LEFT JOIN courses c ON c.id = i.course_id
        WHERE i.removed = 0 AND (c.id IS NULL OR (${visible})) AND i.title LIKE $like ESCAPE '\\'
        ORDER BY ${EFFECTIVE_DUE_SQL} IS NULL, abs(julianday(${EFFECTIVE_DUE_SQL}) - julianday('now')) LIMIT 10`, { like })
      .map(view);
    const courses = all<CourseRow & { school_name: string }>(db, `SELECT c.*, s.name AS school_name FROM courses c JOIN schools s ON s.id = c.school_id
        WHERE ${visible} AND (c.name LIKE $like ESCAPE '\\' OR c.code LIKE $like ESCAPE '\\' OR c.nickname LIKE $like ESCAPE '\\') LIMIT 6`, { like })
      .map((x) => ({ id: x.id, displayName: courseDisplayName(x), name: x.name, schoolName: x.school_name, color: x.color }));
    const files = all<{ id: string; file_name: string; html_url: string; course_id: string } & CourseBits>(db, `SELECT f.id, f.name AS file_name, f.html_url, f.course_id, c.name, c.code, c.nickname
        FROM files f JOIN courses c ON c.id = f.course_id WHERE ${visible} AND f.name LIKE $like ESCAPE '\\' ORDER BY f.updated_at DESC LIMIT 8`, { like });
    const pages = all<{ id: string; title: string; html_url: string; course_id: string } & CourseBits>(db, `SELECT p.id, p.title, p.html_url, p.course_id, c.name, c.code, c.nickname
        FROM pages p JOIN courses c ON c.id = p.course_id WHERE ${visible} AND p.title LIKE $like ESCAPE '\\' ORDER BY p.updated_at DESC LIMIT 8`, { like });
    const topics = all<{ id: string; title: string; kind: string; html_url: string; course_id: string } & CourseBits>(db, `SELECT t.id, t.title, t.kind, t.html_url, t.course_id, c.name, c.code, c.nickname
        FROM topics t JOIN courses c ON c.id = t.course_id WHERE ${visible} AND t.title LIKE $like ESCAPE '\\'
        ORDER BY COALESCE(t.posted_at, t.first_seen_at) DESC LIMIT 8`, { like });

    const groups = [
      { kind: 'tasks', items: tasks },
      { kind: 'courses', items: courses },
      { kind: 'files', items: files.map((f) => ({ id: f.id, name: f.file_name, htmlUrl: f.html_url, courseId: f.course_id, courseName: courseDisplayName(f) })) },
      { kind: 'pages', items: pages.map((p) => ({ id: p.id, title: p.title, htmlUrl: p.html_url, courseId: p.course_id, courseName: courseDisplayName(p) })) },
      { kind: 'topics', items: topics.map((t) => ({ id: t.id, title: t.title, kind: t.kind, htmlUrl: t.html_url, courseId: t.course_id, courseName: courseDisplayName(t) })) },
    ].filter((g) => g.items.length > 0);
    return c.json({ q, groups });
  });
}
