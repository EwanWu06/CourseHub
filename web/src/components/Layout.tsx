import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { api, getConnection, onConnection, refreshAll, useApi } from '../api.ts';
import { currentBuild } from '../lib/build.ts';
import { usePresence } from '../lib/presence.ts';
import { fmtRelative } from '../format.ts';
import { Link, useLocation } from '../router.tsx';
import type { Overview, SchoolView, SyncStatus } from '../types.ts';
import { Icon } from './Icon.tsx';
import { SearchPalette } from './SearchPalette.tsx';
import { Toaster } from './Toaster.tsx';

const NAV = [
  { to: '/', label: '今天', icon: 'today' },
  { to: '/deadlines', label: '截止日期', icon: 'deadlines' },
  { to: '/courses', label: '课程', icon: 'courses' },
  { to: '/study', label: '学习', icon: 'study' },
  { to: '/reports', label: '报告', icon: 'reports' },
  { to: '/notices', label: '通知', icon: 'bell' },
  { to: '/settings', label: '设置', icon: 'settings' },
];

/** phones: the four places used every day sit in the tab bar, the rest under 更多 */
const TABS = NAV.slice(0, 4);
const MORE = NAV.slice(4);

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

  const urgent = (overview.data?.counts?.overdue ?? 0) + (overview.data?.counts?.today ?? 0);
  const lastSync = schools.data?.map((s) => s.last_sync_at).filter(Boolean).sort().at(-1) ?? null;
  const unread = notices.data?.unread ?? 0;
  const issues = status.data?.issues?.length ?? 0;
  const running = !!sync.data?.running;
  const [moreOpen, setMoreOpen] = useState(false);
  const more = usePresence(moreOpen, 220);
  useEffect(() => setMoreOpen(false), [path]);
  // the grip really drags: pull the sheet down past 80px and it goes
  const sheet = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const onGripDown = (e: ReactPointerEvent) => {
    drag.current = { y: e.clientY, dy: 0 };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag.current || !sheet.current) return;
    drag.current.dy = Math.max(0, e.clientY - drag.current.y);
    sheet.current.style.transition = 'none';
    sheet.current.style.transform = `translateY(${drag.current.dy}px)`;
  };
  const onGripUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !sheet.current) return;
    sheet.current.style.transition = '';
    sheet.current.style.transform = '';
    if (d.dy > 80) setMoreOpen(false);
  };
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moreOpen]);
  const isActive = (to: string) => (to === '/' ? path === '/' : path.startsWith(to));

  const syncNow = async () => {
    try {
      await api('/api/sync', { method: 'POST', body: {} });
    } catch {
      // already running
    }
    sync.reload();
  };

  const counter = (to: string) => (to === '/' && urgent > 0 ? <span className="count">{urgent}</span>
    : to === '/notices' && unread > 0 ? <span className="count count-soft">{unread}</span> : null);

  const schoolList = (
    <div className="school-list">
      {(schools.data ?? []).map((s) => (
        <Link key={s.id} to="/settings" className={`side-school ${s.status === 'ok' ? '' : 'warn'}`} title={s.status_detail ?? s.base_url} style={{ ['--c' as string]: s.color }}>
          <span className="dot" />
          <span className="grow ellipsis">{s.name}</span>
          <span className="state">{STATE_LABEL[s.status]}</span>
        </Link>
      ))}
    </div>
  );
  const syncControl = (
    <div className="sync-row">
      <button type="button" className={`btn btn-sm sync-btn ${running ? 'is-running' : ''}`} onClick={syncNow} disabled={running || !schools.data?.length}>
        <Icon name="sync" size={14} />
        {running ? '同步中…' : '立即同步'}
      </button>
      <span className="small muted nowrap">{fmtRelative(lastSync)}</span>
    </div>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="brand" aria-label="Course Hub 课程中心">
          <span className="brand-seal" aria-hidden="true">课</span>
          <span className="brand-text">
            <span className="brand-mark">Course Hub</span>
            <span className="brand-zh">课程中心</span>
          </span>
        </Link>
        <button type="button" className="side-search" onClick={() => setSearching(true)} aria-label="搜索">
          <Icon name="search" size={15} /><span className="grow">搜索作业、课件…</span><kbd>⌘K</kbd>
        </button>
        <nav className="nav" aria-label="主导航">
          {NAV.map((n) => {
            const active = isActive(n.to);
            return (
              <Link key={n.to} to={n.to} aria-current={active ? 'page' : undefined}>
                {active ? <span className="nav-ind" aria-hidden="true" /> : null}
                <Icon name={n.icon} />
                <span className="nav-label">{n.label}</span>
                {counter(n.to)}
              </Link>
            );
          })}
        </nav>
        <div className="side-foot">
          {schoolList}
          {syncControl}
          <div className="side-links">
            <Link to="/status" aria-current={path === '/status' ? 'page' : undefined}>
              <Icon name="pulse" size={15} />系统状态{issues > 0 ? <span className="new-dot" title={`${issues} 个问题`} /> : null}
            </Link>
            <Link to="/help" aria-current={path === '/help' ? 'page' : undefined}><Icon name="help" size={15} />帮助</Link>
          </div>
        </div>
      </aside>
      <nav className="tabbar" aria-label="主导航">
        {TABS.map((n) => (
          <Link key={n.to} to={n.to} className="tab" aria-current={isActive(n.to) ? 'page' : undefined}>
            <Icon name={n.icon} size={21} />
            <span>{n.label === '截止日期' ? '截止' : n.label}</span>
            {counter(n.to)}
          </Link>
        ))}
        <button type="button" className="tab" aria-expanded={moreOpen} aria-current={MORE.some((n) => isActive(n.to)) || ['/status', '/help', '/inbox'].includes(path) ? 'page' : undefined}
          onClick={() => setMoreOpen((v) => !v)}>
          <Icon name="more" size={21} />
          <span>更多</span>
          {unread > 0 || issues > 0 ? <span className="tab-dot" /> : null}
        </button>
      </nav>
      {more.mounted ? (
        <div className="more-backdrop" data-state={more.closing ? 'closing' : 'open'} onClick={() => setMoreOpen(false)} role="presentation">
          <div className="more-sheet" ref={sheet} role="dialog" aria-label="更多" onClick={(e) => e.stopPropagation()}>
            <div className="more-grip" aria-hidden="true" onPointerDown={onGripDown} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={onGripUp} />
            <div className="more-links">
              {[...MORE, { to: '/status', label: '系统状态', icon: 'pulse' }, { to: '/help', label: '帮助', icon: 'help' }].map((n) => (
                <Link key={n.to} to={n.to} className="more-link" aria-current={isActive(n.to) ? 'page' : undefined}>
                  <Icon name={n.icon} size={20} />
                  <span className="grow">{n.label}</span>
                  {counter(n.to)}
                  {n.to === '/status' && issues > 0 ? <span className="new-dot" /> : null}
                </Link>
              ))}
            </div>
            {schoolList}
            {syncControl}
          </div>
        </div>
      ) : null}
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
      <Toaster />
    </div>
  );
}
