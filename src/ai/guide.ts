// Weekly study guides: Claude teaches this week's material in Chinese (English terms kept), citing the slides.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { paths } from '../config.ts';
import type { DB } from '../db/index.ts';
import { getCourse, listCourses } from '../db/courses.ts';
import { getFile } from '../db/content.ts';
import { getSchool } from '../db/schools.ts';
import { getSettings } from '../db/settings.ts';
import { getGuide, listGuidesByStatus, upsertGuide } from '../db/study.ts';
import type { GuideRow } from '../db/types.ts';
import { makeClient } from '../auth/store.ts';
import { log } from '../util/log.ts';
import { currentWeek, lastWeek } from '../weeks/build.ts';
import { aiQueue, runClaude } from './claude.ts';
import type { ClaudeResult } from './claude.ts';
import { buildGuideInput } from './guideInput.ts';

export { buildGuideInput };
import type { GuideInput, Material } from './guideInput.ts';
import { GUIDE_SCHEMA, GUIDE_SYSTEM, PART_SCHEMA, PART_SYSTEM } from './prompts.ts';

export interface GuideContent {
  overview: string;
  objectives: string[];
  concepts: { term: string; term_zh: string; explanation: string; example: string; pitfalls: string; sources: { material_id: string; page: number | null }[] }[];
  cheatsheet: string;
  assignments: { item_id: string; relation: string }[];
  self_test: { question: string; answer: string }[];
  study_plan: { step: string; minutes: number }[];
  coverage: { level: 'full' | 'partial' | 'minimal'; note: string };
}

const LONG_INPUT = 120_000;
const PART_THRESHOLD = 20_000;
const MAX_SCANNED = 3;

const KIND: Record<Material['kind'], string> = { file: '文件', page: '页面', assignment: '作业', announcement: '公告', link: '链接' };

function buildPrompt(input: GuideInput, scannedPaths: Map<string, string>): string {
  const L: string[] = [];
  L.push(`课程：${input.courseName}`);
  L.push(`第 ${input.week} 周${input.startDate ? `（${input.startDate} ~ ${input.endDate}）` : ''}`);
  if (input.moduleNames.length) L.push(`本周模块：${input.moduleNames.join('；')}`);
  if (input.topics.length) L.push(`大纲里本周主题：${input.topics.join('；')}`);
  L.push('');
  L.push('请为这一周写一份学习讲解：概览、学习目标、核心概念（是什么/为什么/例子/易错点，标出处）、必背速查、本周作业与考试的关系、5–8 道自测题（附答案）、建议学习顺序和用时。');
  L.push('');
  L.push('## 课程资料');
  for (const m of input.materials) {
    L.push(`=== [${m.id}] ${KIND[m.kind]} · ${m.title} ===`);
    const scanned = scannedPaths.get(m.id);
    if (scanned) L.push(`（这份 PDF 没有可提取的文字，请用 Read 工具直接看文件：${scanned}）`);
    else if (!m.text) L.push(m.kind === 'link' ? `（外部链接：${m.url ?? ''}，内容无法读取）` : '（没有可读取的文字）');
    else L.push(m.text);
  }
  L.push('');
  L.push('## 本周作业（用 item_id 引用，不要写日期）');
  if (input.assignments.length === 0) L.push('（无）');
  for (const a of input.assignments) L.push(`- ${a.id} | ${a.title} | ${a.points ?? '-'} 分${a.description ? ` | 说明：${a.description}` : ''}`);
  return L.join('\n');
}

/** Long files are condensed one by one first so the final call stays within a sensible size. */
async function condenseLongFiles(db: DB, input: GuideInput): Promise<GuideInput> {
  if (input.totalChars <= LONG_INPUT) return input;
  const materials: Material[] = [];
  for (const m of input.materials) {
    if (m.kind !== 'file' || m.text.length <= PART_THRESHOLD) {
      materials.push(m);
      continue;
    }
    const res = await runClaude<{ points: string[]; terms: string[] }>(db, {
      purpose: 'guide-part', ref: `${input.courseId}#${input.week}:${m.id}`, system: PART_SYSTEM, schema: PART_SCHEMA,
      prompt: `课程：${input.courseName}\n资料：${m.title}\n\n${m.text.slice(0, 400_000)}`, timeoutMs: 10 * 60_000,
    });
    if (!res.ok || !res.data) throw Object.assign(new Error(res.error ?? '资料摘要失败'), { rateLimited: res.rateLimited });
    materials.push({ ...m, text: `（摘要）\n${res.data.points.map((p) => `- ${p}`).join('\n')}\n术语：${res.data.terms.join(', ')}` });
  }
  return { ...input, materials, totalChars: materials.reduce((n, x) => n + x.text.length, 0) };
}

function clean(content: GuideContent, input: GuideInput): GuideContent {
  const materialIds = new Set(input.materials.map((m) => m.id));
  const itemIds = new Set(input.assignments.map((a) => a.id));
  return {
    ...content,
    concepts: (content.concepts ?? []).map((c) => ({ ...c, sources: (c.sources ?? []).filter((s) => materialIds.has(s.material_id)) })),
    assignments: (content.assignments ?? []).filter((a) => itemIds.has(a.item_id)),
    self_test: content.self_test ?? [],
    study_plan: content.study_plan ?? [],
    objectives: content.objectives ?? [],
  };
}

export async function generateGuide(db: DB, courseId: string, week: number, opts: { force?: boolean } = {}): Promise<{ ok: boolean; message: string }> {
  let input = buildGuideInput(db, courseId, week);
  const existing = getGuide(db, courseId, week);
  if (!opts.force && existing?.status === 'ready' && existing.input_hash === input.hash) return { ok: true, message: '资料没有变化' };
  if (input.materials.length === 0 && input.assignments.length === 0) return { ok: false, message: '这一周还没有资料' };
  upsertGuide(db, { course_id: courseId, week, status: 'running', error: null });

  const fail = (res: Pick<ClaudeResult<unknown>, 'error' | 'rateLimited'>) => {
    const attempts = (existing?.attempts ?? 0) + 1;
    const waitMin = res.rateLimited ? 60 : 15 * 2 ** attempts;
    upsertGuide(db, { course_id: courseId, week, status: 'failed', error: res.error ?? '生成失败', attempts, next_attempt_at: new Date(Date.now() + waitMin * 60_000).toISOString() });
    return { ok: false, message: res.error ?? '生成失败' };
  };

  let jobDir: string | null = null;
  try {
    input = await condenseLongFiles(db, input);
    // Slides without a text layer: fetch them briefly so Claude can look at the pages; deleted afterwards.
    const scannedPaths = new Map<string, string>();
    const scanned = input.materials.filter((m) => m.kind === 'file' && m.scanned).slice(0, MAX_SCANNED);
    if (scanned.length) {
      const school = getSchool(db, input.schoolId);
      const client = school ? makeClient(school) : null;
      if (client) {
        mkdirSync(paths().tmp, { recursive: true });
        jobDir = mkdtempSync(path.join(paths().tmp, 'guide-'));
        for (const m of scanned) {
          try {
            const f = getFile(db, m.fileId!);
            const meta = await client.get<{ url?: string }>(`/api/v1/files/${f!.canvas_id}`);
            if (!meta.url) continue;
            const res = await client.fetchRaw(meta.url);
            const target = path.join(jobDir, `${f!.canvas_id}.pdf`);
            writeFileSync(target, Buffer.from(await res.arrayBuffer()));
            scannedPaths.set(m.id, target);
          } catch (err) {
            log('warn', `could not fetch scanned file ${m.id}`, err);
          }
        }
      }
    }
    const res = await runClaude<GuideContent>(db, {
      purpose: 'guide', ref: `${courseId}#${week}`, system: GUIDE_SYSTEM, prompt: buildPrompt(input, scannedPaths), schema: GUIDE_SCHEMA,
      tools: scannedPaths.size ? ['Read'] : [], addDirs: jobDir && scannedPaths.size ? [jobDir] : [], timeoutMs: 12 * 60_000,
    });
    if (!res.ok || !res.data || !Array.isArray(res.data.concepts)) return fail({ error: res.error ?? 'AI 返回的讲解不完整', rateLimited: res.rateLimited });
    upsertGuide(db, {
      course_id: courseId, week, status: 'ready', content: JSON.stringify(clean(res.data, input)), input_hash: buildGuideInput(db, courseId, week).hash,
      model: getSettings(db).aiModel, generated_at: new Date().toISOString(), error: null, attempts: 0, next_attempt_at: null,
    });
    return { ok: true, message: '已生成' };
  } catch (err) {
    return fail({ error: (err as Error).message, rateLimited: !!(err as { rateLimited?: boolean }).rateLimited });
  } finally {
    if (jobDir) rmSync(jobDir, { recursive: true, force: true });
  }
}

export function enqueueGuide(db: DB, courseId: string, week: number, opts: { force?: boolean } = {}): boolean {
  const key = `guide:${courseId}#${week}`;
  if (aiQueue.has(key)) return false;
  const current = getGuide(db, courseId, week);
  if (current?.status !== 'running') upsertGuide(db, { course_id: courseId, week, status: 'queued', error: null });
  return aiQueue.add(key, async () => {
    const r = await generateGuide(db, courseId, week, opts);
    if (!r.ok && getGuide(db, courseId, week)?.status === 'queued') upsertGuide(db, { course_id: courseId, week, status: 'failed', error: r.message });
  });
}

export function guideStale(db: DB, courseId: string, week: number): boolean {
  const g = getGuide(db, courseId, week);
  return !!g && g.status === 'ready' && g.input_hash !== buildGuideInput(db, courseId, week).hash;
}

function due(g: GuideRow | undefined, now: Date): boolean {
  if (!g) return true;
  if (g.status === 'failed') return !g.next_attempt_at || Date.parse(g.next_attempt_at) <= now.getTime();
  return false;
}

/** Keeps "this week + next week" (settings.aiAutoWeeks) ready for every visible course. */
export function autoEnqueueGuides(db: DB, now: Date): number {
  const s = getSettings(db);
  if (!s.aiEnabled || s.aiAutoWeeks <= 0) return 0;
  let n = 0;
  for (const c of listCourses(db)) {
    const cw = currentWeek(db, c.id, now);
    const last = lastWeek(db, c.id);
    if (cw === null || last === null) continue;
    for (let w = Math.max(1, cw); w < cw + s.aiAutoWeeks && w <= last; w++) {
      const input = buildGuideInput(db, c.id, w);
      if (input.materials.length === 0 && input.assignments.length === 0) continue;
      const g = getGuide(db, c.id, w);
      const stale = g?.status === 'ready' && g.input_hash !== input.hash;
      if ((due(g, now) || stale) && enqueueGuide(db, c.id, w)) n++;
    }
  }
  return n;
}

/** After a restart: anything that was queued or mid-generation is queued again. */
export function resumeQueuedGuides(db: DB): number {
  let n = 0;
  for (const g of listGuidesByStatus(db, ['queued', 'running'])) {
    if (!getCourse(db, g.course_id)) continue;
    upsertGuide(db, { course_id: g.course_id, week: g.week, status: 'queued' });
    if (enqueueGuide(db, g.course_id, g.week)) n++;
  }
  return n;
}
