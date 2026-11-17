// Markdown with LaTeX math ($…$ inline, $$…$$ display). Math is rendered by KaTeX before markdown so that
// "_" and "*" inside formulas are never treated as emphasis. Output is NOT sanitized — callers must.
import katex from 'katex';
import { marked } from 'marked';

export function mathMarkdown(src: string): string {
  const math: string[] = [];
  const stash = (tex: string, display: boolean) => {
    math.push(katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, output: 'html' }));
    return `@@MATH${math.length - 1}@@`;
  };
  const prepared = src
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => `\n\n${stash(tex, true)}\n\n`)
    .replace(/(?<![\\$\w])\$(?!\s)([^$\n]+?)(?<![\s\\])\$(?!\w)/g, (m, tex: string) =>
      // "$5 and $10" is money, "$4s^3 = 1.17\times10^{-5}$" is math: numbers need a LaTeX-looking body
      /^\d/.test(tex) && !/[\\^_{}=]/.test(tex) ? m : stash(tex, false));
  const html = marked.parse(prepared.split('\n').map(inlineEnumeration).join('\n'), { async: false, gfm: true, breaks: true }) as string;
  return html.replace(/@@MATH(\d+)@@/g, (_m, i: string) => math[Number(i)]);
}

/** "1) a。2) b。3) c" on one line (Claude often enumerates inline) → a Markdown list. A lone "1)" stays as is. */
function inlineEnumeration(line: string): string {
  const head = /^(\s*)1[)）]\s*/.exec(line);
  if (!head) return line;
  const items: string[] = [];
  let rest = line.slice(head[0].length);
  for (let n = 2; ; n++) {
    const at = rest.search(new RegExp(`(?<=^|[\\s。；;，,.!?！？])${n}[)）]`));
    if (at < 0) break;
    items.push(rest.slice(0, at).trim());
    rest = rest.slice(at).replace(new RegExp(`^${n}[)）]\\s*`), '');
  }
  if (items.length === 0) return line;
  items.push(rest.trim());
  return items.map((t, k) => `${head[1]}${k + 1}. ${t}`).join('\n');
}
