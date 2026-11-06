// coursehub — Course Hub's command line. Read commands use the database directly (they work while the server
// is down); actions go through the running server when there is one (so its guards apply), else run here.
import { execFile } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { LAUNCH_LABEL, PORT, chromeBin, claudeBin, dataDir, ensureDataDirs } from './config.ts';
import { listCourses } from './db/courses.ts';
import { openDb } from './db/index.ts';
import type { DB } from './db/index.ts';
import { listItems } from './db/items.ts';
import { getReport } from './db/reports.ts';
import { getGuide } from './db/study.ts';
import { NOTIFIER_APP } from './notify/mac.ts';
import { isExamLike, makeTaskViewer } from './reports/data.ts';
import type { TaskView } from './reports/data.ts';
import { headlineOf } from './reports/view.ts';
import type { AnyReport } from './reports/view.ts';
import { probeInstance } from './server/instance.ts';
import { buildStatus } from './server/routes/status.ts';
import { courseDisplayName } from './util/course.ts';
import { describeDue, localDateStr, weekdayZh } from './util/time.ts';
import { currentWeek } from './weeks/build.ts';

export interface Io { out(s: string): void; err(s: string): void }

const BASE = `http://127.0.0.1:${PORT}`;
const DAY = 86_400_000;
const execFileAsync = promisify(execFile);

const USAGE = `用法：coursehub <命令> [选项]

  coursehub status                        学校、同步和待办概况
  coursehub tasks [--days 7] [--json]     接下来几天要交的（含逾期）
  coursehub courses [--json]              课程列表
  coursehub study <课程id> <周> [--json]   看某周的学习讲解
  coursehub sync [学校id]                  立即同步
  coursehub login <学校id>                 打开 Chrome 重新登录
  coursehub report daily|weekly [--no-ai] 生成日报或周报
  coursehub guide <课程id> <周> [--force]   生成某周的学习讲解
  coursehub doctor [--deep]               检查运行环境（--deep 会真的调用一次 Claude）
  coursehub open [页面路径]                在浏览器打开 Course Hub
  coursehub help                          显示这段说明`;

function parse(argv: string[]) {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) positional.push(a);
    else if (a === '--days') flags.set('days', argv[++i] ?? '');
    else flags.set(a.slice(2), true);
  }
  return { cmd: positional[0] ?? 'help', args: positional.slice(1), flags };
}

async function serverUp(): Promise<boolean> {
  return (await probeInstance(BASE)) === 'ours';
}

async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'X-CourseHub': '1', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const statusMark = (t: TaskView) => (t.status === 'overdue' ? ' [逾期]' : t.status === 'missing' ? ' [缺交]' : isExamLike(t.title, t.category) ? ' [考]' : '');

function tasks(db: DB, io: Io, days: number, json: boolean): number {
  const now = new Date();
  const view = makeTaskViewer(db, now);
  const list = listItems(db, { from: new Date(now.getTime() - 30 * DAY).toISOString(), to: new Date(now.getTime() + days * DAY).toISOString() })
    .map(view)
    .filter((t) => t.status === 'todo' || t.status === 'overdue' || t.status === 'missing' || (t.status === 'event' && isExamLike(t.title, t.category)));
  if (json) {
    io.out(JSON.stringify(list, null, 2));
    return 0;
  }
  if (list.length === 0) {
    io.out(`接下来 ${days} 天没有要交的。`);
    return 0;
  }
  let day = '';
  for (const t of list) {
    const d = localDateStr(new Date(t.dueAt!));
    if (d !== day) {
      day = d;
      io.out(`\n${d.slice(5).replace('-', '/')} ${weekdayZh(d)}`);
    }
    io.out(`  ${describeDue(t.dueAt, now, { dateOnly: t.dueDateOnly }).padEnd(14)} ${(t.courseName ?? '').padEnd(14)} ${t.title}${statusMark(t)}${t.note ? `  ✎ ${t.note}` : ''}`);
  }
  return 0;
}

function courses(db: DB, io: Io, json: boolean): number {
  const now = new Date();
  const list = listCourses(db).map((c) => ({ id: c.id, displayName: courseDisplayName(c), name: c.name, schoolId: c.school_id, currentWeek: currentWeek(db, c.id, now) }));
  if (json) io.out(JSON.stringify(list, null, 2));
  else for (const c of list) io.out(`${c.id.padEnd(30)} ${c.displayName.padEnd(16)} ${c.currentWeek ? `第 ${c.currentWeek} 周` : ''}  ${c.name}`);
  return 0;
}

function study(db: DB, io: Io, courseId: string, week: number, json: boolean): number {
  const g = getGuide(db, courseId, week);
  if (!g || g.status !== 'ready' || !g.content) {
    io.out(`第 ${week} 周的讲解还没有生成${g?.status === 'failed' ? `（上次失败：${g.error}）` : g?.status ? `（${g.status === 'running' ? '正在生成' : '排队中'}）` : ''}。运行：coursehub guide ${courseId} ${week}`);
    return 1;
  }
  if (json) {
    io.out(g.content);
    return 0;
  }
  const c = JSON.parse(g.content) as { overview: string; objectives: string[]; concepts: { term: string; term_zh: string; explanation: string }[]; cheatsheet: string };
  io.out(`第 ${week} 周\n\n${c.overview}\n`);
  if (c.objectives?.length) io.out(`学习目标：\n${c.objectives.map((o) => `  · ${o}`).join('\n')}\n`);
  for (const k of c.concepts ?? []) io.out(`■ ${k.term}${k.term_zh ? `（${k.term_zh}）` : ''}\n${k.explanation}\n`);
  if (c.cheatsheet) io.out(`必背速查：\n${c.cheatsheet}`);
  io.out(`\n完整版（公式、自测题）：${BASE}/study/${courseId}/${week}`);
  return 0;
}

function status(db: DB, io: Io): number {
  const s = buildStatus(db);
  io.out(s.issues.length ? `有 ${s.issues.length} 个问题：\n${s.issues.map((i) => `  ✗ ${i.text}`).join('\n')}` : '✓ 一切正常');
  io.out('\n学校：');
  const STATE: Record<string, string> = { ok: '正常', needs_login: '需要重新登录', error: '同步出错', new: '还没登录' };
  for (const x of s.schools) io.out(`  ${x.name.padEnd(22)} ${(STATE[x.status] ?? x.status).padEnd(8)} 上次同步成功 ${x.lastOkAt ? describeDue(x.lastOkAt, new Date()) : '—'}`);
  const view = makeTaskViewer(db, new Date());
  const now = Date.now();
  const open = listItems(db, { from: new Date(now - 30 * DAY).toISOString(), to: new Date(now + 3 * DAY).toISOString() }).map(view);
  const overdue = open.filter((t) => t.status === 'overdue' || t.status === 'missing').length;
  const soon = open.filter((t) => t.status === 'todo').length;
  io.out(`\n逾期/缺交 ${overdue} 项 · 3 天内要交 ${soon} 项 · 今天 AI 调用 ${s.ai.today.calls} 次`);
  return s.issues.length ? 1 : 0;
}

async function waitUntil(check: () => Promise<boolean>, io: Io, label: string, limitMs = 30 * 60_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < limitMs) {
    if (await check()) return true;
    await sleep(3000);
  }
  io.err(`${label}超时了，可以稍后在网页里看结果。`);
  return false;
}

async function syncCmd(db: DB, io: Io, schoolId?: string): Promise<number> {
  if (await serverUp()) {
    await call('/api/sync', { method: 'POST', body: schoolId ? { schoolId } : {} }).catch((e: Error) => io.out(`（${e.message}）`));
    io.out('同步中…');
    await waitUntil(async () => !(await call<{ running: boolean }>('/api/sync')).running, io, '同步');
  } else {
    const { syncAll } = await import('./sync/index.ts');
    io.out('服务器没在运行，直接在这里同步…');
    await syncAll(db, { reason: 'cli', schoolId });
  }
  return status(db, io) === 0 ? 0 : 1;
}

async function loginCmd(db: DB, io: Io, schoolId: string): Promise<number> {
  if (await serverUp()) {
    await call(`/api/schools/${encodeURIComponent(schoolId)}/login`, { method: 'POST' });
    io.out('已打开 Chrome 登录窗口，登录完成后会自动同步。');
    return 0;
  }
  const { interactiveLogin } = await import('./auth/login.ts');
  const r = await interactiveLogin(db, schoolId);
  io.out(r.message);
  return r.ok ? 0 : 1;
}

async function reportCmd(db: DB, io: Io, type: string, noAi: boolean): Promise<number> {
  if (type !== 'daily' && type !== 'weekly') {
    io.err('要指定 daily 或 weekly');
    return 2;
  }
  let id: string;
  if (!noAi && (await serverUp())) {
    await call(`/api/reports/${type}/generate`, { method: 'POST' }).catch(() => undefined);
    io.out(`正在生成${type === 'daily' ? '日报' : '周报'}…`);
    await waitUntil(async () => (await call<{ running: string[] }>('/api/reports/status')).running.length === 0, io, '生成');
    id = (await call<{ id: string }[]>(`/api/reports?type=${type}`))[0]?.id ?? '';
  } else {
    const gen = type === 'daily' ? (await import('./reports/daily.ts')).generateDaily : (await import('./reports/weekly.ts')).generateWeekly;
    id = (await gen(db, { ai: !noAi })).id;
  }
  const row = id ? getReport(db, id) : undefined;
  if (!row) {
    io.err('没有生成成功，看看 coursehub doctor。');
    return 1;
  }
  io.out(`${headlineOf(JSON.parse(row.content) as AnyReport)}\n${BASE}/reports/${row.id}`);
  return 0;
}

async function guideCmd(db: DB, io: Io, courseId: string, week: number, force: boolean): Promise<number> {
  if (await serverUp()) {
    await call(`/api/study/${encodeURIComponent(courseId)}/${week}/generate`, { method: 'POST', body: { force } });
    io.out('已排队，正在读课件写讲解（通常 1–3 分钟）…');
    await waitUntil(async () => {
      const g = getGuide(db, courseId, week);
      return !!g && (g.status === 'ready' || g.status === 'failed');
    }, io, '生成讲解', 20 * 60_000);
  } else {
    const { generateGuide } = await import('./ai/guide.ts');
    io.out((await generateGuide(db, courseId, week, { force })).message);
  }
  return study(db, io, courseId, week, false);
}

async function doctor(db: DB, io: Io, deep: boolean): Promise<number> {
  let bad = 0;
  const check = (ok: boolean, label: string, hint = '') => {
    if (!ok) bad++;
    io.out(`${ok ? '✓' : '✗'} ${label}${!ok && hint ? `  → ${hint}` : ''}`);
  };
  check(Number(process.versions.node.split('.')[0]) >= 24, `Node ${process.versions.node}`, '需要 Node 24 以上');
  check(existsSync(chromeBin()), 'Google Chrome', '请安装 Google Chrome（登录学校要用）');
  check(existsSync(claudeBin()), 'Claude Code（claude 命令）', '没有它就没有 AI 讲解和日报安排');
  try {
    accessSync(dataDir(), constants.W_OK);
    check(true, `数据目录可写：${dataDir()}`);
  } catch {
    check(false, `数据目录可写：${dataDir()}`, '检查文件夹权限');
  }
  const up = await probeInstance(BASE);
  check(up === 'ours', `服务器在运行（${BASE}）`, up === 'other' ? `端口 ${PORT} 被别的程序占用了` : '运行 ./install.sh 或 npm start');
  const agent = await execFileAsync('/bin/launchctl', ['print', `gui/${process.getuid?.() ?? 501}/${LAUNCH_LABEL}`]).then(() => true, () => false);
  check(agent, '开机自动启动（LaunchAgent）', '运行 ./install.sh');
  check(existsSync(NOTIFIER_APP), '通知小程序', '运行 ./notifier/build.sh');
  const s = buildStatus(db);
  for (const i of s.issues) check(false, i.text);
  if (!s.issues.length) check(true, `学校 ${s.schools.length} 所，状态正常；最近备份 ${s.backups[0]?.date ?? '无'}`);
  if (deep) {
    const { runClaude } = await import('./ai/claude.ts');
    const r = await runClaude(db, { purpose: 'chat', ref: 'doctor', system: 'Reply with exactly: ok', prompt: 'ping', model: 'haiku', timeoutMs: 90_000 });
    check(r.ok, 'Claude 登录可用（真的调用了一次 haiku）', r.error ?? '在终端运行 claude 登录一次');
  }
  io.out(bad ? `\n${bad} 项需要处理。` : '\n一切正常。');
  return bad ? 1 : 0;
}

export async function main(argv: string[], io: Io = { out: (s) => console.log(s), err: (s) => console.error(s) }): Promise<number> {
  const { cmd, args, flags } = parse(argv);
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    io.out(USAGE);
    return 0;
  }
  const known = ['status', 'tasks', 'courses', 'study', 'sync', 'login', 'report', 'guide', 'doctor', 'open'];
  if (!known.includes(cmd)) {
    io.err(`不认识的命令：${cmd}\n\n${USAGE}`);
    return 2;
  }
  if (cmd === 'open') {
    await execFileAsync('/usr/bin/open', [`${BASE}${args[0]?.startsWith('/') ? args[0] : `/${args[0] ?? ''}`}`]);
    return 0;
  }
  ensureDataDirs();
  const db = openDb();
  try {
    const json = flags.has('json');
    switch (cmd) {
      case 'status': return status(db, io);
      case 'tasks': return tasks(db, io, Number(flags.get('days') ?? 7) || 7, json);
      case 'courses': return courses(db, io, json);
      case 'study':
        if (args.length < 2) break;
        return study(db, io, args[0], Number(args[1]), json);
      case 'sync': return await syncCmd(db, io, args[0]);
      case 'login':
        if (!args[0]) break;
        return await loginCmd(db, io, args[0]);
      case 'report': return await reportCmd(db, io, args[0] ?? '', flags.has('no-ai'));
      case 'guide':
        if (args.length < 2) break;
        return await guideCmd(db, io, args[0], Number(args[1]), flags.has('force'));
      case 'doctor': return await doctor(db, io, flags.has('deep'));
    }
    io.err(`参数不够。\n\n${USAGE}`);
    return 2;
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await main(process.argv.slice(2));
  process.exit(code);
}
