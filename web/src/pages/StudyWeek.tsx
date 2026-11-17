import { useState } from 'react';
import { api, useApi } from '../api.ts';
import { fmtDate, fmtRelative } from '../format.ts';
import { Icon } from '../components/Icon.tsx';
import { Markdown } from '../components/Markdown.tsx';
import { TaskList } from '../components/TaskRow.tsx';
import { Empty, ErrorNote, ExtLink, Section, Loading, useDocumentTitle } from '../components/ui.tsx';
import { groupSources, pagesLabel } from '../lib/study.ts';
import { Link } from '../router.tsx';
import type { StudyQa, StudyWeekDetail } from '../types.ts';

const KIND_ICON: Record<string, string> = { file: 'file', page: 'page', assignment: 'pencil', announcement: 'megaphone', link: 'link' };

export function StudyWeek({ courseId, week }: { courseId: string; week: number }) {
  const [busy, setBusy] = useState(false);
  const { data, error, reload } = useApi<StudyWeekDetail>(`/api/study/${encodeURIComponent(courseId)}/${week}`, { poll: 6000 });
  useDocumentTitle(data ? `${data.course.display_name} 第 ${week} 周` : `第 ${week} 周`);
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const g = data.guide;
  const c = g.content;
  const generating = g.queued || g.status === 'queued' || g.status === 'running';
  const materialUrl = new Map(data.materials.map((m) => [m.id, m]));
  const generate = async () => {
    setBusy(true);
    try {
      await api(`/api/study/${encodeURIComponent(courseId)}/${week}/generate`, { method: 'POST', body: { force: true } });
      reload();
    } finally {
      setBusy(false);
    }
  };
  const total = c?.study_plan.reduce((n, s) => n + (s.minutes || 0), 0) ?? 0;
  const relation = new Map((c?.assignments ?? []).map((a) => [a.item_id, a.relation]));

  return (
    <div className="page study-week is-numbered" style={{ ['--c' as string]: data.course.color ?? data.school?.color ?? '#888' }}>
      <header className="masthead">
        <div>
          <div className="kicker"><Link to="/study">学习</Link> · <Link to={`/study/${courseId}`}>{data.course.display_name}</Link></div>
          <h1 className="title">第 {week} 周{data.topics.length ? <span className="title-topics">{data.topics.slice(0, 3).join(' · ')}</span> : null}</h1>
          <div className="small muted">{data.startDate ? `${fmtDate(new Date(`${data.startDate}T12:00:00`))} – ${fmtDate(new Date(`${data.endDate}T12:00:00`))}` : ''}{data.moduleNames.length ? ` · ${data.moduleNames.join('；')}` : ''}</div>
        </div>
        <div className="masthead-aside row">
          {week > 1 ? <Link to={`/study/${courseId}/${week - 1}`} className="btn btn-sm btn-ghost">‹ 上一周</Link> : null}
          <Link to={`/study/${courseId}/${week + 1}`} className="btn btn-sm btn-ghost">下一周 ›</Link>
          <button type="button" className="btn btn-sm btn-primary" disabled={busy || generating || data.materials.length + data.assignments.length === 0} onClick={() => void generate()}>
            {generating ? <><span className="spinner" /> 生成中…</> : c ? '重新生成' : '生成讲解'}
          </button>
        </div>
      </header>

      {g.status === 'failed' && !generating ? <div className="callout bad">生成失败：{g.error}。稍后会自动重试，也可以点「重新生成」。</div> : null}
      {g.stale && !generating ? <div className="callout warn">这一周的资料有更新，点「重新生成」可以更新讲解。</div> : null}
      {c && c.coverage.level !== 'full' ? <div className="callout warn">资料有限：{c.coverage.note}</div> : null}

      {!c ? (
        generating ? <div className="callout info"><span className="spinner" /> 正在读这一周的资料并写讲解，通常需要 1–3 分钟…</div>
          : data.materials.length + data.assignments.length === 0 ? <Empty glyph="空">这一周还没有资料（老师可能还没发布）。</Empty>
            : <Empty glyph="讲">还没有生成这一周的讲解。点右上角「生成讲解」，大约 1–3 分钟。</Empty>
      ) : (
        <div className="guide">
          <section className="guide-overview card card-pad">
            <div className="kicker">This week</div>
            <Markdown text={c.overview} className="lead" />
            {g.generatedAt ? <div className="small muted">由 Claude {g.model ?? ''} 根据课程资料生成 · {fmtRelative(g.generatedAt)}</div> : null}
          </section>

          <Section title="学习目标">
            <ul className="objectives">{c.objectives.map((o, i) => <li key={i}><Markdown text={o} /></li>)}</ul>
          </Section>

          <Section title="核心概念" note={`${c.concepts.length} 个`}>
            <div className="stack">
              {c.concepts.map((k, i) => (
                <article key={i} className="card card-pad concept">
                  <h3 className="concept-term"><span className="en">{k.term}</span>{k.term_zh ? <span className="zh">{k.term_zh}</span> : null}</h3>
                  <Markdown text={k.explanation} />
                  {k.example ? <div className="concept-block"><div className="label">例子</div><Markdown text={k.example} /></div> : null}
                  {k.pitfalls ? <div className="concept-block warn"><div className="label">易错点</div><Markdown text={k.pitfalls} /></div> : null}
                  {k.sources.length ? (
                    <div className="sources">
                      {groupSources(k.sources).map((s) => {
                        const m = materialUrl.get(s.material_id);
                        return <ExtLink key={s.material_id} href={m?.url ?? null} className="source-chip">{m?.title ?? '资料'}{s.pages.length ? ` · ${pagesLabel(s.pages)}` : ''}</ExtLink>;
                      })}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </Section>

          {c.cheatsheet ? <Section title="必背速查"><div className="card card-pad cheatsheet"><Markdown text={c.cheatsheet} /></div></Section> : null}

          <Section title="本周作业与考试">
            {data.assignments.length ? (
              <>
                <TaskList tasks={data.assignments} />
                {data.assignments.some((a) => relation.has(a.id)) ? (
                  <ul className="relations">
                    {data.assignments.filter((a) => relation.has(a.id)).map((a) => <li key={a.id}><b>{a.title}</b>：{relation.get(a.id)}</li>)}
                  </ul>
                ) : null}
              </>
            ) : <p className="muted">这一周没有要交的。</p>}
          </Section>

          <Section title="自测题" note="先自己想，再点开看答案">
            <div className="stack">
              {c.self_test.map((q, i) => (
                <details key={i} className="card quiz">
                  <summary><span className="q-no">{i + 1}</span><Markdown text={q.question} /></summary>
                  <div className="answer"><Markdown text={q.answer} /></div>
                </details>
              ))}
            </div>
          </Section>

          <Section title="学习安排" note={total ? `共约 ${Math.round(total / 6) / 10} 小时` : undefined}>
            <ol className="plan">
              {c.study_plan.map((p, i) => <li key={i}><span className="grow"><Markdown text={p.step} /></span><span className="figures small">{p.minutes} 分钟</span></li>)}
            </ol>
          </Section>
        </div>
      )}

      {data.materials.length + data.assignments.length > 0 ? <AskBox courseId={courseId} week={week} qa={data.qa} onAsked={reload} /> : null}

      <Section title="本周资料" note={`${data.materials.length} 份 · 点开在 Canvas 查看`}>
        {data.materials.length === 0 ? <p className="muted">没有。</p> : (
          <div className="card list">
            {data.materials.map((m) => (
              <ExtLink key={m.id} href={m.url} className="list-row">
                <span className="mod-icon" aria-hidden="true"><Icon name={KIND_ICON[m.kind] ?? 'dot'} size={15} /></span>
                <span className="grow">{m.title}</span>
                <span className="small muted">{[m.pages ? `${m.pages} 页` : '', m.scanned ? '扫描版' : '', !m.hasText && m.kind !== 'link' ? '未读取到文字' : ''].filter(Boolean).join(' · ')}</span>
              </ExtLink>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function AskBox({ courseId, week, qa, onAsked }: { courseId: string; week: number; qa: StudyQa[]; onAsked: () => void }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ask = async (text: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/study/${encodeURIComponent(courseId)}/${week}/ask`, { method: 'POST', body: { question: text } });
      setQuestion('');
      onAsked();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="问一问" note="针对这周的课件提问，中文回答并标出课件页码">
      <div className="card card-pad ask-box">
        <textarea className="input" rows={3} maxLength={1000} value={question} placeholder="比如：为什么弱酸滴定的等当点 pH 大于 7？这页的公式是怎么来的？"
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && question.trim()) void ask(question); }} />
        <div className="row">
          <span className="small muted">⌘ + 回车 发送 · 一般 20–60 秒</span>
          <button type="button" className="btn btn-sm btn-primary right" disabled={busy || !question.trim()} onClick={() => void ask(question)}>{busy ? '提交中…' : '提问'}</button>
        </div>
        <ErrorNote error={error} />
      </div>
      {qa.length ? (
        <div className="stack qa-list">
          {qa.map((x) => (
            <article key={x.id} className="card card-pad qa">
              <div className="qa-q"><span className="qa-mark">问</span>{x.question}</div>
              {x.status === 'pending' ? <div className="qa-a muted"><span className="spinner" /> 正在读这周的课件，马上回答…</div>
                : x.status === 'failed' ? (
                  <div className="qa-a"><span className="muted">没答上来（{x.error}）</span> <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void ask(x.question)}>再问一次</button></div>
                ) : <div className="qa-a"><span className="qa-mark is-a">答</span><Markdown text={x.answer ?? ''} /></div>}
              <div className="small muted">{fmtRelative(x.created_at)}</div>
            </article>
          ))}
        </div>
      ) : null}
    </Section>
  );
}
