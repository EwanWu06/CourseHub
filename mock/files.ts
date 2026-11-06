// Generates small but valid PDF / PPTX / DOCX files for the mock Canvas server and tests.
import { strToU8, zipSync } from 'fflate';

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** One page per entry; '\n' inside an entry starts a new line on that page. ASCII text only. */
export function makePdf(pages: string[]): Buffer {
  const objects: string[] = [];
  const fontId = 3 + pages.length * 2;
  const pageIds = pages.map((_, i) => 3 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  pages.forEach((text, i) => {
    const pageId = pageIds[i];
    const contentId = pageId + 1;
    const lines = text.split('\n');
    const ops = ['BT', '/F1 14 Tf', '72 720 Td', ...lines.flatMap((line, j) => (j === 0 ? [`(${pdfEscape(line)}) Tj`] : ['0 -20 Td', `(${pdfEscape(line)}) Tj`])), 'ET'].join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(ops, 'latin1')} >>\nstream\n${ops}\nendstream`;
  });
  objects[fontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(out, 'latin1');
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xrefAt = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

function paragraphsXml(lines: string[]): string {
  return lines.map((l) => `<a:p><a:r><a:t>${xmlEscape(l)}</a:t></a:r></a:p>`).join('');
}

export function makePptx(slides: { text: string[]; notes?: string }[]): Buffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'ppt/presentation.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="${P}"/>`),
  };
  slides.forEach((s, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphsXml(s.text)}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
    );
    if (s.notes) {
      files[`ppt/notesSlides/notesSlide${i + 1}.xml`] = strToU8(
        `<?xml version="1.0" encoding="UTF-8"?><p:notes xmlns:a="${A}" xmlns:p="${P}"><p:cSld><p:spTree><p:sp><p:txBody>${paragraphsXml([s.notes])}</p:txBody></p:sp></p:spTree></p:cSld></p:notes>`,
      );
    }
  });
  return Buffer.from(zipSync(files));
}

export function makeDocx(paragraphs: string[]): Buffer {
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${xmlEscape(p)}</w:t></w:r></w:p>`).join('');
  return Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`),
  }));
}

/** 1×1 transparent PNG for image previews. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
