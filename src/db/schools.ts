import type { DB } from './index.ts';
import { nowIso } from './index.ts';
import type { SchoolRow } from './types.ts';
import { all, insertRow, one, pick, run, updateRow } from './sql.ts';

export const SCHOOL_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#db2777', '#ca8a04'];

const EDITABLE = ['name', 'base_url', 'color', 'auth_mode', 'ics_url', 'user_name', 'status', 'status_detail',
  'last_sync_at', 'last_ok_at', 'links', 'login_at', 'alive_at', 'renewals'] as const;

/** 'smc.instructure.com/' → 'https://smc.instructure.com'. Plain http is only kept for local test servers. */
export function normalizeBaseUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('请输入 Canvas 网址');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = 'https://' + s;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    throw new Error(`无效的网址：${input}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error(`无效的网址：${input}`);
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
  if (!local && !u.hostname.includes('.')) throw new Error(`无效的网址：${input}`);
  return `${local ? u.protocol : 'https:'}//${u.host}`;
}

export function slugFor(db: DB, name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'school';
  let id = base;
  for (let n = 2; getSchool(db, id); n++) id = `${base}-${n}`;
  return id;
}

export function listSchools(db: DB): SchoolRow[] {
  return all<SchoolRow>(db, 'SELECT * FROM schools ORDER BY created_at, id');
}

export function getSchool(db: DB, id: string): SchoolRow | undefined {
  return one<SchoolRow>(db, 'SELECT * FROM schools WHERE id = $id', { id });
}

export function createSchool(db: DB, input: { name: string; base_url: string; color?: string }): SchoolRow {
  const name = input.name.trim();
  if (!name) throw new Error('请输入学校名称');
  const base_url = normalizeBaseUrl(input.base_url);
  if (one(db, 'SELECT id FROM schools WHERE base_url = $base_url', { base_url })) throw new Error('这个 Canvas 网址已经添加过了');
  const used = new Set(listSchools(db).map((s) => s.color));
  const color = input.color ?? SCHOOL_PALETTE.find((c) => !used.has(c)) ?? SCHOOL_PALETTE[used.size % SCHOOL_PALETTE.length];
  const id = slugFor(db, name);
  insertRow(db, 'schools', { id, name, base_url, color, auth_mode: 'session', status: 'new', links: '[]', created_at: nowIso() });
  return getSchool(db, id)!;
}

export function updateSchool(db: DB, id: string, patch: Partial<SchoolRow>): void {
  const p = pick(patch, EDITABLE.filter((k) => k in patch));
  updateRow(db, 'schools', p, 'id = $__id', { __id: id });
}

export function deleteSchool(db: DB, id: string): void {
  run(db, 'DELETE FROM schools WHERE id = $id', { id });
}
