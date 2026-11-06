// What an assignment's own instructions say it takes: how many posts and replies a discussion needs, an earlier
// deadline for the first post, length, and one-shot / in-lab rules. Deterministic: every finding carries the
// teacher's sentence it came from, so the page can show why — nothing here is guessed.
import { addDays, atLocal, localDateStr } from '../util/time.ts';

export interface Found<T> { value: T; quote: string }
/** A first-post deadline as written: a weekday ("Initial Post Due Thursday") or a date (YYYY-MM-DD, or MM-DD with no year). */
export type DueRef = { weekday: number; time: string | null } | { date: string; time: string | null };

export interface InstructionFindings {
  posts?: Found<number>;
  replies?: Found<number>;
  /** "two different classmates": replies to the same person count once */
  repliesDistinct: boolean;
  postDue?: Found<DueRef>;
  words?: Found<{ min: number; max: number | null }>;
  oneAttempt?: Found<true>;
  inPerson?: Found<true>;
  /** peer reviews asked for ("Three thoughtful peer reviews", "reviewing three rough drafts") */
  reviews?: Found<number>;
}

const WORD_NUM: Record<string, number> = {
  a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twice: 2, thrice: 3,
};
const NUM = '(\\d{1,2}|an?|one|single|two|three|four|five|six|seven|eight|nine|ten)';
const NUM_NO_ARTICLE = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
const AT_LEAST = '(?:at\\s+least\\s+|a\\s+minimum\\s+of\\s+|minimum\\s+of\\s+|no\\s+fewer\\s+than\\s+)?';
const TARGET = "(?:(?:other|different|fellow|your|the|their)\\s+)*(?:students?|classmates?|peers?|colleagues?|others|posts?|people|group\\s+members|teammates|learners|entries|responses|threads)\\b";
const REPLY_VERB = '(?:reply|replies|replied|replying|respond|responded|responding|comment|commented|commenting|engage|interact|feedback)';

const REPLY_PATTERNS = [
  // "reply to at least two other students", "Responded to at least one of your peers' posts", "Reply to a classmate's post"
  new RegExp(`\\b${REPLY_VERB}\\b(?:\\s+(?:to|on|with))?\\s+${AT_LEAST}${NUM}\\s+(?:of\\s+)?(?:[a-z']+\\s+){0,2}?${TARGET}`, 'g'),
  // "reply at least twice to other posts", "Reply at least two times to other students"
  new RegExp(`\\b${REPLY_VERB}\\b\\s+(?:at\\s+least\\s+)?(twice|thrice|${NUM_NO_ARTICLE}\\s+times)\\b`, 'g'),
  // "write at least two replies to your fellow students", "One original post and two thoughtful replies"
  new RegExp(`\\b${AT_LEAST}${NUM_NO_ARTICLE}\\s+(?:[a-z-]+\\s+){0,2}?(?:replies|responses|comments)\\b`, 'g'),
];
const POST_PATTERN = new RegExp(`\\b${NUM}\\s+(?:[a-z-]+\\s+){0,2}?(?:original|primary|initial|main|substantive)\\s+(?:posts?|responses?|threads?|entries)\\b`, 'g');
const FIRST_POST = /\b(?:initial|first|primary|main|original)\s+(?:post|posting|response|reply|thread|entry)s?\b/g;
const DUE_WORD = /\b(?:due|by|deadline|no\s+later\s+than|before)\b/;
const WEEKDAYS: [RegExp, number][] = [
  [/^sun(?:day)?$/, 0], [/^mon(?:day)?$/, 1], [/^tue(?:s|sday)?$/, 2], [/^wed(?:nesday)?$/, 3],
  [/^thu(?:r|rs|rsday)?$/, 4], [/^fri(?:day)?$/, 5], [/^sat(?:urday)?$/, 6],
];
const WEEKDAY = /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs?)?|fri|sat)\b/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/;
const NUM_DATE = /(?<![\d/])(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?(?![\d/])/;
const WORDS = [
  /\b(\d{2,4})\s*(?:-|–|to)\s*(\d{2,4})\s*[- ]?words?\b/,
  /\b(?:at\s+least|minimum(?:\s+of)?|min\.?|no\s+fewer\s+than)\s+(\d{2,4})(?:\s*(?:-|–|to)\s*(\d{2,4}))?\s*[- ]?words?\b/,
  /\b(\d{2,4})\s*[- ]?words?\s+(?:minimum|min\b|or\s+more)/,
];
const REVIEW_PATTERN = new RegExp(`\\b${NUM_NO_ARTICLE}\\s+(?:of\\s+)?(?:[a-z']+\\s+){0,3}?(?:peer\\s+reviews?|reviews|rough\\s+drafts|drafts|essays|papers)\\b`, 'g');
const ONE_ATTEMPT = /\b(?:(?:have|get|given)\s+(?:only\s+)?(?:one|1|a\s+single)\s+attempt|only\s+(?:one|1)\s+attempt|one\s+attempt\s+only|single\s+attempt|no\s+way\s+to\s+unsubmit|cannot\s+(?:be\s+)?(?:re-?submit|unsubmit))/;
const IN_PERSON = /\b(?:physically\s+(?:present\s+)?in\s+(?:the\s+)?(?:lab|class|classroom)|in-class\s+only|must\s+be\s+(?:completed|taken|done)\s+in\s+(?:the\s+)?(?:lab|class)|only\s+(?:be\s+)?(?:completed?|done|taken)\s+(?:\w+\s+){0,3}?in\s+(?:the\s+)?(?:lab|class))\b/;

function norm(s: string): string {
  return s.toLowerCase().replace(/[‘’`]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/\s+/g, ' ');
}

/** The teacher's text as sentences, each as written (for quoting) and normalised (for matching). */
function sentences(text: string): { raw: string; low: string }[] {
  const out: { raw: string; low: string }[] = [];
  for (const line of text.split(/\n+/)) {
    for (const part of line.split(/(?<=[.!?])\s+/)) {
      const raw = part.replace(/\s+/g, ' ').trim().replace(/^[•·▪◦*-]\s+/, '');
      if (raw) out.push({ raw, low: norm(raw) });
    }
  }
  return out;
}

const countOf = (word: string) => {
  const w = word.replace(/\s+times$/, '');
  return /^\d+$/.test(w) ? Number(w) : WORD_NUM[w] ?? NaN;
};

function largest(list: { raw: string; low: string }[], patterns: RegExp[]): Found<number> | undefined {
  let best: Found<number> | undefined;
  for (const s of list) {
    for (const re of patterns) {
      re.lastIndex = 0;
      for (const m of s.low.matchAll(re)) {
        const n = countOf(m[1]);
        if (!Number.isFinite(n) || n < 1 || n > 20) continue;
        if (!best || n > best.value) best = { value: n, quote: s.raw };
      }
    }
  }
  return best;
}

function timeIn(s: string): string | null {
  if (/\bmidnight\b/.test(s)) return '23:59';
  if (/\bnoon\b/.test(s)) return '12:00';
  const m = s.match(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/);
  if (!m || Number(m[1]) > 12 || Number(m[2] ?? 0) > 59) return null;
  const h = (Number(m[1]) % 12) + (m[3] === 'p' ? 12 : 0);
  return `${String(h).padStart(2, '0')}:${m[2] ?? '00'}`;
}

/** The first date a text writes, and where: "October 9, 2026", "Oct 9", "10/9/2026". MM-DD when no year is given. */
function dateIn(s: string): { date: string; at: number } | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const found: { date: string; at: number }[] = [];
  const md = s.match(MONTH_DATE);
  if (md && md.index !== undefined) {
    const month = MONTHS.indexOf(md[1].slice(0, 3)) + 1;
    const day = Number(md[2]);
    if (day >= 1 && day <= 31) found.push({ date: md[3] ? `${md[3]}-${pad(month)}-${pad(day)}` : `${pad(month)}-${pad(day)}`, at: md.index });
  }
  const nd = s.match(NUM_DATE);
  if (nd && nd.index !== undefined && Number(nd[1]) >= 1 && Number(nd[1]) <= 12 && Number(nd[2]) >= 1 && Number(nd[2]) <= 31) {
    const y = nd[3] ? (nd[3].length === 2 ? `20${nd[3]}` : nd[3]) : null;
    found.push({ date: y ? `${y}-${pad(Number(nd[1]))}-${pad(Number(nd[2]))}` : `${pad(Number(nd[1]))}-${pad(Number(nd[2]))}`, at: nd.index });
  }
  return found.sort((a, b) => a.at - b.at)[0] ?? null;
}

/** "Initial Post Due Thursday", "First response due: October 9, 2026, at 11:59 PM", "initial response by Wednesday at 11:59pm". */
function firstPostDue(list: { raw: string; low: string }[]): Found<DueRef> | undefined {
  for (const s of list) {
    FIRST_POST.lastIndex = 0;
    for (const m of s.low.matchAll(FIRST_POST)) {
      const after = s.low.slice(m.index + m[0].length, m.index + m[0].length + 90);
      const k = after.search(DUE_WORD);
      if (k < 0 || k > 40) continue;
      const tail = after.slice(k, k + 50);
      const time = timeIn(tail);
      const day = tail.match(WEEKDAY);
      const date = dateIn(tail);
      // whichever the sentence names first
      if (day && day.index !== undefined && (!date || day.index < date.at)) {
        const weekday = WEEKDAYS.find(([re]) => re.test(day[1]))?.[1];
        if (weekday !== undefined) return { value: { weekday, time }, quote: s.raw };
      }
      if (date) return { value: { date: date.date, time }, quote: s.raw };
    }
  }
  return undefined;
}

function firstMatch(list: { raw: string; low: string }[], re: RegExp): Found<true> | undefined {
  const s = list.find((x) => re.test(x.low));
  return s ? { value: true, quote: s.raw } : undefined;
}

function wordCount(list: { raw: string; low: string }[]): Found<{ min: number; max: number | null }> | undefined {
  for (const s of list) {
    for (const re of WORDS) {
      const m = s.low.match(re);
      if (!m) continue;
      const a = Number(m[1]);
      const b = m[2] ? Number(m[2]) : null;
      if (a < 20) continue;
      return { value: { min: b !== null ? Math.min(a, b) : a, max: b !== null ? Math.max(a, b) : null }, quote: s.raw };
    }
  }
  return undefined;
}

export function readInstructions(title: string, text: string, opts: { discussion: boolean }): InstructionFindings {
  const body = sentences(text);
  const out: InstructionFindings = { repliesDistinct: false };
  if (opts.discussion) {
    out.replies = largest(body, REPLY_PATTERNS);
    out.repliesDistinct = !!out.replies && /\bdifferent\s+(?:classmates|students|peers|people|posts)\b/.test(norm(text));
    out.posts = largest(body, [POST_PATTERN]);
    out.postDue = firstPostDue([{ raw: title.trim(), low: norm(title) }, ...body]);
    out.words = wordCount(body);
  }
  out.reviews = largest(body.filter((x) => /\breview/.test(x.low)), [REVIEW_PATTERN]);
  out.oneAttempt = firstMatch(body, ONE_ATTEMPT);
  out.inPerson = firstMatch(body, IN_PERSON);
  for (const k of Object.keys(out) as (keyof InstructionFindings)[]) if (out[k] === undefined) delete out[k];
  return out;
}

function weekdayOf(date: string): number {
  return atLocal(date, 12, 0).getDay();
}

/** A date written without a year: the one in the two weeks up to the deadline. */
function withYear(date: string, dueDate: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const year = Number(dueDate.slice(0, 4));
  for (const y of [year, year - 1]) {
    const d = `${y}-${date}`;
    if (d <= dueDate && d >= addDays(dueDate, -13)) return d;
  }
  return null;
}

/**
 * When an earlier first-post deadline falls, given the assignment's deadline: the named weekday in the six days
 * before it, or the named date if it is in the two weeks before. No time written: the deadline's time of day
 * (Canvas courses keep one, usually 11:59 PM). Null when it isn't actually earlier.
 */
export function milestoneDate(dueIso: string, ref: DueRef): string | null {
  const due = new Date(dueIso);
  const dueDate = localDateStr(due);
  const [h, m] = ref.time ? [Number(ref.time.slice(0, 2)), Number(ref.time.slice(3))] : [due.getHours(), due.getMinutes()];
  let date: string | null = null;
  if ('weekday' in ref) {
    for (let back = 1; back <= 6 && !date; back++) {
      const d = addDays(dueDate, -back);
      if (weekdayOf(d) === ref.weekday) date = d;
    }
  } else {
    date = withYear(ref.date, dueDate);
    if (date && (date > dueDate || date < addDays(dueDate, -13))) date = null;
  }
  if (!date) return null;
  const at = atLocal(date, h, m);
  return at.getTime() < due.getTime() ? at.toISOString() : null;
}
