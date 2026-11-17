import { useEffect, useRef, useState } from 'react';
import { api, useApi } from '../api.ts';
import { fmtBytes, fmtDate, fmtDateTime, fmtDue, fmtRelative } from '../format.ts';
import { CanvasHtml } from '../components/CanvasHtml.tsx';
import { TaskList } from '../components/TaskRow.tsx';
import { Badge, Empty, ErrorNote, ExtLink, Section, Loading, useDocumentTitle } from '../components/ui.tsx';
import { Icon } from '../components/Icon.tsx';
import { fileStatus, itemTypeIcon, moduleWeekLabel, courseTab } from '../lib/course.ts';
import { STATUS_LABEL } from '../lib/tasks.ts';
import { Link } from '../router.tsx';
import type { CourseDetailT, FileT, GradesT, ModuleItemT, ModuleT, PageT, SyllabusT, TaskView, TopicT } from '../types.ts';

const TABS = [
  { id: 'overview', label: '概览' },
  { id: 'assignments', label: '作业' },
  { id: 'modules', label: '模块' },
  { id: 'pages', label: '页面' },
  { id: 'files', label: '文件' },
  { id: 'announcements', label: '公告' },
  { id: 'discussions', label: '讨论' },
  { id: 'grades', label: '成绩' },
  { id: 'study', label: '学习' },
];

const enc = encodeURIComponent;

function SyllabusAnalysis({ id, analysis }: { id: string; analysis: SyllabusT['analysis'] }) {
  const [queued, setQueued] = useState(false);
  const rerun = async () => {
    await api(`/api/courses/${enc(id)}/analyze`, { method: 'POST' });
    setQueued(true);
  };
  const s = analysis?.summary;
  return (
    <div className="callout info" style={{ alignItems: 'center' }}>
      <Icon name="search" size={16} />
      <span className="grow">
        <b>AI 读大纲</b>：
        {analysis?.error ? <span style={{ color: 'var(--seal)' }}>上次失败（{analysis.error.slice(0, 60)}）</span>
          : s ? <>找到并核对了 {s.examsApplied} 场考试{s.examsRejected ? `（另有 ${s.examsRejected} 条无法在原文核实，已忽略）` : ''}，修正了 {s.categoriesApplied} 个类别{s.weeksApplied ? `，整理了 ${s.weeksApplied} 周的主题` : ''} · {fmtRelative(analysis!.analyzedAt)}</>
          : '还没有分析（同步后会自动进行）'}
      </span>
      <button type="button" className="btn btn-sm" disabled={queued} onClick={() => void rerun()}>{queued ? '已排队…' : '重新读取大纲'}</button>
    </div>
  );
}

/** How the final grade is made up: weighted categories (or plain points) and the scores each drops. */
function Grading({ grading }: { grading: NonNullable<CourseDetailT['grading']> }) {
  const groups = grading.groups.filter((g) => (grading.weighted ? (g.weight ?? 0) > 0 : g.count > 0) || g.dropLowest || g.dropHighest);
  if (!groups.length) return null;
  return (
    <Section title="成绩怎么算" note={grading.weighted ? '按类别加权' : '按总分算，各类不加权'}>
      <div className="card grading">
        {groups.map((g) => (
          <div key={g.name} className="grading-row">
            <span className="grow">{g.name}</span>
            {g.dropLowest ? <Badge tone="warn">最低 {g.dropLowest} 次不计</Badge> : null}
            {g.dropHighest ? <Badge>最高 {g.dropHighest} 次不计</Badge> : null}
            {grading.weighted ? <span className="grading-w figures">{g.weight ?? 0}%</span> : <span className="small muted">{g.count} 项</span>}
          </div>
        ))}
      </div>
    </Section>
  );
}

const UNLOCK_WHAT: Record<string, string> = {
  must_view: '要打开看过', must_submit: '要提交', must_contribute: '要发帖', must_mark_done: '要点「标记为完成」', min_score: '分数要够', min_percentage: '分数要够',
};

/** Module requirements this student hasn't met: until they are, later modules can stay locked. */
function Unlock({ list }: { list: NonNullable<CourseDetailT['unlock']> }) {
  if (!list.length) return null;
  return (
    <Section title="模块要求还没完成" note="没完成的话，后面的模块可能一直锁着">
      <div className="card grading">
        {list.map((u, i) => (
          <div key={i} className="grading-row">
            <span className="grow">{u.htmlUrl ? <ExtLink href={u.htmlUrl}>{u.title}</ExtLink> : u.title}<span className="small muted"> · {u.module}</span></span>
            <Badge tone="warn">{UNLOCK_WHAT[u.type] ?? u.type}{u.minScore !== null && (u.type === 'min_score' || u.type === 'min_percentage') ? `（至少 ${u.minScore}${u.type === 'min_percentage' ? '%' : ' 分'}）` : ''}</Badge>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Overview({ id, detail }: { id: string; detail: CourseDetailT }) {
  const { data } = useApi<SyllabusT>(`/api/courses/${enc(id)}/syllabus`);
  return (
    <div className="stack">
      <div className="grid-2">
        <div className="card card-pad">
          <div className="kicker">This week</div>
          <div className="big-week">{detail.currentWeek && detail.currentWeek > 0 ? `第 ${detail.currentWeek} 周` : '—'}</div>
          <div className="small muted">
            {detail.course.term_name ?? ''}
            {detail.course.week1 ? ` · 第 1 周从 ${fmtDate(new Date(`${detail.course.week1}T12:00:00`))}开始` : detail.course.start_at ? ` · ${fmtDate(new Date(detail.course.start_at))} 开课` : ''}
          </div>
        </div>
        <div className="card card-pad">
          <div className="kicker">At a glance</div>
          <div className="glance">
            <Link to={`/courses/${id}/assignments`}><b>{detail.counts.assignments}</b> 项作业</Link>
            <Link to={`/courses/${id}/modules`}><b>{detail.counts.modules}</b> 个模块</Link>
            <Link to={`/courses/${id}/files`}><b>{detail.counts.files}</b> 个文件</Link>
            <Link to={`/courses/${id}/announcements`}><b>{detail.counts.announcements}</b> 条公告</Link>
          </div>
        </div>
      </div>
      {detail.unlock ? <Unlock list={detail.unlock} /> : null}
      {detail.grading ? <Grading grading={detail.grading} /> : null}
      <Section title="教学大纲" note={data ? <ExtLink href={data.htmlUrl}>在 Canvas 打开</ExtLink> : null}>
        {!data ? <Loading /> : (
          <>
            <div style={{ marginBottom: 12 }}><SyllabusAnalysis id={id} analysis={data.analysis} /></div>
            {data.files.length ? (
              <div className="row" style={{ marginBottom: 12 }}>
                {data.files.map((f) => <ExtLink key={f.id} href={f.html_url} className="btn btn-sm"><Icon name="file" size={14} />{f.name}</ExtLink>)}
              </div>
            ) : null}
            <CanvasHtml html={data.html} empty="这门课没有在 Canvas「Syllabus」页写大纲内容（可能在文件或页面里）。" />
          </>
        )}
      </Section>
    </div>
  );
}

function Assignments({ id }: { id: string }) {
  const { data } = useApi<TaskView[]>(`/api/courses/${enc(id)}/assignments`);
  if (!data) return <Loading />;
  const now = new Date();
  const open = data.filter((t) => t.dueAt && ['todo', 'overdue', 'missing'].includes(t.status)).sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));
  const undated = data.filter((t) => !t.dueAt && t.status !== 'done');
  const finished = data.filter((t) => t.dueAt && !['todo', 'overdue', 'missing'].includes(t.status)).sort((a, b) => Date.parse(b.dueAt!) - Date.parse(a.dueAt!));
  return (
    <>
      <Section title="待完成" note={`${open.length} 项`}><TaskList tasks={open} now={now} empty="都完成了。" exitOnDone /></Section>
      {undated.length ? <Section title="无截止日期"><TaskList tasks={undated} now={now} /></Section> : null}
      <Section title="已完成 / 已过" note={`${finished.length} 项`}><TaskList tasks={finished} now={now} /></Section>
    </>
  );
}

function ModuleItem({ courseId, item }: { courseId: string; item: ModuleItemT }) {
  if (item.type === 'SubHeader') return <div className="mod-sub" style={{ paddingLeft: 4 + item.indent * 16 }}>{item.title}</div>;
  const ref = item.ref;
  const fs = ref?.kind === 'file' && ref.textStatus ? fileStatus(ref.textStatus, null) : null;
  const inApp = ref?.kind === 'page' ? `/courses/${courseId}/pages/${ref.id}` : null;
  const href = item.type === 'ExternalUrl' ? item.external_url : item.html_url;
  return (
    <div className="mod-item" style={{ paddingLeft: 4 + item.indent * 16 }}>
      <span className="mod-icon" aria-hidden="true"><Icon name={itemTypeIcon(item.type)} size={15} /></span>
      <div className="grow">
        {inApp ? <Link to={inApp} className="mod-title">{item.title}</Link> : <ExtLink href={href} className="mod-title">{item.title}</ExtLink>}
        <div className="small muted row" style={{ gap: 10 }}>
          {ref?.dueAt ? <span className="figures">{fmtDue(ref.dueAt)}</span> : null}
          {ref?.status && ref.status !== 'todo' ? <span>{STATUS_LABEL[ref.status]}</span> : null}
          {fs ? <Badge tone={fs.tone}>{fs.label}</Badge> : null}
          {inApp && item.html_url ? <ExtLink href={item.html_url}>Canvas</ExtLink> : null}
        </div>
      </div>
    </div>
  );
}

function Modules({ id, currentWeek }: { id: string; currentWeek: number | null }) {
  const { data } = useApi<{ module: ModuleT; items: ModuleItemT[] }[]>(`/api/courses/${enc(id)}/modules`);
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty glyph="模">这门课没有模块（或者老师隐藏了模块页）。</Empty>;
  // this week's module opens by itself; with no weeks to go by, the short ones do
  const isCurrent = (m: ModuleT) => currentWeek !== null && m.week_start !== null && m.week_start <= currentWeek && currentWeek <= (m.week_end ?? m.week_start);
  const anyCurrent = data.some(({ module }) => isCurrent(module));
  return (
    <div className="stack">
      {data.map(({ module, items }) => {
        const week = moduleWeekLabel(module);
        const current = isCurrent(module);
        return (
          <details key={module.id} className={`card module ${current ? 'is-current' : ''}`} open={anyCurrent ? current : items.length <= 12}>
            <summary className="module-head">
              <span className="grow">{module.name}</span>
              {current ? <span className="seal seal-sm" title="本周">本</span> : null}
              {week ? <span className="badge">{week}</span> : <span className="badge muted">未分周</span>}
              <span className="small muted">{items.filter((i) => i.type !== 'SubHeader').length} 项</span>
            </summary>
            <div className="module-body">{items.map((it) => <ModuleItem key={it.id} courseId={id} item={it} />)}</div>
          </details>
        );
      })}
    </div>
  );
}

function PageView({ pageId }: { pageId: string }) {
  const { data, error } = useApi<{ page: PageT }>(`/api/pages/${enc(pageId)}`);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Loading />;
  return (
    <article className="stack">
      <div className="row">
        <h2 className="grow" style={{ fontFamily: 'var(--font-zh)', fontSize: 24 }}>{data.page.title}</h2>
        <ExtLink href={data.page.html_url} className="btn btn-sm">在 Canvas 打开</ExtLink>
      </div>
      {data.page.updated_at ? <div className="small muted">更新于 {fmtDateTime(data.page.updated_at)}</div> : null}
      <CanvasHtml html={data.page.body_html ?? null} />
    </article>
  );
}

function Pages({ id, sub }: { id: string; sub?: string }) {
  const { data } = useApi<PageT[]>(sub ? null : `/api/courses/${enc(id)}/pages`);
  if (sub) return (<><Link to={`/courses/${id}/pages`} className="small">← 全部页面</Link><PageView pageId={sub} /></>);
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty glyph="页">没有页面（或者老师隐藏了页面列表，可以从「模块」进入）。</Empty>;
  return (
    <div className="card list">
      {data.map((p) => (
        <Link key={p.id} to={`/courses/${id}/pages/${p.id}`} className="list-row">
          {p.front_page ? <span className="mod-icon" title="课程首页"><Icon name="home" size={15} /></span> : null}
          <span className="grow">{p.title}</span>
          <span className="small muted">{p.updated_at ? fmtRelative(p.updated_at) : ''}</span>
        </Link>
      ))}
    </div>
  );
}

function Files({ id }: { id: string }) {
  const { data } = useApi<FileT[]>(`/api/courses/${enc(id)}/files`);
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty glyph="档">没有文件。</Empty>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>文件</th><th>大小</th><th>更新</th><th>AI 可读</th><th /></tr></thead>
        <tbody>
          {data.map((f) => {
            const st = fileStatus(f.text_status, f.text_error);
            return (
              <tr key={f.id}>
                <td>{f.name}</td>
                <td className="figures small nowrap">{fmtBytes(f.size)}</td>
                <td className="small muted nowrap">{f.updated_at ? fmtRelative(f.updated_at) : ''}</td>
                <td><Badge tone={st.tone}>{st.label}{f.text_pages ? ` · ${f.text_pages} 页` : ''}</Badge></td>
                <td className="nowrap"><ExtLink href={f.html_url}>在 Canvas 打开</ExtLink></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Topics({ id, kind }: { id: string; kind: 'announcements' | 'discussions' }) {
  const { data } = useApi<TopicT[]>(`/api/courses/${enc(id)}/${kind}`);
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return <Loading />;
  if (data.length === 0) return <Empty glyph={kind === 'announcements' ? '告' : '论'}>{kind === 'announcements' ? '没有公告。' : '没有讨论。'}</Empty>;
  return (
    <div className="stack">
      {data.map((t) => (
        <article key={t.id} className="card card-pad">
          <div className="row">
            <button type="button" className="topic-title grow" onClick={() => setOpen(open === t.id ? null : t.id)} aria-expanded={open === t.id}>{t.title}</button>
            {t.unread_count ? <span className="badge warn">{t.unread_count} 条未读</span> : null}
            {kind === 'discussions' ? <span className="small muted">{t.reply_count} 回复</span> : null}
            <ExtLink href={t.html_url} className="small">Canvas</ExtLink>
          </div>
          <div className="small muted">{[t.author, t.posted_at ? fmtDateTime(t.posted_at) : null].filter(Boolean).join(' · ')}</div>
          {open === t.id ? <div style={{ marginTop: 12 }}><CanvasHtml html={t.message_html} /></div> : null}
        </article>
      ))}
    </div>
  );
}

function Grades({ id }: { id: string }) {
  const { data } = useApi<GradesT>(`/api/courses/${enc(id)}/grades`);
  if (!data) return <Loading />;
  return (
    <div className="stack">
      <div className="row">
        <div className="score big">
          <div className="n">{data.grade ?? (data.score !== null ? Math.round(data.score) : '—')}</div>
          <div className="l">{data.score !== null ? `${data.score.toFixed(1)}%` : '暂无总分'}</div>
        </div>
        <ExtLink href={data.htmlUrl} className="btn btn-sm right">在 Canvas 查看成绩</ExtLink>
      </div>
      <div className="card table-wrap">
        <table className="table">
          <thead><tr><th>作业</th><th>截止</th><th>得分</th><th>状态</th></tr></thead>
          <tbody>
            {data.items.map((g) => (
              <tr key={g.id}>
                <td>{g.htmlUrl ? <ExtLink href={g.htmlUrl}>{g.title}</ExtLink> : g.title}</td>
                <td className="figures small nowrap">{g.dueAt ? fmtDue(g.dueAt) : '—'}</td>
                <td className="figures nowrap">{g.excused ? '免做' : g.score !== null ? `${g.score} / ${g.points ?? '?'}` : g.points !== null ? `— / ${g.points}` : '—'}</td>
                <td className="small">{STATUS_LABEL[g.status]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function CourseDetail({ id, tab: requested, sub }: { id: string; tab?: string; sub?: string }) {
  const tab = courseTab(requested);
  const { data, error } = useApi<CourseDetailT>(`/api/courses/${enc(id)}`);
  useDocumentTitle(data?.course.display_name ?? null);
  // a tab off the edge of a phone's strip (成绩, 学习…) scrolls into sight when it is the open one
  const tabsRef = useRef<HTMLElement>(null);
  useEffect(() => {
    tabsRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab, !!data]);
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const color = data.course.color ?? data.school?.color ?? '#888';
  return (
    <div className="page" style={{ ['--c' as string]: color }}>
      <header className="masthead course-head">
        <div>
          <div className="kicker"><Link to="/courses">课程</Link> · {data.school?.name}</div>
          <h1 className="title"><span className="title-dot" />{data.course.display_name}</h1>
          <div className="small muted">{data.course.name}</div>
        </div>
        <div className="masthead-aside">
          <ExtLink href={data.course.html_url} className="btn btn-sm">在 Canvas 打开</ExtLink>
        </div>
      </header>
      <nav className="tabs" aria-label="课程内容" ref={tabsRef}>
        {TABS.map((t) => (
          <Link key={t.id} to={t.id === 'study' ? `/study/${id}` : `/courses/${id}/${t.id}`} aria-current={tab === t.id ? 'page' : undefined}>{t.label}</Link>
        ))}
      </nav>
      <div className="tab-body">
        {tab === 'overview' ? <Overview id={id} detail={data} /> : null}
        {tab === 'assignments' ? <Assignments id={id} /> : null}
        {tab === 'modules' ? <Modules id={id} currentWeek={data.currentWeek} /> : null}
        {tab === 'pages' ? <Pages id={id} sub={sub} /> : null}
        {tab === 'files' ? <Files id={id} /> : null}
        {tab === 'announcements' ? <Topics id={id} kind="announcements" /> : null}
        {tab === 'discussions' ? <Topics id={id} kind="discussions" /> : null}
        {tab === 'grades' ? <Grades id={id} /> : null}
      </div>
    </div>
  );
}
