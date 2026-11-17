import type { Hono } from 'hono';
import type { DB } from '../../db/index.ts';
import { createManual, deleteManual, getItem, listItems, listUndated, setItemCategory, setItemNote, setLocalDone } from '../../db/items.ts';
import { CATEGORIES, categorizeSchool } from '../../sync/category.ts';
import type { Category } from '../../sync/category.ts';
import { makeTaskViewer, undatedTasks } from '../../reports/data.ts';
import { HttpError, isUrl, readJson } from './util.ts';

const DAY = 86_400_000;

export function registerItems(app: Hono, db: DB): void {
  app.get('/api/items', (c) => {
    const now = new Date();
    const q = c.req.query();
    const view = makeTaskViewer(db, now);
    const rows = listItems(db, {
      from: q.from ?? new Date(now.getTime() - 30 * DAY).toISOString(),
      to: q.to ?? new Date(now.getTime() + 120 * DAY).toISOString(),
      schoolId: q.school, courseId: q.course,
    });
    const tasks = rows.map(view);
    return c.json(q.includeDone === '1' ? tasks : tasks.filter((t) => t.status !== 'done'));
  });

  app.get('/api/items/undated', (c) => {
    return c.json(undatedTasks(db, new Date(), c.req.query('course')));
  });

  app.post('/api/items', async (c) => {
    const body = await readJson<{ title?: string; courseId?: string | null; dueAt?: string | null; htmlUrl?: string | null }>(c);
    if (!body.title?.trim()) throw new HttpError(400, '请输入任务标题');
    if (body.dueAt && Number.isNaN(Date.parse(body.dueAt))) throw new HttpError(400, '截止时间格式不对');
    if (body.htmlUrl && !isUrl(body.htmlUrl)) throw new HttpError(400, '链接格式不对');
    let row;
    try {
      row = createManual(db, { title: body.title, course_id: body.courseId ?? null, due_at: body.dueAt ? new Date(body.dueAt).toISOString() : null, html_url: body.htmlUrl ?? null });
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return c.json(makeTaskViewer(db, new Date())(row), 201);
  });

  app.patch('/api/items/:id', async (c) => {
    const id = c.req.param('id');
    if (!getItem(db, id)) throw new HttpError(404, '任务不存在');
    const body = await readJson<{ localDone?: boolean; category?: string | null; note?: string | null }>(c);
    if (typeof body.localDone === 'boolean') setLocalDone(db, id, body.localDone);
    if ('note' in body) {
      const note = (body.note ?? '').trim();
      if (note.length > 300) throw new HttpError(400, '备注最多 300 个字');
      setItemNote(db, id, note || null);
    }
    if ('category' in body) {
      if (body.category === null) {
        const item = getItem(db, id)!;
        setItemCategory(db, id, null, null);
        if (item.school_id) categorizeSchool(db, item.school_id);
      } else if (CATEGORIES.includes(body.category as Category)) {
        setItemCategory(db, id, body.category!, 'user');
      } else {
        throw new HttpError(400, '未知的类别');
      }
    }
    return c.json(makeTaskViewer(db, new Date())(getItem(db, id)!));
  });

  app.delete('/api/items/:id', (c) => {
    const id = c.req.param('id');
    if (!getItem(db, id)) throw new HttpError(404, '任务不存在');
    try {
      deleteManual(db, id);
    } catch (err) {
      throw new HttpError(400, (err as Error).message);
    }
    return c.json({ ok: true });
  });
}
