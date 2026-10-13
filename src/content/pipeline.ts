// After each sync: extract text from new/changed documents (a few per run), never keeping the file.
import { SessionExpiredError } from '../canvas/client.ts';
import type { CanvasFile } from '../canvas/types.ts';
import { filesNeedingText, setFileText } from '../db/content.ts';
import { errorText } from '../sync/context.ts';
import type { SyncContext } from '../sync/context.ts';
import { log } from '../util/log.ts';
import { MAX_DOWNLOAD_BYTES, FileTooLargeError, withTempDownload } from './download.ts';
import { extractFile, isExtractable, UnsupportedFileError } from './extract.ts';
import { saveText } from './textstore.ts';

export async function extractPendingFiles(ctx: SyncContext, opts: { limit?: number } = {}): Promise<number> {
  const limit = opts.limit ?? 15;
  const prefix = `${ctx.school.id}:f:`;
  let processed = 0;
  for (const f of filesNeedingText(ctx.db, 500).filter((x) => x.id.startsWith(prefix))) {
    if (!isExtractable(f.name, f.content_type)) {
      setFileText(ctx.db, f.id, { status: 'unsupported' });
      continue;
    }
    if ((f.size ?? 0) > MAX_DOWNLOAD_BYTES) {
      setFileText(ctx.db, f.id, { status: 'skipped', error: '文件超过 100MB' });
      continue;
    }
    if (processed >= limit) break;
    processed++;
    try {
      const meta = await ctx.client.get<CanvasFile>(`/api/v1/files/${f.canvas_id}`);
      if (!meta.url) throw new Error('没有下载链接（文件可能被锁定）');
      const result = await withTempDownload(ctx.client, meta.url, f.name, (p) => extractFile(p, f.name, f.content_type));
      const hasText = result.pages.some((p) => p.trim());
      saveText({
        fileId: f.id, name: f.name, kind: result.kind, pages: result.pages, scanned: result.scanned || !hasText,
        extractedAt: new Date().toISOString(), sourceUpdatedAt: f.updated_at,
      });
      setFileText(ctx.db, f.id, { status: hasText && !result.scanned ? 'ok' : 'empty', pages: result.pages.length });
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      if (err instanceof UnsupportedFileError) setFileText(ctx.db, f.id, { status: 'unsupported' });
      else if (err instanceof FileTooLargeError) setFileText(ctx.db, f.id, { status: 'skipped', error: err.message });
      else {
        setFileText(ctx.db, f.id, { status: 'failed', error: errorText(err).slice(0, 300) });
        log('warn', `extract ${f.id} failed`, err);
      }
    }
  }
  return processed;
}
