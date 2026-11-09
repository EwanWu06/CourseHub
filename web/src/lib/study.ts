// Helpers for the study guide pages.

export interface SourceRef { material_id: string; page: number | null }

/** One entry per material (first-mention order) with its cited pages sorted and de-duplicated. */
export function groupSources(sources: SourceRef[]): { material_id: string; pages: number[] }[] {
  const groups = new Map<string, Set<number>>();
  for (const s of sources) {
    const pages = groups.get(s.material_id) ?? new Set<number>();
    if (typeof s.page === 'number') pages.add(s.page);
    groups.set(s.material_id, pages);
  }
  return [...groups].map(([material_id, pages]) => ({ material_id, pages: [...pages].sort((a, b) => a - b) }));
}

/** [28, 30, 31, 32, 36] → "第 28、30–32、36 页" */
export function pagesLabel(pages: number[]): string {
  if (pages.length === 0) return '';
  const parts: string[] = [];
  for (let i = 0; i < pages.length; ) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j - i >= 2 ? `${pages[i]}–${pages[j]}` : pages.slice(i, j + 1).join('、'));
    i = j + 1;
  }
  return `第 ${parts.join('、')} 页`;
}
