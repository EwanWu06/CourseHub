// Everything a weekly study guide is written from: this week's modules (slides text with page markers,
// pages, links), the work due this week and announcements posted this week.
import type { DB } from '../db/index.ts';
import { getCourse } from '../db/courses.ts';
import { getFile, getPage, getTopic, listModuleItems, listModules, listTopics } from '../db/content.ts';
import { checkpointsOf, getItem, listItems } from '../db/items.ts';
import { listWeeks } from '../db/study.ts';
import { loadText } from '../content/textstore.ts';
import { courseDisplayName } from '../util/course.ts';
import { sha256 } from '../util/hash.ts';
import { htmlToText } from '../util/html.ts';
import { addDays, atLocal } from '../util/time.ts';

export interface Material {
  id: string; kind: 'file' | 'page' | 'assignment' | 'announcement' | 'link'; title: string; url: string | null; text: string;
  pages: number | null; scanned: boolean; fileId?: string;
}

export interface GuideInput {
  courseId: string; courseName: string; schoolId: string; week: number; startDate: string; endDate: string; moduleNames: string[];
  topics: string[]; materials: Material[]; assignments: { id: string; title: string; points: number | null; description: string }[];
  hash: string; totalChars: number;
}

export function buildGuideInput(db: DB, courseId: string, week: number): GuideInput {
  const course = getCourse(db, courseId);
  if (!course) throw new Error(`课程不存在: ${courseId}`);
  const weekRow = listWeeks(db, courseId).find((w) => w.week === week);
  const startDate = weekRow?.start_date ?? (course.week1 ? addDays(course.week1, 7 * (week - 1)) : '');
  const endDate = startDate ? addDays(startDate, 6) : '';
  const modules = listModules(db, courseId).filter((m) => m.week_start !== null && m.week_start <= week && (m.week_end ?? m.week_start) >= week);
  const moduleIds = new Set(modules.map((m) => m.id));
  const materials: Material[] = [];
  const seen = new Set<string>();
  const assignments: GuideInput['assignments'] = [];
  const addAssignment = (id: string) => {
    const direct = getItem(db, id);
    // a checkpointed discussion lives on as its checkpoint tasks (initial post, replies)
    const targets = direct && !direct.removed ? [direct] : checkpointsOf(db, id);
    for (const it of targets) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      assignments.push({ id: it.id, title: it.title, points: it.points, description: htmlToText(it.description_html ?? '').slice(0, 1500) });
    }
  };

  for (const mi of listModuleItems(db, courseId).filter((i) => moduleIds.has(i.module_id))) {
    const ref = mi.ref_id;
    if (ref && ref.includes(':f:') && !seen.has(ref)) {
      seen.add(ref);
      const f = getFile(db, ref);
      const t = loadText(ref);
      const text = t?.pages.length ? t.pages.map((p, i) => `[第${i + 1}页]\n${p}`).join('\n\n') : '';
      materials.push({ id: ref, kind: 'file', title: f?.name ?? mi.title, url: f?.html_url ?? mi.html_url, text, pages: t?.pages.length ?? null, scanned: !!t?.scanned || f?.text_status === 'empty', fileId: ref });
    } else if (ref && ref.includes(':p:') && !seen.has(ref)) {
      seen.add(ref);
      const p = getPage(db, ref);
      if (p) materials.push({ id: ref, kind: 'page', title: p.title, url: p.html_url, text: htmlToText(p.body_html ?? ''), pages: null, scanned: false });
    } else if (ref && /:(a|q):/.test(ref)) {
      addAssignment(ref);
    } else if (ref && ref.includes(':t:')) {
      const t = getTopic(db, ref);
      if (t?.assignment_item_id) addAssignment(t.assignment_item_id);
      else if (t && !seen.has(t.id)) {
        seen.add(t.id);
        materials.push({ id: t.id, kind: 'page', title: t.title, url: t.html_url, text: htmlToText(t.message_html ?? ''), pages: null, scanned: false });
      }
    } else if ((mi.type === 'ExternalUrl' || mi.type === 'ExternalTool') && !seen.has(mi.id)) {
      seen.add(mi.id);
      materials.push({ id: mi.id, kind: 'link', title: mi.title, url: mi.external_url ?? mi.html_url, text: '', pages: null, scanned: false });
    }
  }

  if (startDate) {
    const from = atLocal(startDate, 0, 0).toISOString();
    const to = atLocal(addDays(startDate, 7), 0, 0).toISOString();
    for (const it of listItems(db, { courseId, from, to, includeHiddenCourses: true })) if (it.kind !== 'event' && it.kind !== 'note') addAssignment(it.id);
    for (const a of listTopics(db, courseId, 'announcement')) {
      if (a.posted_at && a.posted_at >= from && a.posted_at < to && !seen.has(a.id)) {
        seen.add(a.id);
        materials.push({ id: a.id, kind: 'announcement', title: a.title, url: a.html_url, text: htmlToText(a.message_html ?? ''), pages: null, scanned: false });
      }
    }
  }

  const topics = weekRow ? (JSON.parse(weekRow.topics) as string[]) : [];
  const hash = sha256(JSON.stringify({ m: materials.map((m) => [m.id, m.text]), a: assignments.map((a) => [a.id, a.title, a.description]), t: topics }));
  return {
    courseId, courseName: `${courseDisplayName(course)} — ${course.name}`, schoolId: course.school_id, week, startDate, endDate,
    moduleNames: modules.map((m) => m.name), topics, materials, assignments, hash,
    totalChars: materials.reduce((n, m) => n + m.text.length, 0),
  };
}
