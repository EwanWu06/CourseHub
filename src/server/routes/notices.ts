import type { Hono } from 'hono';
import { PORT } from '../../config.ts';
import type { DB } from '../../db/index.ts';
import { listNotices, markNoticesRead, unreadNotices } from '../../db/notices.ts';
import { notify } from '../../notify/mac.ts';

export function registerNotices(app: Hono, db: DB): void {
  app.get('/api/notices', (c) => {
    const limit = Math.min(200, Math.max(0, Number(c.req.query('limit') ?? 50) || 0));
    return c.json({ unread: unreadNotices(db), items: limit ? listNotices(db, limit) : [] });
  });
  app.post('/api/notices/read', (c) => {
    markNoticesRead(db);
    return c.json({ ok: true });
  });
  app.post('/api/notices/test', async (c) => {
    await notify({ kind: 'system', title: 'Course Hub 通知测试', body: '能看到这条，说明截止提醒和日报都能正常弹出。', url: `http://127.0.0.1:${PORT}/notices` });
    return c.json({ ok: true });
  });
}
