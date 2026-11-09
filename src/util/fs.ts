// File helpers that never leave a half-written file behind.
import { chmodSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Writes to a temp file next to the target, then renames it into place (atomic on the same disk). */
export function writeFileAtomic(file: string, data: string | Uint8Array, mode = 0o644): void {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  try {
    writeFileSync(tmp, data, { mode });
    chmodSync(tmp, mode);
    renameSync(tmp, file);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}
