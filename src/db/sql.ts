// Small helpers over node:sqlite: value binding, cached statements, explicit-column upserts.
import type { StatementSync } from 'node:sqlite';
import type { DB } from './index.ts';

type Bound = string | number | bigint | null | Uint8Array;

export function bindValue(v: unknown): Bound {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || v instanceof Uint8Array) return v;
  return JSON.stringify(v);
}

export function bindAll(obj: Record<string, unknown>): Record<string, Bound> {
  const out: Record<string, Bound> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = bindValue(v);
  return out;
}

const cache = new WeakMap<DB, Map<string, StatementSync>>();

export function stmt(db: DB, sql: string): StatementSync {
  let byDb = cache.get(db);
  if (!byDb) cache.set(db, (byDb = new Map()));
  let s = byDb.get(sql);
  if (!s) byDb.set(sql, (s = db.prepare(sql)));
  return s;
}

export function pick<K extends string>(row: Record<string, unknown>, cols: readonly K[]): Record<K, unknown> {
  const out = {} as Record<K, unknown>;
  for (const c of cols) out[c] = row[c];
  return out;
}

export function all<T>(db: DB, sql: string, params: Record<string, unknown> = {}): T[] {
  return stmt(db, sql).all(bindAll(params)) as unknown as T[];
}

export function one<T>(db: DB, sql: string, params: Record<string, unknown> = {}): T | undefined {
  return stmt(db, sql).get(bindAll(params)) as unknown as T | undefined;
}

export function run(db: DB, sql: string, params: Record<string, unknown> = {}) {
  return stmt(db, sql).run(bindAll(params));
}

export function insertRow(db: DB, table: string, row: Record<string, unknown>) {
  const cols = Object.keys(row);
  return run(db, `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => '$' + c).join(', ')})`, row);
}

/** UPDATE table SET <keys of patch> WHERE <where>; where params must not collide with patch keys. */
export function updateRow(db: DB, table: string, patch: Record<string, unknown>, where: string, whereParams: Record<string, unknown>) {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  run(db, `UPDATE ${table} SET ${cols.map((c) => `${c} = $${c}`).join(', ')} WHERE ${where}`, { ...patch, ...whereParams });
}

export function placeholders(prefix: string, values: readonly unknown[]): { sql: string; params: Record<string, unknown> } {
  const params: Record<string, unknown> = {};
  values.forEach((v, i) => (params[`${prefix}${i}`] = v));
  return { sql: values.map((_, i) => `$${prefix}${i}`).join(', '), params };
}
