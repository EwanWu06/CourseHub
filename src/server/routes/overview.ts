import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { listItems } from '../../db/items.ts';
import { latestReport } from '../../db/reports.ts';
import { listCourses } from '../../db/courses.ts';
import { getGuide, listWeeks } from '../../db/study.ts';
import { currentWeek } from '../../weeks/build.ts';
import { listSchools } from '../../db/schools.ts';
import { all } from '../../db/sql.ts';
import { isExamLike, makeTaskViewer, undatedTasks } from '../../reports/data.ts';
import { headlineOf } from '../../reports/view.ts';
import type { AnyReport } from '../../reports/view.ts';
import type { TaskView } from '../../reports/data.ts';
import { addDays, atLocal, localDateStr, mondayOf } from '../../util/time.ts';
import { courseDisplayName } from '../../util/course.ts';
import { platformViews } from '../../platforms/achieve.ts';

const DAY = 86_400_000;
const actionable = (t: TaskView) => t.status === 'todo' || t.status === 'overdue' || t.status === 'missing';

export function latestAnnouncements(db: DB, limit: number, courseId?: string) {
  return all<{ id: string; title: string; posted_at: string | null; first_seen_at: string; html_url: string; course_id: string; name: string; code: string | null; nickname: string | null; color: string; school_name: string; message_html: string | null }>(db, `
    SELECT t.id, t.title, t.posted_at, t.first_seen_at, t.html_url, t.course_id, t.message_html,
           c.name, c.code, c.nickname, COALESCE(c.color, s.color) AS color, s.name AS school_name
    FROM topics t JOIN courses c ON c.id = t.course_id JOIN schools s ON s.id = c.school_id
    WHERE t.kind = 'announcement' AND c.hidden = 0 AND c.active = 1 ${courseId ? 'AND c.id = $courseId' : ''}
    ORDER BY COALESCE(t.posted_at, t.first_seen_at) DESC LIMIT $limit`, courseId ? { limit, courseId } : { limit })
    .map((a) => ({ id: a.id, title: a.title, postedAt: a.posted_at ?? a.first_seen_at, htmlUrl: a.html_url, courseId: a.course_id, courseName: courseDisplayName(a), color: a.color, schoolName: a.school_name }));
}

function dailyBrief(db: DB) {
  const row = latestReport(db, 'daily');
  if (!row) return null;
  let headline = '';
  try {
    headline = headlineOf(JSON.parse(row.content) as AnyReport);
  } catch {
    headline = '';
  }
  let blocks: { slot: string; title: string; minutes: number }[] = [];
  try {
    const r = JSON.parse(row.content) as { ai?: { blocks?: { slot: string; title: string; minutes: number }[] } | null };
    blocks = (r.ai?.blocks ?? []).slice(0, 5).map((b) => ({ slot: b.slot, title: b.title, minutes: b.minutes }));
  } catch {
    blocks = [];
  }
  return { id: row.id, type: row.type, period: row.period, createdAt: row.created_at, headline, blocks };
}

export function registerOverview(app: Hono, db: DB): void {
  app.get('/api/overview', (c) => {
    const now = new Date();
    const view = makeTaskViewer(db, now);
    const today = localDateStr(now);
    const t0 = atLocal(today, 0, 0).getTime();
    const t1 = atLocal(addDays(today, 1), 0, 0).getTime();
    const t4 = atLocal(addDays(today, 4), 0, 0).getTime();
    const tasks = listItems(db, { from: new Date(now.getTime() - 30 * DAY).toISOString(), to: new Date(t4).toISOString() }).map(view);
    const due = (t: TaskView) => Date.parse(t.dueAt!);
    const todayList = tasks.filter((t) => due(t) >= t0 && due(t) < t1);
    const next3 = tasks.filter((t) => due(t) >= t1 && due(t) < t4);
    const overdue = tasks.filter((t) => due(t) < t0 && (t.status === 'overdue' || t.status === 'missing'));
    const exams = listItems(db, { from: now.toISOString(), to: new Date(now.getTime() + 30 * DAY).toISOString() })
      .filter((i) => i.category === 'exam').map(view).filter((t) => t.status !== 'done');
    const schools = listSchools(db);

    // the work to hand in over the next 7 days (exams have their own list), plus anything overdue
    const t8 = atLocal(addDays(today, 8), 0, 0).getTime();
    const tWeek = atLocal(addDays(mondayOf(today), 7), 0, 0).getTime();
    const homework = listItems(db, { from: new Date(now.getTime() - 30 * DAY).toISOString(), to: new Date(t8).toISOString() })
      .map(view)
      .filter((t) => t.kind !== 'event' && !isExamLike(t.title, t.category))
      .filter((t) => due(t) >= t0 || t.status === 'overdue' || t.status === 'missing');
    const weekOpen = homework.filter((t) => actionable(t) && due(t) < tWeek);

    const schoolColor = new Map(schools.map((s) => [s.id, s.color]));
    const study = listCourses(db).flatMap((course) => {
      const week = currentWeek(db, course.id, now);
      const row = week ? listWeeks(db, course.id).find((w) => w.week === week) : undefined;
      if (!week || !row) return [];
      return [{
        courseId: course.id, courseName: courseDisplayName(course), color: course.color ?? schoolColor.get(course.school_id) ?? '#888',
        week, title: row.title, topics: (JSON.parse(row.topics) as string[]).slice(0, 3), guide: getGuide(db, course.id, week)?.status ?? null,
      }];
    });

    return c.json({
      now: now.toISOString(),
      schools: schools.map((s) => ({ id: s.id, name: s.name, color: s.color, status: s.status, statusDetail: s.status_detail, lastSyncAt: s.last_sync_at, userName: s.user_name })),
      counts: {
        overdue: overdue.length,
        today: todayList.filter(actionable).length,
        next3: next3.filter(actionable).length,
        missing: tasks.filter((t) => t.status === 'missing').length,
      },
      today: todayList,
      next3,
      overdue,
      exams,
      homework,
      week: { open: weekOpen.length, minutes: weekOpen.reduce((n, t) => n + t.estMinutes, 0) },
      study,
      announcements: latestAnnouncements(db, 10),
      platforms: platformViews(db),
      undated: undatedTasks(db, now).length,
      latestDaily: dailyBrief(db),
      loginNeeded: schools.filter((s) => s.status === 'needs_login').map((s) => ({ id: s.id, name: s.name, statusDetail: s.status_detail })),
    });
  });
}
