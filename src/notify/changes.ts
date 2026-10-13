// Alerts right after a sync: a deadline moved earlier, a new item due within 48 h, a new announcement. At most
// three notices per flush, the rest summarised in one. Everything pending is marked notified (first-sync
// changes are stored already notified, so they never alert).
import { PORT } from '../config.ts';
import { markNotified, pendingChanges } from '../db/changes.ts';
import { getTopic } from '../db/content.ts';
import { listCourses } from '../db/courses.ts';
import type { DB } from '../db/index.ts';
import { getItem } from '../db/items.ts';
import { getSettings } from '../db/settings.ts';
import { makeTaskViewer } from '../reports/data.ts';
import { courseDisplayName } from '../util/course.ts';
import { describeDue } from '../util/time.ts';
import { notify } from './mac.ts';
import type { Notice } from './mac.ts';

const HOME = `http://127.0.0.1:${PORT}/`;
const MAX_SHOWN = 3;

export async function flushChangeNotices(db: DB, now: Date = new Date()): Promise<number> {
  const pending = pendingChanges(db);
  if (pending.length === 0) return 0;
  markNotified(db, pending.map((c) => c.id));
  if (!getSettings(db).notifyChanges) return 0;

  const courses = new Map(listCourses(db).map((c) => [c.id, courseDisplayName(c)]));
  const view = makeTaskViewer(db, now);
  const found: { rank: number; notice: Notice; label: string }[] = [];
  for (const ch of pending) {
    if (ch.course_id && !courses.has(ch.course_id)) continue; // hidden course
    const course = (ch.course_id && courses.get(ch.course_id)) || '';
    let data: { from?: string | null; to?: string | null; due_at?: string | null } = {};
    try {
      data = JSON.parse(ch.data) as typeof data;
    } catch {
      data = {};
    }
    if (ch.kind === 'due_changed' || ch.kind === 'new_item') {
      const row = getItem(db, ch.ref_id);
      if (!row || row.removed) continue;
      const t = view(row);
      if (t.status === 'done') continue;
      const label = `${course} ${t.title}`.trim();
      if (ch.kind === 'due_changed') {
        if (!data.from || !data.to || Date.parse(data.to) >= Date.parse(data.from)) continue;
        found.push({ rank: 0, label, notice: { title: '截止时间提前了', body: `${label}：${describeDue(data.from, now)} → ${describeDue(data.to, now)}`, url: t.htmlUrl ?? HOME } });
      } else {
        const due = row.due_at ?? data.due_at;
        const ms = due ? Date.parse(due) - now.getTime() : -1;
        if (!due || ms < 0 || ms > 48 * 3_600_000) continue;
        found.push({ rank: 1, label, notice: { title: '新作业 · 48 小时内截止', body: `${label} · ${describeDue(due, now)}`, url: t.htmlUrl ?? HOME } });
      }
    } else if (ch.kind === 'announcement') {
      const topic = getTopic(db, ch.ref_id);
      if (!topic) continue;
      found.push({ rank: 2, label: `${course}：${topic.title}`, notice: { title: `新公告 · ${course}`, body: topic.title, url: topic.html_url } });
    }
  }
  found.sort((a, b) => a.rank - b.rank);
  const shown = found.slice(0, MAX_SHOWN);
  const rest = found.slice(MAX_SHOWN);
  for (const f of shown) await notify(f.notice);
  if (rest.length) await notify({ title: `还有 ${rest.length} 条更新`, body: rest.slice(0, 3).map((f) => f.label).join('；'), url: HOME });
  return shown.length + (rest.length ? 1 : 0);
}
