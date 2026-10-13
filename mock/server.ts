// A small fake Canvas that behaves like the real one where it matters to Course Hub:
// cookie sessions, `while(1);` prefixes, Link pagination, redirect-to-login on expiry,
// an optional external identity provider, signed file downloads on another host, and an ICS feed.
import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import type { StoredCookie } from '../src/canvas/cookies.ts';
import { buildFixtures } from './fixtures.ts';
import type { MockAssignment, MockCourse, MockData, MockFile, MockModule, MockModuleItem } from './fixtures.ts';
import { TINY_PNG } from './files.ts';

export interface MockOptions {
  variant: 'alpha' | 'beta' | 'gamma';
  now?: Date;
  port?: number;
  idp?: boolean;
  pageSize?: number;
  expiredBehavior?: 'redirect' | '401';
  idleTimeoutMs?: number; // sessions die after this long without a request (like a school's inactivity timeout)
}

export interface MockCanvas {
  baseUrl: string;
  idpUrl: string;
  blobUrl: string;
  data: MockData;
  requests: { method: string; path: string }[];
  close(): Promise<void>;
  expireSessions(): void;
  expireAfter(n: number): void;
  setRemember(enabled: boolean): void;
  sessionCookies(): StoredCookie[];
  sessionCookieHeader(): string;
}

type Auth = 'session' | 'token';
const token = () => randomBytes(12).toString('hex');

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function listen(server: http.Server, host: string, port = 0): Promise<string> {
  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  return `http://${host}:${(server.address() as AddressInfo).port}`;
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

const LOGIN_FORM = (action: string, error = '') => `<!doctype html><html><body><h1>Log In</h1>${error ? `<p class="error">${error}</p>` : ''}
<form method="post" action="${action}">
<input id="username" name="username" placeholder="Username">
<input id="password" name="password" type="password" placeholder="Password">
<label><input id="remember" name="remember" type="checkbox" value="1"> Stay signed in</label>
<button id="submit" type="submit">Log In</button></form></body></html>`;

export async function startMockCanvas(opts: MockOptions): Promise<MockCanvas> {
  const data = buildFixtures(opts.variant, opts.now ?? new Date());
  const pageSize = opts.pageSize ?? 50;
  const sessions = new Map<string, number>(); // token → last request time
  const remembered = new Set<string>();
  const idpRemembered = new Set<string>();
  const tickets = new Set<string>();
  const requests: { method: string; path: string }[] = [];
  let rememberEnabled = true;
  let expireCountdown: number | null = null;

  const canvas = http.createServer((req, res) => void handleCanvas(req, res).catch((err) => fail(res, err)));
  const blob = http.createServer((req, res) => handleBlob(req, res));
  const idp = http.createServer((req, res) => void handleIdp(req, res).catch((err) => fail(res, err)));
  const baseUrl = await listen(canvas, '127.0.0.1', opts.port ?? 0);
  const blobUrl = await listen(blob, 'localhost');
  const idpUrl = opts.idp ? await listen(idp, 'localhost') : '';

  function fail(res: ServerResponse, err: unknown) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(String(err));
  }

  function newSession(): string {
    const s = token();
    sessions.set(s, Date.now());
    return s;
  }

  /** Valid session? Refreshes its idle timer like a real server does on each request. */
  function touch(s: string | undefined): boolean {
    if (!s || !sessions.has(s)) return false;
    if (opts.idleTimeoutMs && Date.now() - sessions.get(s)! > opts.idleTimeoutMs) {
      sessions.delete(s);
      return false;
    }
    sessions.set(s, Date.now());
    return true;
  }

  function redirect(res: ServerResponse, location: string, cookies: string[] = []) {
    res.writeHead(302, { Location: location, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) });
    res.end();
  }

  function html(res: ServerResponse, body: string, status = 200) {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(body);
  }

  const sessionCookie = (s: string) => `canvas_session=${s}; Path=/; HttpOnly`;

  function findCourse(id: string): MockCourse | undefined {
    return data.courses.find((c) => c.id === id);
  }

  function allFiles(): { course: MockCourse; file: MockFile }[] {
    return data.courses.flatMap((course) => course.files.map((file) => ({ course, file })));
  }

  // ---------- JSON shapes ----------
  const courseJson = (c: MockCourse, q: URLSearchParams) => {
    if (c.restricted) return { id: c.id, access_restricted_by_date: true };
    const include = q.getAll('include[]');
    return {
      id: c.id, name: c.name, course_code: c.course_code, start_at: c.start_at, end_at: c.end_at, workflow_state: 'available',
      ...(include.includes('term') ? { term: c.term } : {}),
      ...(include.includes('syllabus_body') ? { syllabus_body: c.syllabus_body } : {}),
      enrollments: [{
        type: 'student', enrollment_state: 'active',
        ...(include.includes('total_scores') ? { computed_current_score: c.score, computed_current_grade: c.grade } : {}),
      }],
    };
  };

  const submissionJson = (a: MockAssignment) => ({ ...a.submission, assignment_id: a.id });

  const assignmentJson = (c: MockCourse, a: MockAssignment, include: string[]) => ({
    id: a.id, name: a.name, description: a.description, due_at: a.due_at, unlock_at: a.unlock_at ?? null, lock_at: a.lock_at ?? null,
    points_possible: a.points_possible, submission_types: a.submission_types, course_id: c.id, published: true,
    assignment_group_id: a.group ?? null,
    html_url: `${baseUrl}/courses/${c.id}/assignments/${a.id}`,
    is_quiz_assignment: !!a.is_quiz_assignment, quiz_id: a.quiz_id,
    ...(a.discussion_topic_id ? { discussion_topic: { id: a.discussion_topic_id } } : {}),
    ...(a.external_url ? { external_tool_tag_attributes: { url: a.external_url } } : {}),
    // like Canvas: checkpoint details only when asked for
    has_sub_assignments: !!a.checkpoints?.length,
    ...(a.checkpoints && include.includes('checkpoints')
      ? { checkpoints: a.checkpoints.map((cp) => ({ name: a.name, tag: cp.tag, points_possible: cp.points_possible, due_at: cp.due_at, only_visible_to_overrides: false, overrides: [], unlock_at: null, lock_at: null })) }
      : {}),
    ...(include.includes('submission')
      ? {
          submission: {
            ...submissionJson(a),
            ...(a.checkpoints && include.includes('sub_assignment_submissions')
              ? { sub_assignment_submissions: a.checkpoints.map((cp) => ({ sub_assignment_tag: cp.tag, submitted_at: cp.submitted_at, missing: false, late: false, score: null })) }
              : {}),
          },
        }
      : {}),
  });

  const moduleItemJson = (c: MockCourse, m: MockModule, i: MockModuleItem) => {
    const a = i.type === 'Assignment' ? c.assignments.find((x) => x.id === i.content_id) : undefined;
    return {
      id: i.id, module_id: m.id, title: i.title, type: i.type, content_id: i.content_id ?? null, position: i.position, indent: i.indent ?? 0,
      html_url: `${baseUrl}/courses/${c.id}/modules/items/${i.id}`,
      url: i.type === 'File' ? `${baseUrl}/api/v1/courses/${c.id}/files/${i.content_id}` : undefined,
      page_url: i.page_url ?? null, external_url: i.external_url ?? null,
      ...(a ? { content_details: { due_at: a.due_at, points_possible: a.points_possible, locked_for_user: false } } : {}),
    };
  };

  const fileJson = (f: MockFile) => ({
    id: f.id, display_name: f.display_name, filename: f.display_name, 'content-type': f.content_type, size: f.size,
    updated_at: f.updated_at, folder_id: '1', locked_for_user: !!f.locked, hidden_for_user: false,
    ...(f.locked ? {} : { url: `${baseUrl}/files/${f.id}/download?download_frd=1&verifier=v${f.id}` }),
  });

  function plannerItems(q: URLSearchParams) {
    const start = q.get('start_date') ? Date.parse(q.get('start_date')!) : -Infinity;
    const end = q.get('end_date') ? Date.parse(q.get('end_date')!) : Infinity;
    const inRange = (d: string | null) => d !== null && Date.parse(d) >= start && Date.parse(d) < end;
    const items: unknown[] = [];
    for (const c of data.courses.filter((x) => !x.restricted)) {
      for (const a of c.assignments) {
        if (!inRange(a.due_at)) continue;
        const done = data.plannerDoneAssignments.has(a.id);
        const s = a.submission;
        const base = {
          course_id: c.id, context_name: c.name, plannable_date: a.due_at, new_activity: false,
          planner_override: done ? { marked_complete: true, dismissed: false } : null,
          submissions: {
            submitted: ['submitted', 'graded', 'pending_review'].includes(s.workflow_state), excused: !!s.excused,
            graded: s.workflow_state === 'graded', late: s.late, missing: s.missing, needs_grading: s.workflow_state === 'submitted',
          },
        };
        if (a.is_quiz_assignment && a.quiz_id) {
          items.push({ ...base, plannable_type: 'quiz', plannable_id: a.quiz_id, html_url: `/courses/${c.id}/quizzes/${a.quiz_id}`, plannable: { id: a.quiz_id, title: a.name, due_at: a.due_at, assignment_id: a.id, points_possible: a.points_possible } });
        } else if (a.discussion_topic_id) {
          items.push({ ...base, plannable_type: 'discussion_topic', plannable_id: a.discussion_topic_id, html_url: `/courses/${c.id}/discussion_topics/${a.discussion_topic_id}`, plannable: { id: a.discussion_topic_id, title: a.name, todo_date: null, assignment_id: a.id } });
        } else {
          items.push({ ...base, plannable_type: 'assignment', plannable_id: a.id, html_url: `/courses/${c.id}/assignments/${a.id}`, plannable: { id: a.id, title: a.name, due_at: a.due_at, points_possible: a.points_possible } });
        }
      }
      for (const a of c.assignments) {
        for (const cp of (a.checkpoints ?? []).filter((x) => inRange(x.due_at))) {
          items.push({
            course_id: c.id, context_name: c.name, plannable_type: 'sub_assignment', plannable_id: cp.sub_id ?? `${a.id}${cp.tag === 'reply_to_topic' ? 1 : 2}`,
            plannable_date: cp.due_at, new_activity: false, html_url: `/courses/${c.id}/assignments/${a.id}/submissions/${data.user.id}`,
            planner_override: cp.done_in_planner ? { marked_complete: true, dismissed: false } : null,
            submissions: { submitted: !!cp.submitted_at, excused: false, graded: false, late: false, missing: false, needs_grading: !!cp.submitted_at },
            plannable: { id: cp.sub_id, title: a.name, sub_assignment_tag: cp.tag, due_at: cp.due_at, points_possible: cp.points_possible },
          });
        }
      }
      for (const qz of c.quizzes.filter((x) => !x.assignment_id && inRange(x.due_at))) {
        items.push({ course_id: c.id, context_name: c.name, plannable_type: 'quiz', plannable_id: qz.id, plannable_date: qz.due_at, html_url: `/courses/${c.id}/quizzes/${qz.id}`, submissions: false, planner_override: null, plannable: { id: qz.id, title: qz.title, due_at: qz.due_at } });
      }
      for (const e of c.events.filter((x) => inRange(x.start_at))) {
        items.push({ course_id: c.id, context_name: c.name, plannable_type: 'calendar_event', plannable_id: e.id, plannable_date: e.start_at, html_url: `/calendar?event_id=${e.id}`, submissions: false, planner_override: null, plannable: { id: e.id, title: e.title } });
      }
    }
    for (const x of data.plannerExtras.filter((p) => inRange(p.todo_date))) {
      items.push({
        course_id: x.course_id, plannable_type: x.type, plannable_id: x.id, plannable_date: x.todo_date, submissions: false, planner_override: null,
        html_url: x.type === 'wiki_page' ? `/courses/${x.course_id}/pages/${x.page_url}`
          : x.type === 'assessment_request' ? `/courses/${x.course_id}/assignments/${x.assignment_id}?reviewee_id=283479` : `/planner_notes/${x.id}`,
        plannable: { id: x.id, title: x.title, todo_date: x.todo_date, ...(x.workflow_state ? { workflow_state: x.workflow_state } : {}) },
      });
    }
    return items.sort((a, b) => String((a as { plannable_date: string }).plannable_date).localeCompare(String((b as { plannable_date: string }).plannable_date)));
  }

  // ---------- API routing ----------
  type Result = { list: unknown[] } | { one: unknown } | { status: number; body: unknown };

  function apiRoute(path: string, q: URLSearchParams): Result {
    let m: RegExpMatchArray | null;
    const contextCourses = () => q.getAll('context_codes[]').map((cc) => findCourse(cc.replace('course_', ''))).filter((c): c is MockCourse => !!c);
    if (path === '/api/v1/users/self') return { one: { id: data.user.id, name: data.user.name, short_name: 'Ewan' } };
    if (path === '/api/v1/users/self/profile') {
      return { one: { id: data.user.id, name: data.user.name, short_name: 'Ewan', primary_email: 'ewan@example.edu', login_id: 'ewan', time_zone: 'America/Los_Angeles', calendar: { ics: `${baseUrl}/feeds/calendars/user_${data.icsToken}.ics` } } };
    }
    if (path === '/api/v1/courses') return { list: data.courses.map((c) => courseJson(c, q)) };
    if (path === '/api/v1/planner/items') return { list: plannerItems(q) };
    if (path === '/api/v1/users/self/todo') {
      // Canvas's "To Do": unsubmitted work that is due (or open) now, checkpoints by their sub-assignment id
      const out: unknown[] = [];
      for (const c of data.courses.filter((x) => !x.restricted)) {
        for (const a of c.assignments) {
          const base = { type: 'submitting', context_type: 'Course', course_id: c.id, context_name: c.name };
          if (a.checkpoints?.length) {
            for (const cp of a.checkpoints.filter((x) => !x.submitted_at && Date.parse(x.due_at) > Date.now())) {
              const sid = cp.sub_id ?? `${a.id}${cp.tag === 'reply_to_topic' ? 1 : 2}`;
              out.push({ ...base, ignore: `${baseUrl}/api/v1/users/self/todo/sub_assignment_${sid}/submitting?permanent=0`, assignment: { id: sid, name: a.name, due_at: cp.due_at } });
            }
          } else if (a.due_at && Date.parse(a.due_at) > Date.now() && a.submission.workflow_state === 'unsubmitted' && !a.submission_types.every((t) => ['none', 'on_paper', 'not_graded'].includes(t))) {
            out.push({ ...base, ignore: `${baseUrl}/api/v1/users/self/todo/assignment_${a.id}/submitting?permanent=0`, assignment: { id: a.id, name: a.name, due_at: a.due_at } });
          }
        }
      }
      return { one: out };
    }
    if (path === '/api/v1/users/self/missing_submissions') {
      return { list: data.courses.flatMap((c) => c.assignments.filter((a) => a.submission.missing).map((a) => assignmentJson(c, a, []))) };
    }
    if (path === '/api/v1/announcements') {
      const start = q.get('start_date') ? Date.parse(q.get('start_date')!) : -Infinity;
      return { list: contextCourses().flatMap((c) => c.topics.filter((t) => t.is_announcement && Date.parse(t.posted_at ?? t.created_at ?? '') >= start).map((t) => ({
        id: t.id, title: t.title, message: t.message, posted_at: t.posted_at, created_at: t.created_at ?? t.posted_at, author: { display_name: t.author }, user_name: t.author,
        html_url: `${baseUrl}/courses/${c.id}/discussion_topics/${t.id}`, context_code: `course_${c.id}`, is_announcement: true,
      }))) };
    }
    if (path === '/api/v1/calendar_events') {
      return { list: contextCourses().flatMap((c) => c.events.map((e) => ({
        id: e.id, title: e.title, start_at: e.start_at, end_at: e.end_at, all_day: e.all_day, description: e.description,
        html_url: `${baseUrl}/calendar?event_id=${e.id}&include_contexts=course_${c.id}`, context_code: `course_${c.id}`,
      }))) };
    }
    if (path === '/api/v1/conversations') {
      return { list: data.conversations.map((cv) => ({ ...cv })) };
    }
    if ((m = path.match(/^\/api\/v1\/conversations\/(\d+)$/))) {
      const cv = data.conversations.find((x) => x.id === m![1]);
      return cv ? { one: cv } : { status: 404, body: { errors: [{ message: 'not found' }] } };
    }
    if ((m = path.match(/^\/api\/v1\/files\/(\d+)$/))) {
      const f = allFiles().find((x) => x.file.id === m![1]);
      return f ? { one: fileJson(f.file) } : { status: 404, body: { errors: [{ message: 'not found' }] } };
    }
    if ((m = path.match(/^\/api\/v1\/courses\/(\d+)(\/.*)?$/))) {
      const c = findCourse(m[1]);
      if (!c || c.restricted) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
      const rest = m[2] ?? '';
      let r: RegExpMatchArray | null;
      if (rest === '') return { one: courseJson(c, q) };
      if (rest === '/tabs') return { list: c.tabs.map((id) => ({ id, label: id, html_url: `/courses/${c.id}/${id}`, type: 'internal' })) };
      if (rest === '/assignments') return { list: c.assignments.map((a) => assignmentJson(c, a, q.getAll('include[]'))) };
      if (rest === '/assignment_groups') return { list: (c.groups ?? []).map((g, i) => ({ id: g.id, name: g.name, group_weight: g.weight, position: i + 1 })) };
      const hidden = (what: 'pages' | 'quizzes' | 'files') => c.apiHidden?.includes(what);
      if (rest === '/external_tools/sessionless_launch') {
        // a one-time launch URL for an LTI tool, as Canvas gives students (and its mobile apps) for module items
        const item = c.modules.flatMap((mod) => mod.items).find((i) => i.id === q.get('module_item_id') && i.type === 'ExternalTool');
        if (q.get('launch_type') !== 'module_item' || !item) return { status: 400, body: { errors: [{ message: 'A tool id, tool url, or module item id must be provided' }] } };
        return { one: { id: '495', name: 'Macmillan Learning Launchpad', url: `${baseUrl}/courses/${c.id}/external_tools/sessionless_launch?verifier=v${item.id}` } };
      }
      if (rest === '/quizzes' && hidden('quizzes')) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
      if (rest === '/pages' && hidden('pages')) return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
      if (rest === '/files' && hidden('files')) return { status: 403, body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] } };
      if (rest === '/quizzes') return { list: c.quizzes.map((qz) => ({ ...qz, html_url: `${baseUrl}/courses/${c.id}/quizzes/${qz.id}` })) };
      if (rest === '/modules') {
        const withItems = q.getAll('include[]').includes('items');
        return { list: c.modules.map((mod) => ({
          id: mod.id, name: mod.name, position: mod.position, unlock_at: mod.unlock_at, state: 'unlocked', items_count: mod.items.length,
          ...(withItems && !mod.omitItems ? { items: mod.items.map((i) => moduleItemJson(c, mod, i)) } : {}),
        })) };
      }
      if ((r = rest.match(/^\/modules\/(\d+)\/items$/))) {
        const mod = c.modules.find((x) => x.id === r![1]);
        return mod ? { list: mod.items.map((i) => moduleItemJson(c, mod, i)) } : { status: 404, body: {} };
      }
      if (rest === '/pages') {
        return { list: c.pages.map((p) => ({ page_id: p.page_id, url: p.url, title: p.title, updated_at: p.updated_at, front_page: p.front_page, published: true, html_url: `${baseUrl}/courses/${c.id}/pages/${p.url}` })) };
      }
      if ((r = rest.match(/^\/pages\/([^/]+)$/))) {
        const p = c.pages.find((x) => x.url === decodeURIComponent(r![1]));
        return p ? { one: { page_id: p.page_id, url: p.url, title: p.title, updated_at: p.updated_at, front_page: p.front_page, published: true, html_url: `${baseUrl}/courses/${c.id}/pages/${p.url}`, body: p.body } } : { status: 404, body: {} };
      }
      if (rest === '/files') {
        if (c.filesListForbidden) return { status: 401, body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] } };
        return { list: c.files.map(fileJson) };
      }
      if ((r = rest.match(/^\/files\/(\d+)$/))) {
        const f = c.files.find((x) => x.id === r![1]);
        return f ? { one: fileJson(f) } : { status: 404, body: {} };
      }
      if (rest === '/discussion_topics') {
        return { list: c.topics.filter((t) => !t.is_announcement).map((t) => ({
          id: t.id, title: t.title, message: t.message, posted_at: t.posted_at, author: { display_name: t.author }, user_name: t.author,
          html_url: `${baseUrl}/courses/${c.id}/discussion_topics/${t.id}`, discussion_subentry_count: t.discussion_subentry_count,
          unread_count: t.unread_count, assignment_id: t.assignment_id ?? null, is_announcement: false,
        })) };
      }
    }
    return { status: 404, body: { errors: [{ message: 'The specified resource does not exist.' }] } };
  }

  function sendApi(res: ServerResponse, url: URL, auth: Auth, result: Result) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', 'X-Rate-Limit-Remaining': '700.0' };
    const prefix = auth === 'session' ? 'while(1);' : '';
    if ('status' in result) {
      res.writeHead(result.status, headers);
      res.end(prefix + JSON.stringify(result.body));
      return;
    }
    if ('one' in result) {
      res.writeHead(200, headers);
      res.end(prefix + JSON.stringify(result.one));
      return;
    }
    const perPage = Math.min(Number(url.searchParams.get('per_page') ?? 10), pageSize);
    const page = Number(url.searchParams.get('page') ?? 1);
    const slice = result.list.slice((page - 1) * perPage, page * perPage);
    if (page * perPage < result.list.length) {
      const next = new URL(url);
      next.searchParams.set('page', String(page + 1));
      headers.Link = `<${next.toString()}>; rel="next"`;
    }
    res.writeHead(200, headers);
    res.end(prefix + JSON.stringify(slice));
  }

  function authOf(req: IncomingMessage): Auth | null {
    if (touch(parseCookies(req.headers.cookie).canvas_session)) return 'session';
    if (req.headers.authorization === `Bearer ${data.token}`) return 'token';
    return null;
  }

  function ics(): string {
    // Canvas's real format: assignments link to the calendar with #assignment_<id>; 11:59 PM deadlines are all-day
    // dates; overrides the student is in become event-assignment-override-<id>; checkpoints event-sub-assignment-<id>.
    const fmt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const pad = (n: number) => String(n).padStart(2, '0');
    const esc = (t: string) => t.replace(/([;,])/g, '\\$1');
    const when = (iso: string) => {
      const d = new Date(iso);
      return d.getHours() === 23 && d.getMinutes() === 59
        ? [`DTSTART;VALUE=DATE;VALUE=DATE:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`]
        : [`DTSTART:${fmt(iso)}`, `DTEND:${fmt(iso)}`];
    };
    const calUrl = (c: MockCourse, iso: string, assignmentId: string) => {
      const d = new Date(iso);
      return `URL;VALUE=URI:${baseUrl}/calendar?include_contexts=course_${c.id}&month=${pad(d.getMonth() + 1)}&year=${d.getFullYear()}#assignment_${assignmentId}`;
    };
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Instructure//Canvas//EN', 'CALSCALE:GREGORIAN'];
    for (const c of data.courses.filter((x) => !x.restricted)) {
      for (const a of c.assignments.filter((x) => x.due_at)) {
        const uid = a.override ? `event-assignment-override-${a.override.id}` : `event-assignment-${a.id}`;
        const title = a.override ? `${a.name} (${a.override.label})` : a.name;
        lines.push('BEGIN:VEVENT', `UID:${uid}`, ...when(a.due_at!), `SUMMARY:${esc(title)} [${c.course_code}]`, calUrl(c, a.due_at!, a.id), 'END:VEVENT');
      }
      for (const a of c.assignments) {
        for (const cp of a.checkpoints ?? []) {
          const label = cp.tag === 'reply_to_topic' ? 'Reply to Topic' : `Required Replies (${cp.required ?? 2})`;
          lines.push('BEGIN:VEVENT', `UID:event-sub-assignment-${cp.sub_id ?? `${a.id}${cp.tag === 'reply_to_topic' ? 1 : 2}`}`, ...when(cp.due_at),
            `SUMMARY:${esc(a.name)} ${label} [${c.course_code}]`, calUrl(c, cp.due_at, a.id), 'END:VEVENT');
        }
      }
      for (const e of c.events) {
        lines.push('BEGIN:VEVENT', `DTSTART:${fmt(e.start_at)}`, `DTEND:${fmt(e.end_at)}`, `SUMMARY:${esc(e.title)} [${c.course_code}]`,
          `URL;VALUE=URI:${baseUrl}/calendar?event_id=${e.id}&include_contexts=course_${c.id}`, `UID:event-calendar-event-${e.id}`, 'END:VEVENT');
      }
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ---------- canvas host ----------
  async function handleCanvas(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, baseUrl);
    requests.push({ method: req.method!, path: url.pathname + url.search });
    const cookies = parseCookies(req.headers.cookie);

    if (url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'text/plain' });
        res.end('Method Not Allowed');
        return;
      }
      if (expireCountdown !== null) {
        if (expireCountdown <= 0) {
          sessions.clear();
          expireCountdown = null;
        } else {
          expireCountdown--;
        }
      }
      const auth = authOf(req);
      if (!auth) {
        if (opts.expiredBehavior === '401') {
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'unauthenticated', errors: [{ message: 'user authorization required' }] }));
        } else {
          redirect(res, `/login`);
        }
        return;
      }
      sendApi(res, url, auth, apiRoute(url.pathname, url.searchParams));
      return;
    }

    const icsMatch = url.pathname.match(/^\/feeds\/calendars\/user_(.+)\.ics$/);
    if (icsMatch) {
      if (icsMatch[1] !== data.icsToken) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/calendar; charset=utf-8' });
      res.end(ics());
      return;
    }

    if (url.pathname === '/login' && req.method === 'GET') {
      if (touch(cookies.canvas_session)) return redirect(res, '/');
      if (opts.idp) return redirect(res, `${idpUrl}/sso?return=${encodeURIComponent(`${baseUrl}/login/callback`)}`);
      if (rememberEnabled && cookies.pseudonym_credentials && remembered.has(cookies.pseudonym_credentials)) {
        return redirect(res, '/', [sessionCookie(newSession())]);
      }
      return html(res, LOGIN_FORM('/login'));
    }
    if (url.pathname === '/login' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (form.get('username') !== 'student' || form.get('password') !== 'password') return html(res, LOGIN_FORM('/login', 'Invalid username or password'), 400);
      const set = [sessionCookie(newSession())];
      if (form.get('remember')) {
        const r = token();
        remembered.add(r);
        set.push(`pseudonym_credentials=${r}; Path=/; Max-Age=1209600; HttpOnly`);
      }
      return redirect(res, '/', set);
    }
    if (url.pathname === '/login/callback') {
      const t = url.searchParams.get('ticket') ?? '';
      if (!tickets.delete(t)) return html(res, 'bad ticket', 400);
      return redirect(res, '/', [sessionCookie(newSession())]);
    }
    if (url.pathname === '/') {
      if (touch(cookies.canvas_session)) return html(res, '<h1>Dashboard</h1>');
      return redirect(res, '/login');
    }
    const download = url.pathname.match(/^\/files\/(\d+)\/download$/);
    if (download) {
      // Like Canvas: the verifier in the API's file url grants access on its own (token clients rely on it).
      const verified = url.searchParams.get('verifier') === `v${download[1]}`;
      if (!verified && authOf(req) !== 'session') return redirect(res, '/login');
      return redirect(res, `${blobUrl}/blob/${download[1]}?sig=ok`);
    }
    if (/^\/courses\/\d+\/files\/\d+\/preview$/.test(url.pathname)) {
      if (authOf(req) !== 'session') return redirect(res, '/login');
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(TINY_PNG);
      return;
    }
    if (url.pathname.startsWith('/equation_images/')) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(TINY_PNG);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }

  function handleBlob(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, blobUrl);
    const m = url.pathname.match(/^\/blob\/(\d+)$/);
    const f = m && url.searchParams.get('sig') === 'ok' ? allFiles().find((x) => x.file.id === m[1]) : undefined;
    if (!f || !f.file.bytes) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'Content-Type': f.file.content_type, 'Content-Length': String(f.file.bytes.length) });
    res.end(f.file.bytes);
  }

  async function handleIdp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url!, idpUrl);
    const cookies = parseCookies(req.headers.cookie);
    const back = url.searchParams.get('return') ?? `${baseUrl}/login/callback`;
    const issue = (extra: string[] = []) => {
      const t = token();
      tickets.add(t);
      redirect(res, `${back}?ticket=${t}`, extra);
    };
    if (url.pathname === '/sso' && req.method === 'GET') {
      if (rememberEnabled && cookies.idp_remember && idpRemembered.has(cookies.idp_remember)) return issue();
      return html(res, LOGIN_FORM(`/sso?return=${encodeURIComponent(back)}`));
    }
    if (url.pathname === '/sso' && req.method === 'POST') {
      const form = new URLSearchParams(await readBody(req));
      if (form.get('username') !== 'student' || form.get('password') !== 'password') return html(res, LOGIN_FORM(`/sso?return=${encodeURIComponent(back)}`, 'Invalid'), 400);
      const set: string[] = [];
      if (form.get('remember')) {
        const r = token();
        idpRemembered.add(r);
        set.push(`idp_remember=${r}; Path=/; Max-Age=2592000; HttpOnly`);
      }
      return issue(set);
    }
    res.writeHead(404);
    res.end();
  }

  return {
    baseUrl,
    idpUrl,
    blobUrl,
    data,
    requests,
    async close() {
      await Promise.all([close(canvas), close(blob), opts.idp ? close(idp) : Promise.resolve()]);
    },
    expireSessions() {
      sessions.clear();
    },
    expireAfter(n: number) {
      expireCountdown = n;
    },
    setRemember(enabled: boolean) {
      rememberEnabled = enabled;
    },
    sessionCookies(): StoredCookie[] {
      return [{ name: 'canvas_session', value: newSession(), domain: new URL(baseUrl).hostname, path: '/', expires: -1, httpOnly: true, secure: false }];
    },
    sessionCookieHeader() {
      return `canvas_session=${newSession()}`;
    },
  };
}
