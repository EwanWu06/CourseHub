// HTML helpers for Canvas content (pages, announcements, assignment descriptions).

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    const lower = code.toLowerCase();
    if (lower.startsWith('#x')) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith('#')) return String.fromCodePoint(parseInt(lower.slice(1), 10));
    return NAMED[lower] ?? m;
  });
}

/** Readable plain text for AI input and previews: keeps paragraphs and list bullets. */
export function htmlToText(html: string): string {
  const s = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|tr|ul|ol|table|section|blockquote|pre)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|tr|ul|ol|table|section|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(s)
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Canvas paths the local proxy may fetch with the user's session (images and file previews only). */
export const PROXY_ALLOW: RegExp[] = [
  /^\/(courses\/\d+\/)?files\/\d+\/(preview|download|thumbnail)/,
  /^\/users\/\d+\/files\/\d+\//,
  /^\/equation_images\//,
  /^\/images\//,
];

export interface RewriteContext {
  schoolId: string;
  baseUrl: string;
  courseMap: Map<string, string>; // canvas course id → Course Hub course id
  pageMap: Map<string, string>; // "<canvas course id>/<page slug>" → Course Hub page id
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function getAttr(attrs: string, name: string): string | null {
  const m = attrs.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
}

function setAttr(attrs: string, name: string, value: string): string {
  const re = new RegExp(`\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  return re.test(attrs) ? attrs.replace(re, `${name}="${escAttr(value)}"`) : `${attrs} ${name}="${escAttr(value)}"`;
}

function dropAttr(attrs: string, name: string): string {
  return attrs.replace(new RegExp(`\\s*\\b${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'gi'), '');
}

/**
 * Prepares Canvas HTML for viewing inside Course Hub: scripts removed, Canvas media proxied with the
 * stored session, links to synced pages kept in-app, everything else opened in a new tab.
 * The browser still sanitizes the result (DOMPurify) — this is not the security boundary.
 */
export function rewriteCanvasHtml(html: string, ctx: RewriteContext): string {
  const origin = new URL(ctx.baseUrl).origin;
  const canvasPath = (url: string): string | null => {
    if (url.startsWith('/') && !url.startsWith('//')) return url;
    try {
      const u = new URL(url);
      return u.origin === origin ? u.pathname + u.search + u.hash : null;
    } catch {
      return null;
    }
  };
  const external = (attrs: string, href: string) => `${setAttr(dropAttr(dropAttr(attrs, 'target'), 'rel'), 'href', href)} target="_blank" rel="noopener"`;

  let out = html.replace(/<script\b[\s\S]*?<\/script\s*>/gi, '');
  out = out.replace(/<iframe\b([^>]*)>(?:[\s\S]*?<\/iframe\s*>)?/gi, (_m, attrs: string) => {
    const src = getAttr(attrs, 'src');
    if (!src) return '';
    const p = canvasPath(src);
    return `<a href="${escAttr(p ? origin + p : src)}" target="_blank" rel="noopener">▶ 嵌入内容：在新窗口打开</a>`;
  });
  out = out.replace(/<(img|source|video|audio)\b([^>]*)>/gi, (m, tag: string, attrs: string) => {
    const src = getAttr(attrs, 'src');
    const p = src ? canvasPath(src) : null;
    if (!src || !p) return m;
    const pathOnly = p.split(/[?#]/)[0];
    const target = PROXY_ALLOW.some((re) => re.test(pathOnly)) ? `/proxy/${ctx.schoolId}${p}` : origin + p;
    return `<${tag}${setAttr(attrs, 'src', target)}>`;
  });
  out = out.replace(/<a\b([^>]*)>/gi, (m, attrs: string) => {
    const href = getAttr(attrs, 'href');
    if (!href || href.startsWith('#') || /^(mailto|tel):/i.test(href)) return m;
    const p = canvasPath(href);
    if (p) {
      const page = p.match(/^\/courses\/(\d+)\/pages\/([^/?#]+)/);
      if (page) {
        const pageId = ctx.pageMap.get(`${page[1]}/${decodeURIComponent(page[2])}`);
        const courseId = ctx.courseMap.get(page[1]);
        if (pageId && courseId) return `<a${setAttr(dropAttr(dropAttr(attrs, 'target'), 'rel'), 'href', `/courses/${courseId}/pages/${pageId}`)}>`;
      }
      return `<a${external(attrs, origin + p)}>`;
    }
    return /^https?:/i.test(href) ? `<a${external(attrs, href)}>` : m;
  });
  return out;
}
