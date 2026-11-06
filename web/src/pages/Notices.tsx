import { useEffect } from 'react';
import { api, refreshAll, useApi } from '../api.ts';
import { fmtRelative } from '../format.ts';
import { Empty, ErrorNote, ExtLink, Masthead, Loading } from '../components/ui.tsx';
import { dayLabel, NOTICE_KIND, noticeTarget } from '../lib/notices.ts';
import { Link } from '../router.tsx';

interface NoticeItem { id: number; kind: string; title: string; subtitle: string | null; body: string; url: string | null; created_at: string; read_at: string | null }

export function Notices() {
  const { data, error, reload } = useApi<{ unread: number; items: NoticeItem[] }>('/api/notices?limit=200');
  const hasUnread = (data?.unread ?? 0) > 0;
  useEffect(() => {
    if (!hasUnread) return;
    // seen now; keep the "new" marks on screen until the next visit
    void api('/api/notices/read', { method: 'POST' }).then(refreshAll).catch(() => undefined);
  }, [hasUnread]);

  const test = async () => {
    await api('/api/notices/test', { method: 'POST' });
    reload();
  };

  let lastDay = '';
  return (
    <div className="page">
      <Masthead kicker="Notices" title="通知记录" aside={<button type="button" className="btn btn-sm" onClick={() => void test()}>发一条测试通知</button>} />
      <p className="small muted" style={{ marginTop: -8 }}>系统弹出过的每一条通知都在这里，错过了也能补看（保留 60 天）。</p>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.items.length === 0 ? <Empty glyph="铃">还没有通知。截止提醒、日报、新公告都会出现在这里。</Empty> : (
        <div className="notice-log">
          {data.items.map((n) => {
            const day = dayLabel(n.created_at);
            const head = day !== lastDay ? <h3 className="notice-day">{day}</h3> : null;
            lastDay = day;
            const target = noticeTarget(n.url);
            const inner = (
              <>
                <span className={`badge notice-kind kind-${n.kind}`}>{NOTICE_KIND[n.kind] ?? n.kind}</span>
                <span className="grow">
                  <b>{n.title}</b>{n.subtitle ? <span className="muted"> · {n.subtitle}</span> : null}
                  <span className="notice-body">{n.body}</span>
                </span>
                <span className="small muted nowrap">{fmtRelative(n.created_at)}</span>
                {!n.read_at ? <span className="new-dot" aria-label="未读" /> : null}
              </>
            );
            return (
              <div key={n.id}>
                {head}
                {target && 'internal' in target ? <Link to={target.internal} className="list-row notice-row">{inner}</Link>
                  : target ? <ExtLink href={target.external} className="list-row notice-row">{inner}</ExtLink>
                    : <div className="list-row notice-row">{inner}</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
