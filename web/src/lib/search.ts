// Turns /api/search groups into one keyboard-navigable list of places to go.
import { fmtDue } from '../format.ts';

export interface SearchGroup { kind: string; items: Record<string, unknown>[] }
export interface SearchEntry { key: string; group: string; title: string; sub: string; color?: string; target: { internal: string } | { external: string } }

const LABEL: Record<string, string> = { tasks: '作业和考试', courses: '课程', files: '文件', pages: '页面', topics: '公告和讨论' };

export function searchEntries(res: { groups: SearchGroup[] }, now: Date = new Date()): SearchEntry[] {
  const out: SearchEntry[] = [];
  const line = (...parts: unknown[]) => parts.filter((p) => p !== null && p !== undefined && p !== '').map(String).join(' · ');
  for (const g of res.groups) {
    for (const raw of g.items) {
      const x = raw as Record<string, string | boolean | null | undefined>;
      const group = LABEL[g.kind] ?? g.kind;
      const key = `${g.kind}:${String(x.id)}`;
      const color = (x.color as string | undefined) ?? undefined;
      if (g.kind === 'tasks') {
        const due = x.dueAt ? fmtDue(x.dueAt as string, now, { dateOnly: !!x.dueDateOnly }) : '无截止日期';
        out.push({ key, group, title: String(x.title), sub: line(x.courseName, due), color, target: x.htmlUrl ? { external: String(x.htmlUrl) } : { internal: '/deadlines' } });
      } else if (g.kind === 'courses') {
        out.push({ key, group, title: String(x.displayName), sub: line(x.name, x.schoolName), color, target: { internal: `/courses/${x.id}` } });
      } else if (g.kind === 'files') {
        out.push({ key, group, title: String(x.name), sub: String(x.courseName ?? ''), target: { external: String(x.htmlUrl) } });
      } else if (g.kind === 'pages') {
        out.push({ key, group, title: String(x.title), sub: String(x.courseName ?? ''), target: { internal: `/courses/${x.courseId}/pages/${encodeURIComponent(String(x.id))}` } });
      } else if (g.kind === 'topics') {
        out.push({ key, group, title: String(x.title), sub: line(x.courseName, x.kind === 'announcement' ? '公告' : '讨论'), target: { internal: `/courses/${x.courseId}/${x.kind === 'announcement' ? 'announcements' : 'discussions'}` } });
      }
    }
  }
  return out;
}
