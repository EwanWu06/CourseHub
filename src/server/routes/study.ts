import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { getCourse, listCourses } from '../../db/courses.ts';
import { getItem } from '../../db/items.ts';
import { listModules } from '../../db/content.ts';
import { getSchool } from '../../db/schools.ts';
import { getGuide, listGuides, listWeeks } from '../../db/study.ts';
import type { CourseRow } from '../../db/types.ts';
import { aiQueue } from '../../ai/claude.ts';
import { buildGuideInput } from '../../ai/guideInput.ts';
import { enqueueGuide } from '../../ai/guide.ts';
import { makeTaskViewer } from '../../reports/data.ts';
import { courseDisplayName } from '../../util/course.ts';
import { currentWeek, lastWeek } from '../../weeks/build.ts';
import { HttpError, readJson } from './util.ts';

function schoolBrief(db: DB, id: string) {
  const s = getSchool(db, id);
  return s ? { id: s.id, name: s.name, color: s.color } : null;
}

function brief(c: CourseRow) {
  const { syllabus_html: _s, ...rest } = c;
  return { ...rest, display_name: courseDisplayName(c), tabs: c.tabs ? (JSON.parse(c.tabs) as string[]) : null };
}

export function registerStudy(app: Hono, db: DB, deps: { enqueueGuide?: (courseId: string, week: number, force: boolean) => boolean } = {}): void {
  const enqueue = deps.enqueueGuide ?? ((courseId, week, force) => enqueueGuide(db, courseId, week, { force }));
  const requireCourse = (id: string) => {
    const c = getCourse(db, id);
    if (!c) throw new HttpError(404, '课程不存在');
    return c;
  };

  app.get('/api/study', (c) => {
    const now = new Date();
    return c.json(listCourses(db).map((course) => {
      return {
        course: brief(course), school: schoolBrief(db, course.school_id),
        currentWeek: currentWeek(db, course.id, now), lastWeek: lastWeek(db, course.id),
        ready: listGuides(db, course.id).filter((g) => g.status === 'ready').length,
      };
    }));
  });

  app.get('/api/study/:courseId', (c) => {
    const course = requireCourse(c.req.param('courseId'));
    const guides = new Map(listGuides(db, course.id).map((g) => [g.week, g]));
    return c.json({
      course: brief(course),
      school: schoolBrief(db, course.school_id),
      currentWeek: currentWeek(db, course.id, new Date()),
      weeks: listWeeks(db, course.id).map((w) => {
        const input = buildGuideInput(db, course.id, w.week);
        const g = guides.get(w.week);
        return {
          week: w.week, startDate: w.start_date, title: w.title, topics: JSON.parse(w.topics) as string[],
          materialCount: input.materials.length + input.assignments.length,
          guide: g ? { status: g.status, stale: g.status === 'ready' && g.input_hash !== input.hash, generatedAt: g.generated_at, error: g.error } : null,
        };
      }),
      undatedModules: listModules(db, course.id).filter((m) => m.week_start === null).map((m) => ({ id: m.id, name: m.name })),
    });
  });

  app.get('/api/study/:courseId/:week', (c) => {
    const course = requireCourse(c.req.param('courseId'));
    const week = Number(c.req.param('week'));
    if (!Number.isInteger(week) || !listWeeks(db, course.id).some((w) => w.week === week)) throw new HttpError(404, '没有这一周');
    const input = buildGuideInput(db, course.id, week);
    const g = getGuide(db, course.id, week);
    const view = makeTaskViewer(db, new Date());
    return c.json({
      course: brief(course), school: schoolBrief(db, course.school_id), week, startDate: input.startDate, endDate: input.endDate, topics: input.topics, moduleNames: input.moduleNames,
      materials: input.materials.map((m) => ({ id: m.id, kind: m.kind, title: m.title, url: m.url, pages: m.pages, scanned: m.scanned, hasText: m.text.length > 0 })),
      assignments: input.assignments.map((a) => getItem(db, a.id)).filter((x) => !!x).map((x) => view(x!)),
      guide: {
        status: g?.status ?? null, generatedAt: g?.generated_at ?? null, error: g?.error ?? null, model: g?.model ?? null,
        stale: !!g && g.status === 'ready' && g.input_hash !== input.hash,
        queued: aiQueue.has(`guide:${course.id}#${week}`),
        content: g?.content ? JSON.parse(g.content) : null,
      },
    });
  });

  app.post('/api/study/:courseId/:week/generate', async (c) => {
    const course = requireCourse(c.req.param('courseId'));
    const week = Number(c.req.param('week'));
    if (!Number.isInteger(week)) throw new HttpError(400, '周数不对');
    const body = await readJson<{ force?: boolean }>(c).catch(() => ({ force: false }));
    const started = enqueue(course.id, week, !!body.force);
    return c.json({ queued: started }, 202);
  });
}
