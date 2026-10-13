import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { getCourse, listCourses, updateCourseUser } from '../../db/courses.ts';
import { getFile, getPage, getTopic, listConversations, listFiles, listModuleItems, listModules, listPages, listTopics } from '../../db/content.ts';
import { getItem, listItems, listUndated } from '../../db/items.ts';
import { getSchool, listSchools } from '../../db/schools.ts';
import { all, one } from '../../db/sql.ts';
import type { CourseRow, ItemRow } from '../../db/types.ts';
import { makeTaskViewer } from '../../reports/data.ts';
import { currentWeek } from '../../weeks/build.ts';
import { courseDisplayName } from '../../util/course.ts';
import { enqueueSyllabus, syllabusState } from '../../ai/syllabus.ts';
import { HttpError, htmlRewriter, readJson } from './util.ts';

const WEEK = 7 * 86_400_000;

function publicCourse(c: CourseRow) {
  const { syllabus_html: _s, ...rest } = c;
  return { ...rest, display_name: courseDisplayName(c), tabs: c.tabs ? (JSON.parse(c.tabs) as string[]) : null };
}

function requireCourse(db: DB, id: string): CourseRow {
  const c = getCourse(db, id);
  if (!c) throw new HttpError(404, '课程不存在');
  return c;
}

function schoolBrief(db: DB, id: string) {
  const s = getSchool(db, id);
  return s ? { id: s.id, name: s.name, color: s.color, baseUrl: s.base_url } : null;
}

function courseItems(db: DB, courseId: string): ItemRow[] {
  return [...listItems(db, { courseId, includeHiddenCourses: true }), ...listUndated(db, courseId)];
}

export function registerCourses(app: Hono, db: DB): void {
  app.get('/api/courses', (c) => {
    const now = new Date();
    const view = makeTaskViewer(db, now);
    const courses = listCourses(db, { includeHidden: c.req.query('all') === '1' });
    return c.json(courses.map((course) => {
      const next = listItems(db, { courseId: course.id, from: now.toISOString(), includeHiddenCourses: true }).map(view).find((t) => t.status === 'todo' && t.kind !== 'event') ?? null;
      const fresh = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM topics WHERE course_id = $id AND kind = 'announcement'
          AND COALESCE(posted_at, first_seen_at) >= $since`, { id: course.id, since: new Date(now.getTime() - WEEK).toISOString() })?.n ?? 0;
      return { course: publicCourse(course), school: schoolBrief(db, course.school_id), nextDue: next, newAnnouncements: fresh, score: course.current_score, grade: course.current_grade };
    }));
  });

  app.patch('/api/courses/:id', async (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const body = await readJson<{ nickname?: string | null; color?: string | null; hidden?: boolean }>(c);
    if (body.color && !/^#[0-9a-f]{6}$/i.test(body.color)) throw new HttpError(400, '颜色格式应为 #RRGGBB');
    updateCourseUser(db, course.id, body);
    return c.json(publicCourse(getCourse(db, course.id)!));
  });

  app.get('/api/courses/:id', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const count = (sql: string) => one<{ n: number }>(db, sql, { id: course.id })?.n ?? 0;
    return c.json({
      course: publicCourse(course),
      school: schoolBrief(db, course.school_id),
      currentWeek: currentWeek(db, course.id, new Date()),
      counts: {
        assignments: count("SELECT COUNT(*) AS n FROM items WHERE course_id = $id AND removed = 0 AND kind IN ('assignment','quiz','discussion','manual')"),
        modules: count('SELECT COUNT(*) AS n FROM modules WHERE course_id = $id'),
        pages: count('SELECT COUNT(*) AS n FROM pages WHERE course_id = $id'),
        files: count('SELECT COUNT(*) AS n FROM files WHERE course_id = $id'),
        announcements: count("SELECT COUNT(*) AS n FROM topics WHERE course_id = $id AND kind = 'announcement'"),
        discussions: count("SELECT COUNT(*) AS n FROM topics WHERE course_id = $id AND kind = 'discussion'"),
      },
    });
  });

  app.get('/api/courses/:id/assignments', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const view = makeTaskViewer(db, new Date());
    return c.json(courseItems(db, course.id).filter((i) => i.kind !== 'event').map(view));
  });

  app.get('/api/courses/:id/modules', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const view = makeTaskViewer(db, new Date());
    const items = listModuleItems(db, course.id);
    return c.json(listModules(db, course.id).map((m) => ({
      module: m,
      items: items.filter((i) => i.module_id === m.id).map((i) => {
        let ref: Record<string, unknown> | null = null;
        const r = i.ref_id;
        if (r && /:(a|q):/.test(r)) {
          const it = getItem(db, r);
          if (it) {
            const t = view(it);
            ref = { kind: it.kind, id: it.id, status: t.status, dueAt: it.due_at };
          }
        } else if (r && r.includes(':f:')) {
          const f = getFile(db, r);
          if (f) ref = { kind: 'file', id: f.id, textStatus: f.text_status, size: f.size };
        } else if (r && r.includes(':p:')) {
          if (getPage(db, r)) ref = { kind: 'page', id: r };
        } else if (r && r.includes(':t:')) {
          const t = getTopic(db, r);
          if (t) ref = { kind: 'discussion', id: t.id };
        }
        return { ...i, ref };
      }),
    })));
  });

  app.get('/api/courses/:id/pages', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    return c.json(listPages(db, course.id).map(({ body_html: _b, ...p }) => p));
  });

  app.get('/api/pages/:id', (c) => {
    const page = getPage(db, c.req.param('id'));
    if (!page) throw new HttpError(404, '页面不存在');
    const course = getCourse(db, page.course_id)!;
    const rewrite = htmlRewriter(db, course.school_id);
    return c.json({ page: { ...page, body_html: rewrite(page.body_html) }, course: publicCourse(course) });
  });

  app.get('/api/courses/:id/files', (c) => c.json(listFiles(db, requireCourse(db, c.req.param('id')).id)));

  for (const kind of ['announcement', 'discussion'] as const) {
    app.get(`/api/courses/:id/${kind}s`, (c) => {
      const course = requireCourse(db, c.req.param('id'));
      const rewrite = htmlRewriter(db, course.school_id);
      return c.json(listTopics(db, course.id, kind).map((t) => ({ ...t, message_html: rewrite(t.message_html) })));
    });
  }

  app.get('/api/courses/:id/grades', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const view = makeTaskViewer(db, new Date());
    const graded = courseItems(db, course.id).filter((i) => ['assignment', 'quiz', 'discussion'].includes(i.kind));
    return c.json({
      score: course.current_score, grade: course.current_grade, htmlUrl: `${course.html_url}/grades`,
      items: graded.map((i) => ({ id: i.id, title: i.title, kind: i.kind, dueAt: i.due_at, points: i.points, score: i.score, grade: i.grade, status: view(i).status, htmlUrl: i.html_url, excused: !!i.excused })),
    });
  });

  app.get('/api/courses/:id/syllabus', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    const rewrite = htmlRewriter(db, course.school_id);
    return c.json({
      html: rewrite(course.syllabus_html),
      htmlUrl: `${course.html_url}/assignments/syllabus`,
      files: listFiles(db, course.id).filter((f) => /syllabus|schedule|calendar|大纲/i.test(f.name)),
      analysis: syllabusState(db, course.id),
    });
  });

  app.post('/api/courses/:id/analyze', (c) => {
    const course = requireCourse(db, c.req.param('id'));
    enqueueSyllabus(db, course.id, { force: true });
    return c.json({ status: 'queued' }, 202);
  });

  app.get('/api/inbox', (c) => {
    const schools = new Map(listSchools(db).map((s) => [s.id, s]));
    return c.json(listConversations(db, c.req.query('school')).map((cv) => ({ ...cv, schoolName: schools.get(cv.school_id)?.name ?? '', color: schools.get(cv.school_id)?.color ?? '#64748b' })));
  });

  app.get('/api/search-courses', (c) => c.json(all(db, 'SELECT id, name, code, nickname FROM courses WHERE active = 1 ORDER BY name')));
}
