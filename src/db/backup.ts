// Daily snapshots of the database (ticks, notes, reports, guides live only here) and repair on start-up:
// a damaged file is moved aside and the newest backup that passes an integrity check takes its place.
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { paths } from '../config.ts';
import { localDateStr } from '../util/time.ts';
import type { DB } from './index.ts';

const NAME = /^coursehub-(\d{4}-\d{2}-\d{2})\.sqlite$/;

export interface BackupInfo { file: string; date: string; bytes: number }

export function listBackups(): BackupInfo[] {
  const dir = paths().backups;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => ({ f, m: NAME.exec(f) }))
    .filter((x): x is { f: string; m: RegExpExecArray } => !!x.m)
    .map(({ f, m }) => ({ file: path.join(dir, f), date: m[1], bytes: statSync(path.join(dir, f)).size }))
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Snapshot for `now`'s local day (once per day); keeps the newest `keep`. Returns the new file, or null. */
export function backupDb(db: DB, now: Date, keep = 14): string | null {
  const dir = paths().backups;
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `coursehub-${localDateStr(now)}.sqlite`);
  if (existsSync(file)) return null;
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  renameSync(tmp, file);
  for (const old of listBackups().slice(keep)) rmSync(old.file, { force: true });
  return file;
}

const SQLITE_CORRUPT = 11;
const SQLITE_NOTADB = 26;

/**
 * 'corrupt' only when SQLite itself says so (SQLITE_CORRUPT / SQLITE_NOTADB, or quick_check fails). Anything else —
 * locked, a permissions hiccup — is 'unreadable': never a reason to swap in an older backup.
 */
export function checkDatabase(file: string): 'ok' | 'missing' | 'corrupt' | 'unreadable' {
  if (!existsSync(file)) return 'missing';
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const row = db.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    return row && Object.values(row)[0] === 'ok' ? 'ok' : 'corrupt';
  } catch (err) {
    const code = (err as { errcode?: number }).errcode;
    return code === SQLITE_CORRUPT || code === SQLITE_NOTADB ? 'corrupt' : 'unreadable';
  } finally {
    db?.close();
  }
}

/** Moves the damaged database (and its -wal/-shm) into backups/broken-*, then restores the newest good backup. */
export function repairFromBackup(file: string): { restored: string | null; movedTo: string } {
  const dir = paths().backups;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const movedTo = path.join(dir, `broken-${stamp}.sqlite`);
  for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) renameSync(file + suffix, movedTo + suffix);
  for (const b of listBackups()) {
    if (checkDatabase(b.file) !== 'ok') continue;
    copyFileSync(b.file, file);
    return { restored: b.file, movedTo };
  }
  return { restored: null, movedTo };
}
