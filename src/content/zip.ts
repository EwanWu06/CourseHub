import { strFromU8, unzipSync } from 'fflate';

/** Reads matching entries of an OOXML zip as UTF-8 strings. */
export function readZipText(buf: Uint8Array, match: (name: string) => boolean): Record<string, string> {
  const entries = unzipSync(buf, { filter: (f) => match(f.name) });
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(entries)) out[name] = strFromU8(data);
  return out;
}
