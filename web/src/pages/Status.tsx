import { useState } from 'react';
import { api, refreshAll, useApi } from '../api.ts';
import { fmtBytes, fmtRelative } from '../format.ts';
import { ErrorNote, Masthead, Section, Spinner } from '../components/ui.tsx';
import { Link } from '../router.tsx';
import type { StatusIssue, SystemStatus } from '../types.ts';

const SCHOOL_STATE: Record<string, { text: string; tone: string }> = {
  ok: { text: '正常', tone: 'ok' }, needs_login: { text: '需要重新登录', tone: 'bad' }, error: { text: '同步出错', tone: 'warn' }, new: { text: '还没登录', tone: 'warn' },
};
const JOB_STATE: Record<string, { text: string; tone: string }> = { ok: { text: '正常', tone: 'ok' }, error: { text: '出错', tone: 'bad' }, running: { text: '运行中', tone: 'warn' } };
const kTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n));

export function Status() {
  const { data, error, reload } = useApi<SystemStatus>('/api/status', { poll: 30_000 });
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const act = async (key: string, fn: () => Promise<unknown>, message: string) => {
    setBusy(key);
    try {
      await fn();
      setDone(message);
      reload();
      refreshAll();
    } finally {
      setBusy(null);
    }
  };
  const sync = () => act('sync', () => api('/api/sync', { method: 'POST', body: {} }).catch(() => undefined), '已开始同步，几分钟后刷新看看。');
  const backup = () => act('backup', () => api('/api/backup', { method: 'POST' }), '已备份（每天一份）。');
  const testNotice = () => act('notify', () => api('/api/notices/test', { method: 'POST' }), '已发出测试通知：右上角应该弹出一条「Course Hub 通知测试」。');

  const fix = (i: StatusIssue) => {
    if (i.action === 'login') return <Link to="/settings" className="btn btn-sm btn-seal">去重新登录</Link>;
    if (i.action === 'sync') return <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void sync()}>立即同步</button>;
    if (i.action === 'backup') return <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void backup()}>立即备份</button>;
    if (i.action === 'notify-test') return <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void testNotice()}>发测试通知</button>;
    return null;
  };

  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><Spinner /></div>;
  return (
    <div className="page">
      <Masthead kicker="System" title="系统状态" aside={<span className="small muted">版本 {data.app.version} · 已运行 {fmtRelative(data.app.startedAt).replace('前', '')}</span>} />
      {done ? <div className="callout info" role="status">{done}</div> : null}
      {data.issues.length === 0 ? (
        <div className="all-good card card-pad">
          <span className="seal seal-ok">✓</span>
          <div><b>一切正常</b><div className="small muted">登录保持、同步、提醒、备份都在按时运行。</div></div>
        </div>
      ) : (
        <div className="card list issue-list">
          {data.issues.map((i, n) => (
            <div key={n} className="list-row"><span className="new-dot" /><span className="grow">{i.text}</span>{fix(i)}</div>
          ))}
        </div>
      )}

      <Section num="i." title="学校">
        <div className="card list">
          {data.schools.map((s) => {
            const st = SCHOOL_STATE[s.status] ?? { text: s.status, tone: '' };
            return (
              <div key={s.id} className="list-row status-row" style={{ ['--c' as string]: s.color }}>
                <span className="dot" style={{ background: s.color }} />
                <b className="status-name">{s.name}</b>
                <span className={`badge ${st.tone}`}>{st.text}</span>
                <span className="grow small muted">
                  {s.authMode === 'token' ? '用访问令牌' : <>登录于 {fmtRelative(s.loginAt)} · 最近确认 {fmtRelative(s.aliveAt)}{s.renewals ? ` · 已自动续期 ${s.renewals} 次` : ''}</>}
                  {' · '}上次同步成功 {fmtRelative(s.lastOkAt)}{s.icsFallback ? ' · 有日历订阅兜底' : ''}
                  {s.statusDetail ? <span className="block">{s.statusDetail}</span> : null}
                  {s.checks ? (
                    s.checks.problems.length === 0 ? (
                      <span className="block">核对：和 Canvas 待办（{s.checks.sources.planner}）、日历订阅（{s.checks.sources.ics}）、To Do（{s.checks.sources.todo}）、缺交列表（{s.checks.sources.missing}）逐条比对，全部一致 ✓</span>
                    ) : (
                      <span className="block check-problems">
                        核对发现 {s.checks.problems.length} 处不一致：
                        {s.checks.problems.map((p, i) => <span key={i} className="block">· {p}</span>)}
                      </span>
                    )
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section num="ii." title="后台任务" note="错过的（比如电脑睡着了）会在醒来后补跑">
        <div className="card list">
          {data.jobs.map((j) => {
            const st = j.lastStatus ? JOB_STATE[j.lastStatus] ?? { text: j.lastStatus, tone: '' } : { text: '还没运行', tone: '' };
            return (
              <div key={j.name} className="list-row">
                <span className="status-name">{j.label}</span>
                <span className={`badge ${st.tone}`}>{st.text}</span>
                <span className="grow small muted">{j.lastRunAt ? `上次 ${fmtRelative(j.lastRunAt)}` : ''}{j.lastError && j.lastStatus === 'error' ? ` · ${j.lastError}` : ''}</span>
              </div>
            );
          })}
        </div>
      </Section>

      <div className="status-grid">
        <Section num="iii." title="AI">
          <div className="card card-pad small">
            <p>{data.ai.enabled ? `已开启 · 模型 ${data.ai.model}` : 'AI 已关闭（日报、周报照常生成，只是没有 AI 安排）'}</p>
            <p>今天调用 <b>{data.ai.today.calls}</b> 次{data.ai.today.failed ? `（失败 ${data.ai.today.failed} 次）` : ''} · 读入 {kTokens(data.ai.today.inputTokens)} / 写出 {kTokens(data.ai.today.outputTokens)} tokens</p>
            <p className="muted">{data.ai.running ? `正在处理：${data.ai.running}` : '空闲'}{data.ai.pending ? ` · 排队 ${data.ai.pending} 个` : ''}</p>
            <p className="muted">用的是你的 Claude 订阅（claude 命令），不走按量计费的 API。</p>
          </div>
        </Section>
        <Section num="iv." title="备份" note="每天 3:30，保留 14 天">
          <div className="card card-pad small">
            {data.backups.length === 0 ? <p className="muted">还没有备份。</p> : (
              <p>最近：<b>{data.backups[0].date}</b>（{fmtBytes(data.backups[0].bytes)}），共 {data.backups.length} 份</p>
            )}
            <p className="muted">数据库坏了会在启动时自动从最近的备份恢复。</p>
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void backup()}>{busy === 'backup' ? '备份中…' : '立即备份'}</button>
          </div>
        </Section>
        <Section num="v." title="通知">
          <div className="card card-pad small">
            <p>{data.notifier.applet ? '通知小程序已安装：点通知会直接打开对应页面。' : '通知小程序没装，用的是系统默认通知。'}</p>
            <p className="muted">第一次收到通知时 macOS 可能会问是否允许，选「允许」。错过的通知都在 <Link to="/notices">通知记录</Link> 里。</p>
            <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void testNotice()}>{busy === 'notify' ? '发送中…' : '发一条测试通知'}</button>
          </div>
        </Section>
        {data.platforms.length ? (
          <Section num="vi." title="外部平台" note="Canvas 里只有成绩栏的作业平台，直接去平台读">
            <div className="card card-pad small">
              {data.platforms.map((p) => (
                <p key={`${p.courseId}:${p.platform}`}>
                  <b>{p.platform}</b> · {p.courseName}：{p.ok ? `已读到 ${p.items} 项有截止日期的作业` : `读取失败：${p.error ?? '原因不明'}`}
                  {p.lastOkAt ? <span className="muted">（上次成功 {fmtRelative(p.lastOkAt, new Date())}）</span> : null}
                </p>
              ))}
              <p className="muted">每次同步时用一个临时的无头浏览器从 Canvas 打开平台，只读作业列表和完成情况，不打开任何作业。</p>
            </div>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
