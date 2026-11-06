import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import type { MouseEvent } from 'react';
import { navigate } from '../router.tsx';

/**
 * Canvas content (pages, announcements, syllabus). The server already rewrote links and proxied images;
 * here it is sanitized and shown on a light "paper" sheet in both themes so teacher-chosen colors stay readable.
 */
export function CanvasHtml({ html, empty = '（没有内容）' }: { html: string | null; empty?: string }) {
  const clean = useMemo(() => DOMPurify.sanitize(html ?? '', { ADD_ATTR: ['target'], FORBID_TAGS: ['style', 'form', 'input', 'button'] }), [html]);
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href');
    if (a && href && href.startsWith('/') && !href.startsWith('/proxy/') && !a.target && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      navigate(href);
    }
  };
  if (!clean.trim()) return <p className="muted">{empty}</p>;
  // eslint-disable-next-line react/no-danger
  return <div className="canvas-paper" onClick={onClick} dangerouslySetInnerHTML={{ __html: clean }} />;
}
