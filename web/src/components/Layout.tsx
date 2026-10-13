import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api, getConnection, onConnection, refreshAll, useApi } from '../api.ts';
import { currentBuild } from '../lib/build.ts';
import { fmtRelative } from '../format.ts';
import { Link, useLocation } from '../router.tsx';
import type { Overview, SchoolView, SyncStatus } from '../types.ts';
import { Icon } from './Icon.tsx';
import { SearchPalette } from './SearchPalette.tsx';

const NAV = [
  { to: '/', label: '今天', icon: 'today' },
  { to: '/deadlines', label: '截止日期', icon: 'deadlines' },
  { to: '/courses', label: '课程', icon: 'courses' },
  { to: '/study', label: '学习', icon: 'study' },
  { to: '/reports', label: '报告', icon: 'reports' },
  { to: '/notices', label: '通知', icon: 'bell' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

const STATE_LABEL: Record<SchoolView['status'], string> = { ok: '正常', needs_login: '需登录', new: '未登录', error: '出错' };

/** Watches the server: shows when it can't be reached (and refreshes everything once it's back), and notices a newer web build. */
function useServerWatch(path: string): { down: boolean; updated: boolean } {
  const [down, setDown] = useState(getConnection() === 'down');
  const [updated, setUpdated] = useState(false);
  const mine = useRef(currentBuild());

  useEffect(() => onConnection((c) => {
    setDown(c === 'down');
    if (c === 'up') refreshAll(); // back after a restart: everything on screen refetches
  }), []);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const h = await api<{ build: string | null }>('/api/health', { timeoutMs: 8000 });
        if (alive && mine.current && h.build && h.build !== mine.current) setUpdated(true);
      } catch {
        // the connection state already says so
      }
    };
    void check();
    const id = setInterval(() => void check(), down ? 3000 : 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [down]);

  // the next navigation after an update loads the new build
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (updated) location.reload();
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  return { down, updated };
}

export function Layout({ children }: { children: ReactNode }) {
  const { path } = useLocation();
  const sync = useApi<SyncStatus>('/api/sync', { poll: 4000 });
  const schools = useApi<SchoolView[]>('/api/schools', { poll: 30_000 });
  const overview = useApi<Overview>('/api/overview', { poll: 120_000 });
  const notices = useApi<{ unread: number }>('/api/notices?limit=0', { poll: 30_000 });
  const status = useApi<{ issues: unknown[] }>('/api/status', { poll: 120_000 });
  const wasRunning = useRef(false);
  const [searching, setSearching] = useState(false);
  const { down, updated } = useServerWatch(path);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName));
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearching((v) => !v);
      } else if (e.key === '/' && !typing) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
        <button type="button" className="side-search" onClick={() => setSearching(true)}>
          <Icon name="search" size={15} /><span className="grow">搜索</span><kbd>⌘K</kbd>
        </button>
        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => {
            const active = n.to === '/' ? path === '/' : path.startsWith(n.to);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? 'page' : undefined}>
                <Icon name={n.icon} />
                {n.label}
                {n.to === '/' && urgent > 0 ? <span className="count">{urgent}</span> : null}
                {n.to === '/notices' && (notices.data?.unread ?? 0) > 0 ? <span className="count count-soft">{notices.data!.unread}</span> : null}
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
          <div className="side-links">
            <Link to="/status" aria-current={path === '/status' ? 'page' : undefined}>
              <Icon name="pulse" size={15} />系统状态{(status.data?.issues.length ?? 0) > 0 ? <span className="new-dot" title={`${status.data!.issues.length} 个问题`} /> : null}
            </Link>
            <Link to="/help" aria-current={path === '/help' ? 'page' : undefined}><Icon name="help" size={15} />帮助</Link>
          </div>
        </div>
      </aside>
      <main className="main">
        {down ? <div className="callout warn conn-banner">连不上 Course Hub 后台（可能正在重启或电脑刚醒来），正在自动重连……</div> : null}
        {updated ? (
          <div className="callout info conn-banner">
            Course Hub 已更新，切换页面时会自动换成新版本。
            <button type="button" className="btn btn-sm right" onClick={() => location.reload()}>现在刷新</button>
          </div>
        ) : null}
        {children}
      </main>
      <SearchPalette open={searching} onClose={() => setSearching(false)} />
    </div>
  );
}
