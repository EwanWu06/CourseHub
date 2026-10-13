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
  const limit = opts.limit ?? (ctx.firstSync ? 40 : 20);
  const prefix = `${ctx.school.id}:f:`;
  let processed = 0;
  const pending = filesNeedingText(ctx.db, 500).filter((x) => x.id.startsWith(prefix));
  // Files waiting for their unlock date go last so new material is read first.
  pending.sort((a, b) => Number(!!a.text_error) - Number(!!b.text_error));
  for (const f of pending) {
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
      if (!meta.url || meta.locked_for_user) {
        // Not released yet (module locked until a date): try again on a later sync.
        setFileText(ctx.db, f.id, { status: 'pending', error: '文件暂未开放，开放后会自动读取' });
        continue;
      }
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
