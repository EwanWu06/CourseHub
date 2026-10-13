// Extracted text lives in data/text/<file id>.json; the original file is never kept.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';

export interface StoredText {
  fileId: string; name: string; kind: string; pages: string[]; scanned: boolean; extractedAt: string; sourceUpdatedAt: string | null;
}

const textPath = (fileId: string) => path.join(paths().text, `${fileId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

export function saveText(t: StoredText): void {
  mkdirSync(paths().text, { recursive: true });
  writeFileSync(textPath(t.fileId), JSON.stringify(t));
}

export function loadText(fileId: string): StoredText | null {
  try {
    return JSON.parse(readFileSync(textPath(fileId), 'utf8')) as StoredText;
  } catch {
    return null;
  }
}

export function deleteText(fileId: string): void {
  rmSync(textPath(fileId), { force: true });
}
