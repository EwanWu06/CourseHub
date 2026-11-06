import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';
import { MIGRATIONS } from './migrations.ts';

export type DB = DatabaseSync;

const txDepth = new WeakMap<DB, number>();

export function nowIso(): string {
  return new Date().toISOString();
}

export function openDb(file?: string): DB {
  const target = file ?? paths().db;
  if (target !== ':memory:') mkdirSync(path.dirname(target), { recursive: true });
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined;
  for (let v = row ? Number(row.value) : 0; v < MIGRATIONS.length; v++) {
    tx(db, () => {
      db.exec(MIGRATIONS[v]);
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(v + 1));
    });
  }
}

/** Synchronous transaction; nested calls join the outer transaction. Never await inside fn. */
export function tx<T>(db: DB, fn: () => T): T {
  const depth = txDepth.get(db) ?? 0;
  if (depth > 0) {
    txDepth.set(db, depth + 1);
    try {
      return fn();
    } finally {
      txDepth.set(db, depth);
    }
  }
  db.exec('BEGIN IMMEDIATE');
  txDepth.set(db, 1);
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    txDepth.set(db, 0);
  }
}
