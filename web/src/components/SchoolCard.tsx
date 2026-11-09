import { useEffect, useState } from 'react';
import { api, refreshAll } from '../api.ts';
import { fmtRelative } from '../format.ts';
import type { SchoolView } from '../types.ts';
import { Icon } from './Icon.tsx';
import { Badge, ExtLink } from './ui.tsx';

function sinceText(iso: string): string {
  const h = (Date.now() - Date.parse(iso)) / 3_600_000;
  if (h < 1) return '不到 1 小时';
  if (h < 48) return `${Math.floor(h)} 小时`;
  return `${Math.floor(h / 24)} 天`;
}

const STATUS: Record<SchoolView['status'], { label: string; tone?: 'ok' | 'warn' | 'bad' }> = {
  ok: { label: '正常', tone: 'ok' },
  needs_login: { label: '需要重新登录', tone: 'bad' },
  new: { label: '未登录', tone: 'warn' },
  error: { label: '出错', tone: 'bad' },
};

export function SchoolCard({ school, onChanged }: { school: SchoolView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ics, setIcs] = useState(school.ics_url ?? '');
  const [token, setToken] = useState('');
  const [links, setLinks] = useState(school.links);
  const login = school.loginState;
  const waiting = login.status === 'waiting';

  useEffect(() => setIcs(school.ics_url ?? ''), [school.ics_url]);
  useEffect(() => setLinks(school.links), [school.links]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      onChanged();
      refreshAll();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const patch = (body: unknown) => run('save', () => api(`/api/schools/${school.id}`, { method: 'PATCH', body }));
  const status = STATUS[school.status];
  const needsLogin = school.status === 'new' || school.status === 'needs_login';

  return (
    <article className="card card-pad ribbon" style={{ ['--ribbon' as string]: school.color }}>
      <div className="row">
        <div className="grow">
          <div className="row" style={{ gap: 12 }}>
            <h3 className="school-name">{school.name}</h3>
            <Badge tone={status.tone}>{status.label}</Badge>
            {school.auth_mode === 'token' ? <span className="badge">令牌</span> : null}
          </div>
          <div className="small muted" style={{ marginTop: 4 }}>
            <ExtLink href={school.base_url}>{school.base_url.replace(/^https?:\/\//, '')}</ExtLink>
            {school.user_name ? <> · 已登录为 {school.user_name}</> : null}
            {' · '}上次同步 {fmtRelative(school.last_sync_at)}
          </div>
          {school.auth_mode === 'session' && school.login_at && school.status === 'ok' ? (
            <div className="small" style={{ marginTop: 3, color: 'var(--moss)' }}>
              ● 登录已保持 {sinceText(school.login_at)}
              {school.renewals ? ` · 自动续期 ${school.renewals} 次` : ''}
              {school.alive_at ? ` · ${fmtRelative(school.alive_at)}确认有效` : ''}
            </div>
          ) : null}
        </div>
        <div className="row">
          {school.auth_mode === 'session' ? (
            <button type="button" className={`btn ${needsLogin ? 'btn-seal' : ''}`} disabled={waiting || busy === 'login'}
              onClick={() => run('login', () => api(`/api/schools/${school.id}/login`, { method: 'POST' }))}>
              {waiting ? <span className="spinner" /> : null}
              {waiting ? '等待登录…' : school.hasAuth ? '重新登录' : '登录'}
            </button>
          ) : null}
          <button type="button" className="btn" disabled={busy !== null || !school.hasAuth && !school.ics_url}
            onClick={() => run('sync', () => api('/api/sync', { method: 'POST', body: { schoolId: school.id } }))}>
            立即同步
          </button>
          <button type="button" className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? '收起' : '更多'}</button>
        </div>
      </div>

      {waiting ? (
        <div className="callout info" style={{ marginTop: 14, alignItems: 'center' }}>
          <Icon name="window" size={16} />
          <span className="grow">{login.message}</span>
          <button type="button" className="btn btn-sm" onClick={() => run('login', () => api(`/api/schools/${school.id}/login`, { method: 'POST' }))}>没看到窗口？重新打开</button>
        </div>
      ) : null}
      {login.status === 'failed' ? <div className="callout bad" style={{ marginTop: 14 }}>{login.message}</div> : null}
      {/* only right after logging in: later it would still say "syncing" long after the sync finished */}
      {login.status === 'success' && school.status === 'ok' && login.startedAt && Date.now() - Date.parse(login.startedAt) < 3 * 60_000
        ? <div className="callout ok" style={{ marginTop: 14 }}>✓ {login.message}，正在同步数据…</div> : null}
      {school.status !== 'ok' && school.status_detail ? <div className="callout bad" style={{ marginTop: 14 }}>{school.status_detail}</div> : null}
      {school.status === 'ok' && school.failStreak >= 3 ? <div className="callout warn" style={{ marginTop: 14 }}>最近 {school.failStreak} 次同步都有部分失败，详情见下方「同步日志」。</div> : null}
      {error ? <div className="callout bad" style={{ marginTop: 14 }}>{error}</div> : null}

      {open ? (
        <div className="stack" style={{ marginTop: 18 }}>
          <label className="field">
            <span>日历订阅链接（.ics）· 登录后自动获取；登录过期时用它兜底截止日期</span>
            <div className="row">
              <input className="input input-mono grow" value={ics} placeholder="https://…/feeds/calendars/user_….ics" onChange={(e) => setIcs(e.target.value)} />
              <button type="button" className="btn btn-sm" disabled={busy !== null || ics === (school.ics_url ?? '')} onClick={() => patch({ icsUrl: ics })}>保存</button>
            </div>
          </label>

          <div className="field">
            <span>常用链接（例如学生门户、Macmillan Achieve）</span>
            {links.map((l, i) => (
              <div className="row" key={i}>
                <input className="input" style={{ width: 150 }} value={l.label} placeholder="名称" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <input className="input input-mono grow" value={l.url} placeholder="https://" onChange={(e) => setLinks(links.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLinks(links.filter((_, j) => j !== i))}>移除</button>
              </div>
            ))}
            <div className="row">
              <button type="button" className="btn btn-sm" onClick={() => setLinks([...links, { label: '', url: '' }])}>+ 添加链接</button>
              <button type="button" className="btn btn-sm" disabled={busy !== null || JSON.stringify(links) === JSON.stringify(school.links)} onClick={() => patch({ links: links.filter((l) => l.label || l.url) })}>保存链接</button>
            </div>
          </div>

          <div className="row">
            <label className="row small muted">颜色 <input type="color" value={school.color} onChange={(e) => patch({ color: e.target.value })} /></label>
          </div>

          <details>
            <summary className="small muted">高级：这所学校允许 Access Token？</summary>
            <div className="stack" style={{ marginTop: 10 }}>
              <p className="hint" style={{ margin: 0 }}>大多数学校不需要这个。只有学校允许在 Canvas「设置 → Approved Integrations」里生成令牌时才填；填了就不再用浏览器登录。</p>
              <div className="row">
                <input className="input input-mono grow" type="password" value={token} placeholder={school.hasToken ? '已保存令牌（留空并保存可移除）' : '粘贴 Access Token'} onChange={(e) => setToken(e.target.value)} />
                <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={() => patch({ token }).then(() => setToken(''))}>保存令牌</button>
              </div>
            </div>
          </details>

          <hr className="divider" />
          <button type="button" className="btn btn-sm btn-danger" style={{ alignSelf: 'flex-start' }} disabled={busy !== null}
            onClick={() => {
              if (confirm(`删除「${school.name}」？本机保存的这所学校的数据和登录状态都会删除（不影响 Canvas 本身）。`)) {
                void run('delete', () => api(`/api/schools/${school.id}`, { method: 'DELETE' }));
              }
            }}>
            删除这所学校
          </button>
        </div>
      ) : null}
    </article>
  );
}
