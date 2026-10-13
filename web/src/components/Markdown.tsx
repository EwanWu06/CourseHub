import DOMPurify from 'dompurify';
import { useMemo } from 'react';
import { mathMarkdown } from '../lib/markdown.ts';

/** AI-written Markdown with LaTeX; sanitized before display. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(mathMarkdown(text ?? '')), [text]);
  // eslint-disable-next-line react/no-danger
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}
