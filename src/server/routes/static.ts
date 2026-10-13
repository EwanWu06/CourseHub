import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { ROOT_DIR } from '../../config.ts';

const DIST = path.join(ROOT_DIR, 'web', 'dist');
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
};

const NOT_BUILT = '<!doctype html><meta charset="utf-8"><title>Course Hub</title><p>网页还没有构建：在 ~/CourseHub 运行 <code>npm run build:web</code>。</p>';

let cached: { dist: string; mtime: number; id: string | null } | null = null;

/** Which web build is being served (its hashed entry script), so open pages can tell they are out of date. */
export function webBuildId(dist: string = DIST): string | null {
  const index = path.join(dist, 'index.html');
  try {
    const mtime = statSync(index).mtimeMs;
    if (cached && cached.dist === dist && cached.mtime === mtime) return cached.id;
    const id = readFileSync(index, 'utf8').match(/src="\/assets\/(index-[A-Za-z0-9_-]+)\.js"/)?.[1] ?? null;
    cached = { dist, mtime, id };
    return id;
  } catch {
    return null;
  }
}

/** Serves the built React app; unknown paths fall back to index.html (client-side routing). */
export function registerStatic(app: Hono): void {
  app.get('*', (c) => {
    const pathname = decodeURIComponent(new URL(c.req.url).pathname);
    const file = path.normalize(path.join(DIST, pathname));
    if (file.startsWith(DIST + path.sep) && existsSync(file) && statSync(file).isFile()) {
      const immutable = pathname.startsWith('/assets/');
      return new Response(readFileSync(file), {
        headers: { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache' },
      });
    }
    const index = path.join(DIST, 'index.html');
    return c.html(existsSync(index) ? readFileSync(index, 'utf8') : NOT_BUILT);
  });
}
