import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { listItems } from '../../db/items.ts';
import { latestReport } from '../../db/reports.ts';
import { listSchools } from '../../db/schools.ts';
import { all } from '../../db/sql.ts';
import { makeTaskViewer } from '../../reports/data.ts';
import type { TaskView } from '../../reports/data.ts';
import { addDays, atLocal, localDateStr } from '../../util/time.ts';
import { courseDisplayName } from '../../util/course.ts';

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
    const schools = listSchools(db);
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
      announcements: latestAnnouncements(db, 10),
      latestDaily: latestReport(db, 'daily') ?? null,
      loginNeeded: schools.filter((s) => s.status === 'needs_login').map((s) => ({ id: s.id, name: s.name, statusDetail: s.status_detail })),
    });
  });
}
