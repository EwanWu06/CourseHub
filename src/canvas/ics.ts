// Canvas calendar feed (.ics). Needs no login and never expires, so it is the deadline fallback
// whenever a school's browser session has lapsed.
import ICAL from 'ical.js';

export interface IcsEvent {
  uid: string;
  kind: 'assignment' | 'event' | 'other';
  canvasId: string | null;
  /** event-sub-assignment-*: which checkpoint of a checkpointed discussion (canvasId is the discussion's assignment) */
  checkpoint: 'reply_to_topic' | 'reply_to_entry' | null;
  courseCanvasId: string | null;
  title: string;
  courseLabel: string | null;
  start: string;
  end: string | null;
  allDay: boolean;
  url: string | null;
  description: string | null;
}

function splitTitle(summary: string): { title: string; courseLabel: string | null } {
  const m = summary.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  return m ? { title: m[1].trim(), courseLabel: m[2].trim() } : { title: summary.trim(), courseLabel: null };
}

function courseFromUrl(url: string | null): string | null {
  if (!url) return null;
  return url.match(/\/courses\/(\d+)/)?.[1] ?? url.match(/include_contexts=course_(\d+)/)?.[1] ?? null;
}

const CHECKPOINT_SUFFIX: [RegExp, 'reply_to_topic' | 'reply_to_entry'][] = [
  [/\s+Reply to Topic$/i, 'reply_to_topic'],
  [/\s+Required Replies \(\d+\)$/i, 'reply_to_entry'],
];

export function parseIcs(text: string): IcsEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  return root.getAllSubcomponents('vevent').map((vevent) => {
    const ev = new ICAL.Event(vevent);
    const uid = String(ev.uid ?? '');
    const urlValue = vevent.getFirstPropertyValue('url');
    const url = urlValue ? String(urlValue) : null;
    // real feeds link to the calendar (".../calendar?include_contexts=course_1&month=09#assignment_42"); older ones to the assignment
    const linked = url?.match(/#assignment_(\d+)/)?.[1] ?? url?.match(/\/assignments\/(\d+)/)?.[1] ?? null;
    let { title, courseLabel } = splitTitle(String(ev.summary ?? ''));
    let kind: IcsEvent['kind'] = 'other';
    let canvasId: string | null = null;
    let checkpoint: IcsEvent['checkpoint'] = null;
    if (uid.startsWith('event-assignment-override-')) {
      // the student's own section/group date; the number in the UID is the override's id, not the assignment's
      kind = linked ? 'assignment' : 'other';
      canvasId = linked;
      title = title.replace(/\s*\(\d+ students?\)$/i, '');
    } else if (uid.startsWith('event-sub-assignment-')) {
      const rule = CHECKPOINT_SUFFIX.find(([re]) => re.test(title));
      if (rule && linked) {
        kind = 'assignment';
        canvasId = linked;
        checkpoint = rule[1];
        title = title.replace(rule[0], '');
      }
    } else if (uid.startsWith('event-assignment')) {
      kind = 'assignment';
      canvasId = linked ?? uid.match(/(\d+)$/)?.[1] ?? null;
    } else if (uid.startsWith('event-calendar-event')) {
      kind = 'event';
      canvasId = uid.match(/(\d+)$/)?.[1] ?? null;
    }
    const description = ev.description ? String(ev.description).trim() : null;
    const allDay = ev.startDate.isDate;
    // Canvas writes 11:59 PM deadlines as all-day dates: the work is due at the end of that day, not at midnight
    const start = allDay && kind === 'assignment'
      ? new Date(ev.startDate.year, ev.startDate.month - 1, ev.startDate.day, 23, 59, 59).toISOString()
      : ev.startDate.toJSDate().toISOString();
    return {
      uid,
      kind,
      canvasId,
      checkpoint,
      courseCanvasId: courseFromUrl(url),
      title,
      courseLabel,
      start,
      end: vevent.hasProperty('dtend') ? ev.endDate.toJSDate().toISOString() : null,
      allDay,
      url,
      description: description || null,
    };
  });
}

export async function fetchIcs(url: string, fetchImpl: typeof fetch = fetch): Promise<IcsEvent[]> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/calendar' } });
  if (!res.ok) throw new Error(`日历订阅下载失败 (${res.status})`);
  return parseIcs(await res.text());
}
