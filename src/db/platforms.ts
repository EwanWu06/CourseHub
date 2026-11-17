// Publisher platforms read alongside Canvas: per course, when the platform's work was last read and why not.
import type { DB } from './index.ts';
import { all, one, run } from './sql.ts';

export interface PlatformStatusRow {
  course_id: string; platform: string; last_try_at: string | null; last_ok_at: string | null; error: string | null; items: number;
}

export function getPlatformStatus(db: DB, courseId: string, platform: string): PlatformStatusRow | undefined {
  return one<PlatformStatusRow>(db, 'SELECT * FROM platform_status WHERE course_id = $courseId AND platform = $platform', { courseId, platform });
}

export function listPlatformStatus(db: DB): PlatformStatusRow[] {
  return all<PlatformStatusRow>(db, 'SELECT * FROM platform_status ORDER BY course_id, platform');
}

export function recordPlatformRead(db: DB, courseId: string, platform: string, r: { at: string } & ({ ok: true; items: number } | { ok: false; error: string })): void {
  if (r.ok) {
    run(db, `INSERT INTO platform_status (course_id, platform, last_try_at, last_ok_at, error, items) VALUES ($courseId, $platform, $at, $at, NULL, $items)
             ON CONFLICT (course_id, platform) DO UPDATE SET last_try_at = $at, last_ok_at = $at, error = NULL, items = $items`, { courseId, platform, at: r.at, items: r.items });
  } else {
    run(db, `INSERT INTO platform_status (course_id, platform, last_try_at, error) VALUES ($courseId, $platform, $at, $error)
             ON CONFLICT (course_id, platform) DO UPDATE SET last_try_at = $at, error = $error`, { courseId, platform, at: r.at, error: r.error });
  }
}
