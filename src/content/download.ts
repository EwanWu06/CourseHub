// Transient downloads: a file exists on disk only while `fn` runs, then the whole temp dir is removed.
import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { paths } from '../config.ts';
import type { CanvasClient } from '../canvas/client.ts';

export const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export class FileTooLargeError extends Error {
  constructor() {
    super('文件超过 100MB，跳过');
    this.name = 'FileTooLargeError';
  }
}

export async function withTempDownload<T>(client: CanvasClient, url: string, name: string, fn: (filePath: string) => Promise<T>, opts: { maxBytes?: number } = {}): Promise<T> {
  const max = opts.maxBytes ?? MAX_DOWNLOAD_BYTES;
  mkdirSync(paths().tmp, { recursive: true });
  const dir = mkdtempSync(path.join(paths().tmp, 'dl-'));
  const file = path.join(dir, name.replace(/[/\\]/g, '_').slice(-120) || 'file');
  try {
    const res = await client.fetchRaw(url);
    if (Number(res.headers.get('content-length') ?? 0) > max) {
      await res.body?.cancel();
      throw new FileTooLargeError();
    }
    if (!res.body) throw new Error('下载内容为空');
    let total = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        total += chunk.length;
        cb(total > max ? new FileTooLargeError() : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), limiter, createWriteStream(file));
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function cleanTmp(): void {
  rmSync(paths().tmp, { recursive: true, force: true });
  mkdirSync(paths().tmp, { recursive: true });
}
