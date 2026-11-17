/** "/courses/:id/:tab?" style matching; returns decoded params or null. */
export function matchRoute(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split('/').filter(Boolean);
  const s = path.split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    const seg = p[i];
    if (seg.startsWith(':')) {
      const optional = seg.endsWith('?');
      const name = seg.slice(1, optional ? -1 : undefined);
      if (i >= s.length) {
        if (optional) continue;
        return null;
      }
      params[name] = decodeURIComponent(s[i]);
    } else if (seg !== s[i]) {
      return null;
    }
  }
  return s.length > p.length ? null : params;
}
