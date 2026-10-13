import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { tmpDataDir } from './helpers.ts';
import { makeDocx, makePdf, makePptx } from '../mock/files.ts';
import { startMockCanvas } from '../mock/server.ts';
import { openDb } from '../src/db/index.ts';
import { createSchool } from '../src/db/schools.ts';
import { getFile } from '../src/db/content.ts';
import { saveAuth } from '../src/auth/store.ts';
import { syncSchool } from '../src/sync/index.ts';
import { paths } from '../src/config.ts';
import { extractFile, isExtractable, UnsupportedFileError } from '../src/content/extract.ts';
import { loadText } from '../src/content/textstore.ts';
import { cleanTmp } from '../src/content/download.ts';

const scratch = mkdtempSync(path.join(tmpdir(), 'coursehub-extract-'));
function write(name: string, bytes: Buffer | string): string {
  const p = path.join(scratch, name);
  writeFileSync(p, bytes);
  return p;
}

test('isExtractable accepts documents only', () => {
  for (const n of ['a.pdf', 'b.PPTX', 'c.docx', 'd.doc', 'e.rtf', 'f.txt', 'g.md']) assert.ok(isExtractable(n), n);
  for (const n of ['a.ppt', 'b.key', 'c.mp4', 'd.png', 'e.xlsx', 'noext']) assert.ok(!isExtractable(n), n);
  assert.ok(isExtractable('download', 'application/pdf'));
});

test('PDF text is extracted page by page', async () => {
  const r = await extractFile(write('w6.pdf', makePdf(['Glycolysis in the cytoplasm', 'Krebs cycle in the matrix'])), 'w6.pdf');
  assert.equal(r.kind, 'pdf');
  assert.equal(r.pages.length, 2);
  assert.match(r.pages[1], /Krebs cycle/);
  assert.equal(r.scanned, false);
});

test('a PDF without a text layer is flagged as scanned', async () => {
  const r = await extractFile(write('scan.pdf', makePdf(['', ''])), 'scan.pdf');
  assert.equal(r.scanned, true);
});

test('PPTX slides keep order and include speaker notes', async () => {
  const r = await extractFile(write('n.pptx', makePptx([
    { text: ['ATP yield', 'About 30-32 ATP & more'], notes: 'Remember the NADH shuttle' },
    { text: ['Fermentation'] },
  ])), 'n.pptx');
  assert.equal(r.kind, 'pptx');
  assert.equal(r.pages.length, 2);
  assert.equal(r.pages[0], 'ATP yield\nAbout 30-32 ATP & more\n【讲者备注】Remember the NADH shuttle');
  assert.equal(r.pages[1], 'Fermentation');
});

test('DOCX paragraphs become text', async () => {
  const r = await extractFile(write('lab.docx', makeDocx(['Lab 3: Respiration', 'Use the respirometer.'])), 'lab.docx');
  assert.equal(r.kind, 'docx');
  assert.equal(r.pages.join('\n'), 'Lab 3: Respiration\nUse the respirometer.');
});

test('legacy .doc goes through macOS textutil', async () => {
  const txt = write('old.txt', 'Old syllabus text');
  execFileSync('textutil', ['-convert', 'doc', '-output', path.join(scratch, 'old.doc'), txt]);
  const r = await extractFile(path.join(scratch, 'old.doc'), 'old.doc');
  assert.equal(r.kind, 'doc');
  assert.match(r.pages.join('\n'), /Old syllabus text/);
});

test('legacy .ppt is unsupported', async () => {
  await assert.rejects(extractFile(write('x.ppt', 'binary'), 'x.ppt'), UnsupportedFileError);
});

async function syncAlpha(mutate?: (mock: Awaited<ReturnType<typeof startMockCanvas>>) => void) {
  tmpDataDir();
  const db = openDb();
  const mock = await startMockCanvas({ variant: 'alpha' });
  mutate?.(mock);
  const school = createSchool(db, { name: 'alpha', base_url: mock.baseUrl });
  saveAuth({ schoolId: school.id, savedAt: new Date().toISOString(), userAgent: 'test-agent', cookies: mock.sessionCookies() });
  await syncSchool(db, school.id, { reason: 'test', relogin: null });
  return { db, mock, s: school.id };
}

test('sync extracts slide text transiently and records per-file status', async () => {
  const { db, mock, s } = await syncAlpha((m) => {
    m.data.courses[0].files.push({ id: '7008', display_name: 'Blank.pptx', content_type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', updated_at: new Date().toISOString(), bytes: makePptx([{ text: [] }]), size: 0 });
    m.data.courses[0].files[6].size = 200 * 1024 * 1024; // Syllabus_BIO3.pdf pretends to be huge
  });
  try {
    const status = (id: string) => getFile(db, `${s}:f:${id}`)!.text_status;
    assert.equal(status('7001'), 'ok');
    assert.equal(loadText(`${s}:f:7001`)!.pages.length, 3);
    assert.match(loadText(`${s}:f:7002`)!.pages[0], /【讲者备注】Remember the NADH shuttle/);
    assert.equal(status('7003'), 'ok');
    assert.equal(status('7101'), 'ok');
    assert.equal(status('7004'), 'unsupported');
    assert.equal(status('7006'), 'unsupported');
    assert.equal(status('7005'), 'failed');
    assert.ok(getFile(db, `${s}:f:7005`)!.text_error);
    assert.equal(status('7008'), 'empty');
    assert.equal(status('7007'), 'skipped');
    assert.equal(mock.requests.filter((r) => r.path.startsWith('/files/7007/download')).length, 0);
    assert.deepEqual(readdirSync(paths().tmp), []);
  } finally {
    await mock.close();
  }
});

test('extracted files are not re-downloaded on the next sync', async () => {
  const { db, mock, s } = await syncAlpha();
  try {
    const downloads = () => mock.requests.filter((r) => r.path.startsWith('/files/7001/download')).length;
    assert.equal(downloads(), 1);
    await syncSchool(db, s, { reason: 'test', relogin: null });
    assert.equal(downloads(), 1);
  } finally {
    await mock.close();
  }
});

test('cleanTmp removes leftovers from a crashed run', () => {
  tmpDataDir();
  mkdirSync(path.join(paths().tmp, 'dl-old'), { recursive: true });
  writeFileSync(path.join(paths().tmp, 'dl-old', 'x.pdf'), 'x');
  cleanTmp();
  assert.ok(existsSync(paths().tmp));
  assert.deepEqual(readdirSync(paths().tmp), []);
});
