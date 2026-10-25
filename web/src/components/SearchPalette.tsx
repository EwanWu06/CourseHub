import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { api } from '../api.ts';
import { usePresence } from '../lib/presence.ts';
import { searchEntries } from '../lib/search.ts';
import type { SearchEntry, SearchGroup } from '../lib/search.ts';
import { navigate } from '../router.tsx';
import { Icon } from './Icon.tsx';

/** ⌘K / Ctrl+K / "/" search over tasks, courses, files, pages, announcements. */
export function SearchPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [entries, setEntries] = useState<SearchEntry[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = usePresence(open, 160);

  useEffect(() => {
    if (!open) return;
    setQ('');
    setEntries([]);
    setActive(0);
    const t = setTimeout(() => input.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || !term) {
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    let live = true;
    const t = setTimeout(() => {
      api<{ groups: SearchGroup[] }>(`/api/search?q=${encodeURIComponent(term)}`)
        .then((r) => {
          if (!live) return;
          setEntries(searchEntries(r));
          setActive(0);
        })
        .catch(() => live && setEntries([]))
        .finally(() => live && setLoading(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q, open]);

  if (!shown.mounted) return null;
  const go = (e: SearchEntry) => {
    onClose();
    if ('internal' in e.target) navigate(e.target.internal);
    else window.open(e.target.external, '_blank', 'noopener');
  };
  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'Escape') onClose();
    else if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setActive((a) => Math.min(entries.length - 1, a + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (ev.key === 'Enter' && entries[active]) {
      ev.preventDefault();
      go(entries[active]);
    }
  };

  let lastGroup = '';
  return (
    <div className="palette-backdrop" data-state={shown.closing ? 'closing' : 'open'} onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="搜索" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Icon name="search" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey} placeholder="搜作业、考试、课程、文件、页面、公告…" aria-label="搜索内容" />
          {loading ? <span className="spinner" /> : <kbd>esc</kbd>}
        </div>
        <div className="palette-results" role="listbox">
          {q.trim() && !loading && entries.length === 0 ? <p className="small muted palette-empty">没找到「{q.trim()}」。试试英文关键词，比如作业名里的一个词。</p> : null}
          {!q.trim() ? <p className="small muted palette-empty">输入关键词，所有学校一起搜。↑↓ 选择，回车打开。</p> : null}
          {entries.map((e, i) => {
            const head = e.group !== lastGroup ? <div className="palette-group">{e.group}</div> : null;
            lastGroup = e.group;
            return (
              <div key={e.key}>
                {head}
                <button type="button" role="option" aria-selected={i === active} className={`palette-item ${i === active ? 'is-active' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => go(e)}>
                  <span className="grow">
                    <span className="palette-title">{e.title}</span>
                    <span className="small muted palette-sub">{e.color ? <i className="palette-dot" style={{ ['--c' as string]: e.color }} /> : null}{e.sub}</span>
                  </span>
                  {'external' in e.target ? <Icon name="external" size={14} /> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
