// Canvas calendar feed (.ics). Needs no login and never expires, so it is the deadline fallback
// whenever a school's browser session has lapsed.
import ICAL from 'ical.js';

export interface IcsEvent {
  uid: string;
  kind: 'assignment' | 'event' | 'other';
  canvasId: string | null;
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

export function parseIcs(text: string): IcsEvent[] {
  const root = new ICAL.Component(ICAL.parse(text));
  return root.getAllSubcomponents('vevent').map((vevent) => {
    const ev = new ICAL.Event(vevent);
    const uid = String(ev.uid ?? '');
    const urlValue = vevent.getFirstPropertyValue('url');
    const url = urlValue ? String(urlValue) : null;
    let kind: IcsEvent['kind'] = 'other';
    let canvasId: string | null = null;
    if (uid.startsWith('event-assignment')) {
      kind = 'assignment';
      canvasId = url?.match(/\/assignments\/(\d+)/)?.[1] ?? uid.match(/(\d+)$/)?.[1] ?? null;
    } else if (uid.startsWith('event-calendar-event')) {
      kind = 'event';
      canvasId = uid.match(/(\d+)$/)?.[1] ?? null;
    }
    const { title, courseLabel } = splitTitle(String(ev.summary ?? ''));
    const description = ev.description ? String(ev.description).trim() : null;
    return {
      uid,
      kind,
      canvasId,
      courseCanvasId: courseFromUrl(url),
      title,
      courseLabel,
      start: ev.startDate.toJSDate().toISOString(),
      end: vevent.hasProperty('dtend') ? ev.endDate.toJSDate().toISOString() : null,
      allDay: ev.startDate.isDate,
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
