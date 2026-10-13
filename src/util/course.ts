// Short, human course names: "2026 Fall - ENGL C1000 (2074) …" → "ENGL C1000".

// SUBJECT [LEVEL] NUMBER, e.g. "BIO 3", "ENGL C1000", "LIFESCI XL 7A", "GENINT 750.1", "MATH 7"
const CODE_RE = /\b([A-Z][A-Z&]{1,9})((?:\s+[A-Z]{1,3})?)\s+([A-Z]?\d{1,4}(?:\.\d{1,2})?[A-Z]{0,2})\b/g;

function findCode(text: string | null): string | null {
  if (!text) return null;
  for (const m of text.matchAll(CODE_RE)) {
    const num = m[3];
    if (/^(19|20)\d{2}$/.test(num)) continue; // a year, e.g. "SMC 2026"
    return `${m[1]}${m[2]} ${num}`.replace(/\s+/g, ' ');
  }
  return null;
}

export function courseDisplayName(c: { name: string; code: string | null; nickname: string | null }): string {
  if (c.nickname?.trim()) return c.nickname.trim();
  const found = findCode(c.name) ?? findCode(c.code);
  if (found) return found;
  if (c.code && c.code.length <= 24 && !/^\d+$/.test(c.code)) return c.code;
  return c.name.length <= 40 ? c.name : c.code ?? c.name.slice(0, 40);
}
