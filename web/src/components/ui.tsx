import type { ReactNode } from 'react';

export function Masthead({ kicker, title, aside }: { kicker: string; title: ReactNode; aside?: ReactNode }) {
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

export function Section({ num, title, note, children }: { num?: string; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        {num ? <span className="num">{num}</span> : null}
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
      <span className="glyph">{glyph}</span>
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

export function ErrorNote({ error }: { error: string | null }) {
  return error ? <div className="callout bad" role="alert">{error}</div> : null;
}

export function ExtLink({ href, children, className }: { href: string | null; children: ReactNode; className?: string }) {
  if (!href) return <span className={className}>{children}</span>;
  return <a className={`ext ${className ?? ''}`} href={href} target="_blank" rel="noopener noreferrer">{children}</a>;
}
