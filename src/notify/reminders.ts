// Deadline and exam reminders: settings.reminderHours before each deadline (once per threshold; an item first
// seen late gets only the most urgent one). Exams say so; exams with only a date remind once, the evening
// before. Many deadlines at the same moment become one notice.
import { PORT } from '../config.ts';
import type { DB } from '../db/index.ts';
import { listItems } from '../db/items.ts';
import { all, run } from '../db/sql.ts';
import { getSettings } from '../db/settings.ts';
import { isExamLike, makeTaskViewer } from '../reports/data.ts';
import type { TaskView } from '../reports/data.ts';
import { taskLabel } from '../reports/prompt.ts';
import { addDays, atLocal, describeDue, localDateStr } from '../util/time.ts';
import { notify } from './mac.ts';
import type { Notice } from './mac.ts';

const HOUR = 3_600_000;
const EVE = 'eve'; // date-only items: the evening before (18:00) onwards

interface Due { task: TaskView; key: string; marks: string[]; exam: boolean }

function when(t: TaskView, now: Date): string {
  return describeDue(t.dueAt, now, { dateOnly: t.dueDateOnly });
}

function single(d: Due, now: Date): Notice {
  const t = d.task;
  const title = d.exam ? `考试：${when(t, now)}` : d.key !== EVE && Number(d.key) <= 6 ? `${d.key} 小时内截止` : `${when(t, now)} 截止`;
  return { kind: 'reminder', title, body: `${t.courseName ?? ''} · ${t.title}`, url: t.htmlUrl ?? `http://127.0.0.1:${PORT}/courses/${t.courseId ?? ''}` };
}

function grouped(key: string, ds: Due[], now: Date): Notice {
  const label = key === EVE ? `${when(ds[0].task, now)}截止` : `${key} 小时内截止`;
  const names = ds.slice(0, 3).map((d) => taskLabel(d.task)).join('、');
  return { kind: 'reminder', title: `${ds.length} 项 ${label}`, body: ds.length > 3 ? `${names} 等` : names, url: `http://127.0.0.1:${PORT}/deadlines` };
}

export async function runReminders(db: DB, now: Date): Promise<number> {
  const s = getSettings(db);
  if (!s.reminders) return 0;
  const hours = [...new Set(s.reminderHours.filter((h) => h > 0))].sort((a, b) => b - a);
  const horizon = Math.max(48, ...hours) + 24;
  const view = makeTaskViewer(db, now);
  const sent = new Set(all<{ item_id: string; threshold: string }>(db, 'SELECT item_id, threshold FROM reminders_sent').map((r) => `${r.item_id}|${r.threshold}`));

  const due: Due[] = [];
  for (const row of listItems(db, { from: now.toISOString(), to: new Date(now.getTime() + horizon * HOUR).toISOString() })) {
    const t = view(row);
    const exam = isExamLike(t.title, t.category);
    if (t.status !== 'todo' && !(t.status === 'event' && exam)) continue; // done, passed, or a plain calendar event
    if (t.dueDateOnly) {
      const evening = atLocal(addDays(localDateStr(new Date(t.dueAt!)), -1), 18, 0).getTime();
      if (now.getTime() >= evening && !sent.has(`${t.id}|${EVE}`)) due.push({ task: t, key: EVE, marks: [EVE], exam });
      continue;
    }
    const left = (Date.parse(t.dueAt!) - now.getTime()) / HOUR;
    const hit = hours.filter((h) => left <= h);
    if (left <= 0 || hit.length === 0) continue;
    const key = String(hit[hit.length - 1]);
    if (!sent.has(`${t.id}|${key}`)) due.push({ task: t, key, marks: hit.map(String), exam });
  }
  if (due.length === 0) return 0;

  const sentAt = now.toISOString();
  for (const d of due) for (const m of d.marks) {
    run(db, 'INSERT OR IGNORE INTO reminders_sent (item_id, threshold, sent_at) VALUES ($item, $m, $at)', { item: d.task.id, m, at: sentAt });
  }
  const notices: Notice[] = due.filter((d) => d.exam).map((d) => single(d, now));
  const byKey = new Map<string, Due[]>();
  for (const d of due.filter((x) => !x.exam)) byKey.set(d.key, [...(byKey.get(d.key) ?? []), d]);
  for (const [key, ds] of byKey) {
    if (ds.length <= 2) notices.push(...ds.map((d) => single(d, now)));
    else notices.push(grouped(key, ds, now));
  }
  for (const n of notices) await notify(n);
  return notices.length;
}
