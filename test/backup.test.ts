import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, readdirSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpDataDir } from './helpers.ts';
import { paths } from '../src/config.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool, listSchools } from '../src/db/schools.ts';
import { backupDb, checkDatabase, listBackups, repairFromBackup } from '../src/db/backup.ts';

test('one backup per day, a real copy of the database, newest 14 kept', () => {
  tmpDataDir();
  const db = openDb();
  createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  for (let d = 1; d <= 16; d++) assert.ok(backupDb(db, new Date(`2026-10-${String(d).padStart(2, '0')}T20:00:00Z`)));
  assert.equal(backupDb(db, new Date('2026-10-16T22:00:00Z')), null, 'already backed up that day');
  const list = listBackups();
  assert.equal(list.length, 14);
  assert.equal(list[0].date, '2026-10-16');
  assert.equal(list.at(-1)!.date, '2026-10-03');
  const copy = new DatabaseSync(list[0].file, { readOnly: true });
  assert.equal((copy.prepare('SELECT count(*) AS n FROM schools').get() as { n: number }).n, 1);
  copy.close();
  db.close();
});

test('a damaged database is set aside and the newest good backup takes its place', () => {
  tmpDataDir();
  assert.equal(checkDatabase(paths().db), 'missing');
  const db = openDb();
  createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  backupDb(db, new Date('2026-10-12T20:00:00Z'));
  db.close();
  assert.equal(checkDatabase(paths().db), 'ok');
  writeFileSync(paths().db, 'not a database '.repeat(500));
  assert.equal(checkDatabase(paths().db), 'corrupt');
  const r = repairFromBackup(paths().db);
  assert.match(r.restored ?? '', /coursehub-2026-10-12\.sqlite$/);
  assert.equal(checkDatabase(paths().db), 'ok');
  assert.equal(listSchools(openDb())[0].name, 'Alpha');
  assert.ok(readdirSync(paths().backups).some((f) => f.startsWith('broken-')), 'the damaged file is kept for inspection');
});

test('with no backup at all the damaged file is still moved aside so a fresh database can start', () => {
  tmpDataDir();
  openDb().close();
  writeFileSync(paths().db, 'garbage');
  const r = repairFromBackup(paths().db);
  assert.equal(r.restored, null);
  assert.equal(checkDatabase(paths().db), 'missing');
});

test('a database that merely can\'t be opened right now is never treated as damaged', () => {
  tmpDataDir();
  const db = openDb();
  createSchool(db, { name: 'Alpha', base_url: 'alpha.instructure.com' });
  backupDb(db, new Date('2026-10-12T20:00:00Z'));
  db.close();
  chmodSync(paths().db, 0o000); // e.g. a permissions hiccup: not corruption
  try {
    assert.equal(checkDatabase(paths().db), 'unreadable');
  } finally {
    chmodSync(paths().db, 0o644);
  }
  assert.equal(checkDatabase(paths().db), 'ok');
});
