// "问一问": a question about one study week, answered by Claude from that week's material (and its guide).
import type { DB } from '../db/index.ts';
import { nowIso } from '../db/index.ts';
import { getGuide } from '../db/study.ts';
import { all, one, run } from '../db/sql.ts';
import { log } from '../util/log.ts';
import { aiQueue, runClaude } from './claude.ts';
import { buildGuideInput } from './guideInput.ts';
import { ASK_SYSTEM } from './prompts.ts';

export interface QaRow { id: number; course_id: string; week: number; question: string; answer: string | null; status: 'pending' | 'done' | 'failed'; error: string | null; created_at: string; answered_at: string | null }

const MAX_MATERIAL_CHARS = 100_000;

export function listQuestions(db: DB, courseId: string, week: number, limit = 30): QaRow[] {
  return all<QaRow>(db, 'SELECT * FROM study_qa WHERE course_id = $courseId AND week = $week ORDER BY id DESC LIMIT $limit', { courseId, week, limit });
}

function buildPrompt(db: DB, qa: QaRow): string {
  const input = buildGuideInput(db, qa.course_id, qa.week);
  const L: string[] = [`课程：${input.courseName}`, `第 ${qa.week} 周${input.topics.length ? `：${input.topics.join('；')}` : ''}`, ''];
  const guide = getGuide(db, qa.course_id, qa.week);
  if (guide?.status === 'ready' && guide.content) {
    try {
      const g = JSON.parse(guide.content) as { overview?: string; concepts?: { term: string; term_zh?: string }[] };
      L.push('## 本周讲解要点', g.overview ?? '', `核心概念：${(g.concepts ?? []).map((c) => `${c.term}${c.term_zh ? `（${c.term_zh}）` : ''}`).join('、')}`, '');
    } catch {
      // ignore a malformed guide
    }
  }
  L.push('## 本周课程资料');
  const share = Math.max(4000, Math.floor(MAX_MATERIAL_CHARS / Math.max(1, input.materials.filter((m) => m.text).length)));
  for (const m of input.materials) {
    if (!m.text) continue;
    L.push(`=== ${m.title} ===`, m.text.length > share ? `${m.text.slice(0, share)}\n（后面省略）` : m.text);
  }
  const earlier = all<QaRow>(db, `SELECT * FROM study_qa WHERE course_id = $c AND week = $w AND status = 'done' AND id < $id ORDER BY id DESC LIMIT 3`, { c: qa.course_id, w: qa.week, id: qa.id });
  if (earlier.length) {
    L.push('', '## 之前问过的问题（供参考）');
    for (const e of earlier.reverse()) L.push(`问：${e.question}`, `答：${(e.answer ?? '').slice(0, 600)}`);
  }
  L.push('', '## 学生的问题', qa.question);
  return L.join('\n');
}

function answer(db: DB, id: number): Promise<void> {
  return aiQueue.run(`ask:${id}`, async () => {
    const qa = one<QaRow>(db, 'SELECT * FROM study_qa WHERE id = $id', { id });
    if (!qa) return;
    try {
      const res = await runClaude(db, { purpose: 'chat', ref: `${qa.course_id}#${qa.week}`, system: ASK_SYSTEM, prompt: buildPrompt(db, qa), timeoutMs: 5 * 60_000 });
      if (res.ok && res.text?.trim()) {
        run(db, `UPDATE study_qa SET status = 'done', answer = $a, error = NULL, answered_at = $at WHERE id = $id`, { id, a: res.text.trim(), at: nowIso() });
      } else {
        run(db, `UPDATE study_qa SET status = 'failed', error = $e WHERE id = $id`, { id, e: res.error ?? 'AI 没有回答' });
      }
    } catch (err) {
      log('error', `answering question ${id} failed`, err);
      run(db, `UPDATE study_qa SET status = 'failed', error = $e WHERE id = $id`, { id, e: (err as Error).message });
    }
  }, { front: true });
}

/** Saves the question and starts answering it (ahead of background guide work). Returns its id. */
export function askQuestion(db: DB, courseId: string, week: number, question: string): number {
  const q = question.trim();
  if (!q) throw new Error('请先写下你的问题');
  if (q.length > 1000) throw new Error('问题最多 1000 个字');
  run(db, `INSERT INTO study_qa (course_id, week, question, status, created_at) VALUES ($c, $w, $q, 'pending', $at)`, { c: courseId, w: week, q, at: nowIso() });
  const id = one<{ id: number }>(db, 'SELECT last_insert_rowid() AS id')!.id;
  void answer(db, id);
  return id;
}

/** After a restart, questions that were still waiting get answered. */
export function resumePendingQuestions(db: DB): number {
  const pending = all<{ id: number }>(db, `SELECT id FROM study_qa WHERE status = 'pending' ORDER BY id`);
  for (const p of pending) void answer(db, p.id);
  return pending.length;
}
