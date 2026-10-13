// Pure week logic: week 1 starts on the Monday of the course (or term) start; modules are mapped to
// weeks by their name, then unlock date, then the due dates of what they contain.
import { addDays, daysBetween, localDateStr, mondayOf } from '../util/time.ts';

const MAX_WEEK = 30;

function range(a: number, b?: number): { start: number; end: number } | null {
  const start = a;
  const end = b ?? a;
  if (start < 1 || end > MAX_WEEK || end < start || end - start > 4) return null;
  return { start, end };
}

export function parseWeekRange(name: string): { start: number; end: number } | null {
  const zh = name.match(/第\s*(\d{1,2})\s*(?:[-–—~到至]\s*(\d{1,2}))?\s*周/);
  if (zh) return range(Number(zh[1]), zh[2] ? Number(zh[2]) : undefined);
  const en = name.match(/\b(?:weeks?|wk)\s*0*(\d{1,2})(?:\s*(?:-|–|—|&|and|to|\/)\s*(?:weeks?|wk)?\s*0*(\d{1,2}))?(?!\d)/i);
  if (en) return range(Number(en[1]), en[2] ? Number(en[2]) : undefined);
  const w = name.match(/^\s*W\s?0*(\d{1,2})\b/i);
  if (w) return range(Number(w[1]));
  return null;
}

export function inferWeek1(i: { courseStart: string | null; termStart: string | null; dates: string[] }): string | null {
  const official = i.courseStart ?? i.termStart;
  if (official) {
    // Courses that officially start on a Saturday/Sunday really begin the following Monday.
    const day = new Date(official).getDay();
    const monday = mondayOf(official);
    return day === 0 || day === 6 ? addDays(monday, 7) : monday;
  }
  const first = [...i.dates].sort()[0];
  return first ? mondayOf(first) : null;
}

export function weekOf(week1: string, iso: string): number {
  return Math.floor(daysBetween(week1, localDateStr(new Date(iso))) / 7) + 1;
}

export interface ModuleWeekInput { id: string; name: string; unlockAt: string | null; dueDates: string[] }
export interface ModuleWeek { start: number | null; end: number | null; source: 'name' | 'unlock' | 'due' | 'none' }

export function assignModuleWeeks(mods: ModuleWeekInput[], week1: string | null): Map<string, ModuleWeek> {
  const out = new Map<string, ModuleWeek>();
  for (const m of mods) {
    const named = parseWeekRange(m.name);
    if (named) {
      out.set(m.id, { ...named, source: 'name' });
      continue;
    }
    if (week1 && m.unlockAt) {
      const w = weekOf(week1, m.unlockAt);
      if (w >= 1 && w <= MAX_WEEK) {
        out.set(m.id, { start: w, end: w, source: 'unlock' });
        continue;
      }
    }
    if (week1 && m.dueDates.length) {
      const weeks = m.dueDates.map((d) => weekOf(week1, d)).filter((w) => w >= 1 && w <= MAX_WEEK).sort((a, b) => a - b);
      if (weeks.length) {
        const lo = weeks[0];
        const hi = weeks[weeks.length - 1];
        if (hi - lo <= 1) out.set(m.id, { start: lo, end: hi, source: 'due' });
        else {
          const median = weeks[Math.floor((weeks.length - 1) / 2)];
          out.set(m.id, { start: median, end: median, source: 'due' });
        }
        continue;
      }
    }
    out.set(m.id, { start: null, end: null, source: 'none' });
  }
  return out;
}

/**
 * Corrects week 1 using dated work inside "Week N" modules: each due date implies a week-1 Monday; if at least
 * two samples and half of them agree on one Monday, that wins (term dates are often earlier than the class).
 */
export function calibrateWeek1(week1: string | null, samples: { week: number; due: string }[]): string | null {
  if (samples.length < 2) return week1;
  const votes = new Map<string, number>();
  for (const s of samples) {
    const implied = addDays(mondayOf(s.due), -7 * (s.week - 1));
    votes.set(implied, (votes.get(implied) ?? 0) + 1);
  }
  const [best, count] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
  return count >= 2 && count >= samples.length / 2 ? best : week1;
}
