import { useApi } from '../api.ts';
import { fmtRelative } from '../format.ts';
import { Empty, ErrorNote, ExtLink, Masthead, Spinner } from '../components/ui.tsx';
import type { ConversationT } from '../types.ts';

/** Read-only inbox list; opening a message happens in Canvas (so nothing is marked read from here). */
export function Inbox() {
  const { data, error } = useApi<ConversationT[]>('/api/inbox');
  return (
    <div className="page">
      <Masthead kicker="Inbox" title="收件箱" aside={<span className="small">只显示列表，不会把消息标为已读</span>} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.length === 0 ? <Empty glyph="信">没有消息。</Empty> : (
        <div className="card list">
          {data.map((m) => (
            <ExtLink key={m.id} href={m.html_url} className={`list-row inbox-row ${m.workflow_state === 'unread' ? 'unread' : ''}`}>
              <span className="dot" style={{ background: m.color }} />
              <span className="grow">
                <span className="inbox-subject">{m.subject}</span>
                <span className="small muted inbox-preview">{m.participants}{m.context_name ? ` · ${m.context_name}` : ''} — {m.last_message ?? ''}</span>
              </span>
              <span className="small muted nowrap">{fmtRelative(m.last_at)}</span>
            </ExtLink>
          ))}
        </div>
      )}
    </div>
  );
}
