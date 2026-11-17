import { useEffect } from 'react';
import type { ReactNode, CSSProperties } from 'react';

/** The browser tab names the page ("截止日期 · Course Hub"); null keeps the app's own name. */
export function useDocumentTitle(name: string | null): void {
  useEffect(() => {
    document.title = name ? `${name} · Course Hub` : 'Course Hub · 课程中心';
  }, [name]);
}

export function Masthead({ kicker, title, aside }: { kicker: ReactNode; title: ReactNode; aside?: ReactNode }) {
  useDocumentTitle(typeof title === 'string' ? title : null);
  return (
    <header className="masthead">
      <div>
        <div className="kicker">{kicker}</div>
        <h1 className="title">{title}</h1>
      </div>
      {aside ? <div className="masthead-aside">{aside}</div> : null}
    </header>
  );
}

/** A titled part of a page; on long pages (`.is-numbered`) the title takes a roman numeral from the stylesheet, so
 *  numbering never skips when a section is left out. */
export function Section({ title, note, children }: { title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {note ? <span className="note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function Empty({ glyph = '空', children }: { glyph?: string; children: ReactNode }) {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden="true">{glyph}</span>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="toggle" onClick={() => onChange(!checked)} />;
}

export function Badge({ tone, children }: { tone?: 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <span className={`badge ${tone ?? ''}`}>
      <span className="pip" />
      {children}
    </span>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="加载中" />;
}

/** A page or section still loading: three small seals inking in turn (shown only if it takes a moment). */
export function Loading() {
  return <div className="loading" role="status" aria-label="加载中"><i /><i /><i /></div>;
}

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="callout bad" role="alert">{error}</div> : null;
}

export function ExtLink({ href, children, className, style, title }: { href: string | null; children: ReactNode; className?: string; style?: CSSProperties; title?: string }) {
  if (!href) return <span className={className} style={style} title={title}>{children}</span>;
  return <a className={`ext ${className ?? ''}`} href={href} target="_blank" rel="noopener noreferrer" style={style} title={title}>{children}</a>;
}

/** A time of day as one 24-hour select in 15-minute steps, like the sync window's ("7:00", not the OS's "07:00 AM"). */
export function TimeSelect({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const steps = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}`);
  const options = steps.includes(value) ? steps : [...steps, value].sort();
  return (
    <select className="select" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}>
      {options.map((t) => <option key={t} value={t}>{Number(t.slice(0, 2))}:{t.slice(3)}</option>)}
    </select>
  );
}
