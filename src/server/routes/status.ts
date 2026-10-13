// The status page: is everything working, and if not, what exactly is wrong and what to do about it.
import { existsSync } from 'node:fs';
import type { Hono } from 'hono';
import { aiQueue } from '../../ai/claude.ts';
import { backupDb, listBackups } from '../../db/backup.ts';
import type { DB } from '../../db/index.ts';
import { unreadNotices } from '../../db/notices.ts';
import { getJob, recentSyncRuns } from '../../db/runs.ts';
import { listSchools } from '../../db/schools.ts';
import { getSettings } from '../../db/settings.ts';
import { one } from '../../db/sql.ts';
import type { AiRunRow } from '../../db/types.ts';
import { NOTIFIER_APP } from '../../notify/mac.ts';
import { atLocal, localDateStr } from '../../util/time.ts';
import { APP_INFO } from '../appinfo.ts';
import { LOW_DISK_BYTES, diskFreeBytes } from '../../maintenance.ts';

export const JOB_LABELS: Record<string, string> = {
  keepalive: '保持登录', daily: '日报', weekly: '周报', sync: '同步', reminders: '截止提醒', 'report-ai': '补全 AI 安排',
  guides: '学习讲解', 'sso-refresh': '刷新学校登录', backup: '数据库备份', cleanup: '清理',
};

export interface Issue { kind: 'disk' | 'login' | 'stale' | 'sync-error' | 'job' | 'backup' | 'notifier' | 'ai'; text: string; action?: 'login' | 'sync' | 'backup' | 'notify-test' }

interface IssueInput {
  now: Date;
  schools: { name: string; status: string; statusDetail: string | null; lastOkAt: string | null }[];
  jobs: { name: string; label: string; lastStatus: string | null; lastError: string | null }[];
  latestBackup: string | null; // YYYY-MM-DD
  applet: boolean;
  lastAi: { ok: boolean; error: string | null; at: string } | null;
  diskFreeBytes?: number | null;
}

export function statusIssues(x: IssueInput): Issue[] {
  const out: Issue[] = [];
  const hoursSince = (iso: string) => (x.now.getTime() - Date.parse(iso)) / 3_600_000;
  if (x.diskFreeBytes != null && x.diskFreeBytes < LOW_DISK_BYTES) {
    out.push({ kind: 'disk', text: `这台 Mac 只剩 ${(x.diskFreeBytes / 1024 ** 3).toFixed(1)} GB 空间：太少会让同步、备份和课件读取失败，清理一下磁盘吧` });
  }
  for (const s of x.schools) if (s.status === 'needs_login') out.push({ kind: 'login', text: `${s.name} 需要重新登录（自动续期没成功）`, action: 'login' });
  for (const s of x.schools) {
    if (s.status === 'ok' && s.lastOkAt && hoursSince(s.lastOkAt) > 8) {
      out.push({ kind: 'stale', text: `${s.name} 已经 ${Math.floor(hoursSince(s.lastOkAt))} 小时没同步成功`, action: 'sync' });
    }
  }
  for (const s of x.schools) if (s.status === 'error') out.push({ kind: 'sync-error', text: `${s.name} 上次同步出错${s.statusDetail ? `：${s.statusDetail}` : ''}`, action: 'sync' });
  for (const j of x.jobs) if (j.lastStatus === 'error') out.push({ kind: 'job', text: `后台任务「${j.label}」出错：${j.lastError ?? '未知错误'}` });
  if (x.schools.length) {
    const age = x.latestBackup ? (x.now.getTime() - atLocal(x.latestBackup, 12, 0).getTime()) / 86_400_000 : Infinity;
    if (age > 2) out.push({ kind: 'backup', text: x.latestBackup ? `已经 ${Math.floor(age)} 天没有备份数据库` : '还没有数据库备份', action: 'backup' });
  }
  if (!x.applet) out.push({ kind: 'notifier', text: '通知小程序没装：通知会用系统默认样式，点了不能直接打开页面', action: 'notify-test' });
  if (x.lastAi && !x.lastAi.ok) out.push({ kind: 'ai', text: `AI 最近一次调用失败：${x.lastAi.error ?? '未知错误'}` });
  return out;
}

/** Everything the status page (and `coursehub status` / `doctor`) shows. */
export function buildStatus(db: DB, now: Date = new Date()) {
  const schools = listSchools(db).map((s) => {
    const run = recentSyncRuns(db, 1, s.id)[0];
    return {
      id: s.id, name: s.name, color: s.color, status: s.status, statusDetail: s.status_detail, authMode: s.auth_mode,
      loginAt: s.login_at, aliveAt: s.alive_at, renewals: s.renewals, lastSyncAt: s.last_sync_at, lastOkAt: s.last_ok_at,
      icsFallback: !!s.ics_url, lastRun: run ? { status: run.status, error: run.error, finishedAt: run.finished_at } : null,
    };
  });
  const jobs = Object.entries(JOB_LABELS).map(([name, label]) => {
    const j = getJob(db, name);
    return { name, label, lastRunAt: j?.last_run_at ?? null, lastStatus: j?.last_status ?? null, lastError: j?.last_error ?? null };
  });
  const since = atLocal(localDateStr(now), 0, 0).toISOString();
  const today = one<{ calls: number; failed: number | null; input: number | null; output: number | null }>(db,
    'SELECT count(*) AS calls, sum(ok = 0) AS failed, sum(input_tokens) AS input, sum(output_tokens) AS output FROM ai_runs WHERE started_at >= $since', { since })!;
  const last = one<AiRunRow>(db, 'SELECT * FROM ai_runs ORDER BY id DESC LIMIT 1');
  const backups = listBackups().map(({ date, bytes }) => ({ date, bytes }));
  const disk = diskFreeBytes();
  const applet = existsSync(NOTIFIER_APP);
  const s = getSettings(db);
  const lastAi = last ? { ok: !!last.ok, error: last.error, at: last.started_at, purpose: last.purpose } : null;
  return {
    app: APP_INFO,
    schools,
    jobs,
    ai: {
      enabled: s.aiEnabled, model: s.aiModel, running: aiQueue.running, pending: aiQueue.pending().length,
      today: { calls: today.calls, failed: today.failed ?? 0, inputTokens: today.input ?? 0, outputTokens: today.output ?? 0 }, last: lastAi,
    },
    backups,
    disk: { freeBytes: disk },
    notifier: { applet, unread: unreadNotices(db) },
    issues: statusIssues({ now, schools, jobs, latestBackup: backups[0]?.date ?? null, applet, lastAi, diskFreeBytes: disk }),
  };
}

export function registerStatus(app: Hono, db: DB): void {
  app.get('/api/status', (c) => c.json(buildStatus(db)));
  app.post('/api/backup', (c) => c.json({ created: !!backupDb(db, new Date()) }));
}
