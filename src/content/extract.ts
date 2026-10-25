// Text extraction for slide decks and documents. Runs on a temp copy that the caller deletes.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { decodeEntities } from '../util/html.ts';
import { readZipText } from './zip.ts';

const execFileAsync = promisify(execFile);

export class UnsupportedFileError extends Error {
  constructor(name: string) {
    super(`不支持提取文字的文件类型: ${name}`);
    this.name = 'UnsupportedFileError';
  }
}

export interface ExtractResult { kind: 'pdf' | 'pptx' | 'docx' | 'doc' | 'text'; pages: string[]; scanned: boolean }

const BY_EXT: Record<string, ExtractResult['kind']> = {
  pdf: 'pdf', pptx: 'pptx', docx: 'docx', doc: 'doc', rtf: 'doc', txt: 'text', md: 'text', markdown: 'text',
};
const BY_TYPE: Record<string, ExtractResult['kind']> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',
  'application/rtf': 'doc',
  'text/plain': 'text',
  'text/markdown': 'text',
};

function kindOf(name: string, contentType?: string | null): ExtractResult['kind'] | null {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (ext) return BY_EXT[ext] ?? null;
  return contentType ? BY_TYPE[contentType.split(';')[0].trim().toLowerCase()] ?? null : null;
}

export function isExtractable(name: string, contentType?: string | null): boolean {
  return kindOf(name, contentType) !== null;
}

/** Splits long text into ~3000-character "pages" on line boundaries (for DOCX/TXT which have no pages). */
function chunk(text: string, size = 3000): string[] {
  const pages: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + line.length + 1 > size) {
      pages.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur.trim()) pages.push(cur);
  return pages;
}

function xmlParagraphs(xml: string, paragraphTag: string, textTag: string): string[] {
  const cleaned = xml.replace(/<a:fld\b[\s\S]*?<\/a:fld>/g, ''); // slide-number fields
  const paras = cleaned.split(new RegExp(`</${paragraphTag}>`));
  const textRe = new RegExp(`<${textTag}(?:\\s[^>]*)?>([^<]*)</${textTag}>`, 'g');
  return paras
    .map((p) => [...p.matchAll(textRe)].map((m) => decodeEntities(m[1])).join(''))
    .map((s) => s.trim())
    .filter(Boolean);
}

function slideNumber(name: string): number {
  return Number(name.match(/(\d+)\.xml$/)?.[1] ?? 0);
}

function pptxPages(buf: Uint8Array): string[] {
  const files = readZipText(buf, (n) => /^ppt\/(slides|notesSlides)\/(_rels\/)?[a-zA-Z]+\d+\.xml(\.rels)?$/.test(n));
  const slides = Object.keys(files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => slideNumber(a) - slideNumber(b));
  return slides.map((slidePath) => {
    const lines = xmlParagraphs(files[slidePath], 'a:p', 'a:t');
    const rels = files[slidePath.replace('slides/', 'slides/_rels/') + '.rels'];
    const target = rels?.match(/Target="\.\.\/notesSlides\/(notesSlide\d+\.xml)"/)?.[1];
    const notesXml = files[`ppt/notesSlides/${target ?? `notesSlide${slideNumber(slidePath)}.xml`}`];
    const notes = notesXml ? xmlParagraphs(notesXml, 'a:p', 'a:t').join(' ') : '';
    return [...lines, ...(notes ? [`【讲者备注】${notes}`] : [])].join('\n');
  });
}

function docxText(buf: Uint8Array): string {
  const xml = readZipText(buf, (n) => n === 'word/document.xml')['word/document.xml'];
  if (!xml) throw new Error('DOCX 缺少 word/document.xml');
  return xmlParagraphs(xml.replace(/<w:tab\/>/g, '<w:t>\t</w:t>').replace(/<w:br\/>/g, '<w:t>\n</w:t>'), 'w:p', 'w:t').join('\n');
}

export async function extractFile(filePath: string, name: string, contentType?: string | null): Promise<ExtractResult> {
  const kind = kindOf(name, contentType);
  if (!kind) throw new UnsupportedFileError(name);
  if (kind === 'doc') {
    const { stdout } = await execFileAsync('/usr/bin/textutil', ['-convert', 'txt', '-stdout', filePath], { maxBuffer: 64 * 1024 * 1024 });
    return { kind, pages: chunk(stdout.trim()), scanned: false };
  }
  const buf = new Uint8Array(await readFile(filePath));
  if (kind === 'text') return { kind, pages: chunk(new TextDecoder().decode(buf).trim()), scanned: false };
  if (kind === 'docx') return { kind, pages: chunk(docxText(buf)), scanned: false };
  if (kind === 'pptx') {
    const pages = pptxPages(buf);
    return { kind, pages, scanned: false };
  }
  const { extractText, getDocumentProxy } = await import('unpdf'); // loaded on first PDF
  // errors only: pdf.js otherwise prints font-hinting chatter ("TT: undefined function: 32") that filled server.err.log
  const pdf = await getDocumentProxy(buf, { verbosity: 0 });
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = text.map((t) => t.replace(/[ \t]+\n/g, '\n').trim());
  const chars = pages.reduce((n, p) => n + p.replace(/\s/g, '').length, 0);
  // Under ~10 visible characters per page there is effectively no text layer (scanned slides).
  return { kind, pages, scanned: pages.length > 0 && chars / pages.length < 10 };
}
