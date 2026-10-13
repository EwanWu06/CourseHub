import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { api, refreshAll, useApi } from '../api.ts';
import { fmtRelative } from '../format.ts';
import { Link, useLocation } from '../router.tsx';
import type { Overview, SchoolView, SyncStatus } from '../types.ts';
import { Icon } from './Icon.tsx';

const NAV = [
  { to: '/', label: '今天', icon: 'today' },
  { to: '/deadlines', label: '截止日期', icon: 'deadlines' },
  { to: '/courses', label: '课程', icon: 'courses' },
  { to: '/study', label: '学习', icon: 'study' },
  { to: '/reports', label: '报告', icon: 'reports' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

const STATE_LABEL: Record<SchoolView['status'], string> = { ok: '正常', needs_login: '需登录', new: '未登录', error: '出错' };

export function Layout({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const sync = useApi<SyncStatus>('/api/sync', { poll: 4000 });
  const schools = useApi<SchoolView[]>('/api/schools', { poll: 30_000 });
  const overview = useApi<Overview>('/api/overview', { poll: 120_000 });
  const wasRunning = useRef(false);

  useEffect(() => {
    const running = !!sync.data?.running;
    if (wasRunning.current && !running) refreshAll();
    wasRunning.current = running;
  }, [sync.data?.running]);

  const urgent = (overview.data?.counts.overdue ?? 0) + (overview.data?.counts.today ?? 0);
  const lastSync = schools.data?.map((s) => s.last_sync_at).filter(Boolean).sort().at(-1) ?? null;

  const syncNow = async () => {
    try {
      await api('/api/sync', { method: 'POST', body: {} });
    } catch {
      // already running
    }
    sync.reload();
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand">
          <span className="brand-mark">Course Hub</span>
          <span className="brand-zh">课程中心</span>
        </Link>
        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => {
            const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
                {n.to === '/' && urgent > 0 ? <span className="count">{urgent}</span> : null}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          {(schools.data ?? []).map((s) => (
            <Link key={s.id} to="/settings" className={`side-school ${s.status === 'ok' ? '' : 'warn'}`} title={s.status_detail ?? s.base_url}>
              <span className="dot" style={{ background: s.color }} />
              <span className="grow nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name}</span>
              <span className="state">{STATE_LABEL[s.status]}</span>
            </Link>
          ))}
          <button type="button" className="btn btn-sm" onClick={syncNow} disabled={!!sync.data?.running || !schools.data?.length}>
            {sync.data?.running ? <span className="spinner" /> : <Icon name="sync" size={14} />}
            {sync.data?.running ? '同步中…' : '立即同步'}
          </button>
          <span className="small muted">上次同步：{fmtRelative(lastSync)}</span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
