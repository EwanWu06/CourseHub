import type { ReactNode } from 'react';
import { api, useApi } from '../api.ts';
import { fmtDue, fmtRelative, weekdayName } from '../format.ts';
import { Markdown } from '../components/Markdown.tsx';
import { TaskList } from '../components/TaskRow.tsx';
import { ErrorNote, ExtLink, Section, Loading } from '../components/ui.tsx';
import { groupBlocks, hoursText, periodLabel, planMinutes, workloadWidth } from '../lib/reports.ts';
import { dateKey } from '../lib/tasks.ts';
import { useReportGenerator } from '../lib/useReportGenerator.ts';
import { Link, navigate } from '../router.tsx';
import type { DailyAi, DailyData, ReportDetail, ReportListItem, TaskView, WeeklyAi, WeeklyData } from '../types.ts';

const noon = (day: string) => new Date(`${day}T12:00:00`);
const hours = (minutes: number) => Math.round(minutes / 30) / 2;

export function ReportView({ id }: { id: string }) {
  const { data, error, reload } = useApi<ReportDetail>(`/api/reports/${encodeURIComponent(id)}`);
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const afterRegenerate = () => {
    void api<ReportListItem[]>(`/api/reports?type=${data.type}`).then((list) => {
      if (list[0] && list[0].id !== data.id) navigate(`/reports/${list[0].id}`);
      else reload();
    });
  };
  return data.report.kind === 'daily'
    ? <DailyView detail={data} d={data.report.data} ai={data.report.ai} aiError={data.report.aiError} onRegenerated={afterRegenerate} />
    : <WeeklyView detail={data} w={data.report.data} ai={data.report.ai} aiError={data.report.aiError} onRegenerated={afterRegenerate} />;
}

function Header({ detail, kind, canRegenerate, onRegenerated }: { detail: ReportDetail; kind: 'daily' | 'weekly'; canRegenerate: boolean; onRegenerated: () => void }) {
  const gen = useReportGenerator(kind, onRegenerated);
  return (
    <header className="masthead">
      <div>
        <div className="kicker"><Link to={kind === 'daily' ? '/reports' : '/reports?type=weekly'}>报告</Link> · {kind === 'daily' ? '日报 Daily brief' : '周报 Weekly'}</div>
        <h1 className="title">{periodLabel(kind, detail.period)}</h1>
      </div>
      <div className="masthead-aside row">
        <span className="small muted">{fmtRelative(detail.createdAt)}生成</span>
        {canRegenerate ? (
          <button type="button" className="btn btn-sm" disabled={gen.busy} onClick={() => void gen.start()}>
            {gen.busy ? <><span className="spinner" /> 生成中…</> : '重新生成'}
          </button>
        ) : null}
      </div>
      {gen.error ? <ErrorNote error={gen.error} /> : null}
    </header>
  );
}

function Stat({ n, label, tone }: { n: ReactNode; label: string; tone?: 'seal' | 'amber' }) {
  const zero = n === 0; // nothing there: no colour, the figure steps back
  return <div className={`stat ${tone && !zero ? `is-${tone}` : ''} ${zero ? 'is-zero' : ''}`}><div className="n">{n}</div><div className="l">{label}</div></div>;
}

/** A score as people write it: 9.35, not 9.3452380952381. */
const score = (x: number | null | undefined) => (x === null || x === undefined ? '—' : Math.round(x * 100) / 100);

/** The headline sits inside quotation marks: its own full stop would leave the closing mark adrift. */
const quoted = (text: string) => text.replace(/[。.]\s*$/, '');

function TaskLink({ t, now }: { t: TaskView; now: Date }) {
  return (
    <ExtLink href={t.htmlUrl} className="plan-task">
      <span className="course-chip" style={{ ['--c' as string]: t.color }}><i />{t.courseName}</span>
      <span className="grow">{t.title}</span>
      <span className="figures small">{fmtDue(t.dueAt, now, { dateOnly: t.dueDateOnly })}</span>
    </ExtLink>
  );
}

function Plan({ ai, byId, now }: { ai: DailyAi; byId: Map<string, TaskView>; now: Date }) {
  const groups = groupBlocks(ai.blocks);
  return (
    <Section title="今天怎么安排" note={`AI 建议 · 共约 ${hoursText(planMinutes(ai.blocks))}`}>
      {groups.length === 0 ? <p className="muted">今天没有需要安排的。</p> : (
        <div className="plan-grid">
          {groups.map((g) => (
            <div key={g.slot} className="plan-col">
              <div className="plan-slot">{g.slot}</div>
              {g.blocks.map((b, i) => {
                const t = b.item_id ? byId.get(b.item_id) : undefined;
                return (
                  <div key={i} className="plan-block" style={{ ['--c' as string]: t?.color ?? 'var(--rule-strong)' }}>
                    <div className="row"><b className="grow">{b.title}</b><span className="figures small muted">{b.minutes} 分钟</span></div>
                    {t ? <TaskLink t={t} now={now} /> : null}
                    {b.note ? <div className="small muted">{b.note}</div> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {ai.tips.length ? <ul className="tips">{ai.tips.map((x, i) => <li key={i}>{x}</li>)}</ul> : null}
    </Section>
  );
}

function DailyView({ detail, d, ai, aiError, onRegenerated }: { detail: ReportDetail; d: DailyData; ai: DailyAi | null; aiError: string | null; onRegenerated: () => void }) {
  const now = new Date();
  const byId = new Map([...d.overdue, ...d.dueToday, ...d.next3Days, ...d.laterThisWeek, ...d.eventsToday, ...d.examsSoon].map((t) => [t.id, t]));
  const news = d.announcements.length + d.grades.length + d.dueChanges.length;
  return (
    <div className="page report is-numbered">
      <Header detail={detail} kind="daily" canRegenerate={detail.period === dateKey(now)} onRegenerated={onRegenerated} />
      <section className="report-lead">
        <p className="lead-headline">{quoted(detail.headline)}</p>
        <div className="stats stats-4">
          <Stat n={d.overdue.length} label="逾期 / 缺交" tone="seal" />
          <Stat n={d.dueToday.length} label="今天截止" tone="amber" />
          <Stat n={d.next3Days.length} label="接下来 3 天" />
          <Stat n={hours(d.totals.minutes)} label="小时待办" />
        </div>
      </section>
      {d.loginNeeded.length ? (
        <div className="callout bad"><b>需要重新登录：</b>{d.loginNeeded.map((s) => s.name).join('、')}<Link to="/settings" className="btn btn-sm btn-seal right">去登录</Link></div>
      ) : null}
      {ai ? <Plan ai={ai} byId={byId} now={now} /> : <div className="callout warn">这份日报没有 AI 时间安排（{aiError}）。下面的清单都直接来自 Canvas。</div>}

      {d.overdue.length ? <Section title="逾期 / 缺交" note="还能补交的尽快补"><TaskList tasks={d.overdue} now={now} /></Section> : null}
      <Section title="今天截止"><TaskList tasks={d.dueToday} now={now} showDate={false} empty="今天没有截止的作业。" /></Section>
      <Section title="接下来 3 天"><TaskList tasks={d.next3Days} now={now} empty="接下来 3 天没有截止的作业。" /></Section>
      {d.laterThisWeek.length ? <Section title="本周剩下的"><TaskList tasks={d.laterThisWeek} now={now} /></Section> : null}
      {d.eventsToday.length ? <Section title="今天的日程"><TaskList tasks={d.eventsToday} now={now} showDate={false} /></Section> : null}
      {d.examsSoon.length ? <Section title="近期考试" note="两周内"><TaskList tasks={d.examsSoon} now={now} /></Section> : null}

      <Section title="动态" note="上一份日报以来">
        {news === 0 ? <p className="muted">没有新公告、新成绩或截止时间变化。</p> : (
          <div className="card list">
            {d.dueChanges.map((c) => (
              <div key={`due-${c.itemId}`} className="list-row">
                <span className="badge warn">截止时间变了</span>
                <span className="grow"><b>{c.courseName}</b> {c.title}</span>
                <span className="figures small"><span className="nowrap">{fmtDue(c.from, now)}</span> → <b className="nowrap">{fmtDue(c.to, now)}</b></span>
              </div>
            ))}
            {d.grades.map((g) => (
              <div key={`grade-${g.itemId}`} className="list-row">
                <span className="badge ok">新成绩</span>
                <span className="grow"><b>{g.courseName}</b> {g.title}</span>
                <span className="figures small">{score(g.score)}{g.points !== null ? ` / ${g.points}` : ''}</span>
              </div>
            ))}
            {d.announcements.map((a) => (
              <ExtLink key={a.id} href={a.htmlUrl} className="list-row">
                <span className="badge">公告</span>
                <span className="grow"><b>{a.courseName}</b> {a.title}</span>
                <span className="small muted">{fmtRelative(a.postedAt, now)}</span>
              </ExtLink>
            ))}
          </div>
        )}
      </Section>

      {d.studyFocus.length ? (
        <Section title="本周学习重点" note={<Link to="/study">去学习页 →</Link>}>
          <div className="focus-grid">
            {d.studyFocus.map((s) => (
              <Link key={s.courseId} to={`/study/${s.courseId}/${s.week}`} className="card card-pad focus-card">
                <div className="row"><b>{s.courseName}</b><span className="small muted right">第 {s.week} 周</span></div>
                {s.overview ? <Markdown text={s.overview} className="small" /> : <p className="small">{s.status === 'queued' || s.status === 'running' ? '讲解正在生成…' : '这一周的讲解还没生成，点进去生成。'}</p>}
              </Link>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

function WeeklyView({ detail, w, ai, aiError, onRegenerated }: { detail: ReportDetail; w: WeeklyData; ai: WeeklyAi | null; aiError: string | null; onRegenerated: () => void }) {
  const now = new Date();
  const max = Math.max(0, ...w.next.days.map((d) => d.minutes));
  const total = w.next.days.reduce((n, d) => n + d.minutes, 0);
  const deadlines = w.next.days.reduce((n, d) => n + d.items.length, 0) - w.next.exams.length;
  const monday = (() => {
    const d = new Date(now);
    const back = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - back);
    return dateKey(d);
  })();
  return (
    <div className="page report is-numbered">
      <Header detail={detail} kind="weekly" canRegenerate={detail.period >= monday} onRegenerated={onRegenerated} />
      <section className="report-lead">
        <p className="lead-headline">{quoted(detail.headline)}</p>
        <div className="stats">
          <Stat n={deadlines} label="项截止" />
          <Stat n={w.next.exams.length} label="场考试" tone="seal" />
          <Stat n={hours(total)} label="小时工作量" />
        </div>
      </section>
      {ai ? (
        <div className="advice-grid">
          <Advice title="这周的重点" items={ai.focus} />
          <Advice title="要小心" items={ai.risks} empty="没有特别的风险。" tone="seal" />
          <Advice title="建议" items={ai.suggestions} />
        </div>
      ) : <div className="callout warn">这份周报没有 AI 建议（{aiError}）。下面的安排都直接来自 Canvas。</div>}

      <Section title="每天要交的" note={w.busiest ? `最忙：${weekdayName(noon(w.busiest))}` : undefined}>
        <div className="week-strip card">
          {w.next.days.map((d) => {
            const day = noon(d.date);
            return (
              <div key={d.date} className={`day-row ${d.date === w.busiest ? 'is-busiest' : ''} ${d.date === dateKey(now) ? 'is-today' : ''}`}>
                <div className="day-label"><b>{weekdayName(day)}</b><span className="small muted">{day.getMonth() + 1}/{day.getDate()}</span></div>
                <div className="day-load">
                  <div className="day-bar"><i style={{ width: `${workloadWidth(d.minutes, max)}%` }} /></div>
                  <span className="figures small muted">{d.minutes ? hoursText(d.minutes) : ''}</span>
                </div>
                <div className="day-items">
                  {d.items.length === 0 ? <span className="small muted">—</span> : d.items.map((t) => (
                    <ExtLink key={t.id} href={t.htmlUrl} className={`day-item ${t.status === 'done' ? 'is-done' : ''}`}>
                      <span className="course-chip" style={{ ['--c' as string]: t.color }}><i />{t.courseName}</span>
                      <span>{t.title}</span>
                      {w.next.exams.some((e) => e.id === t.id) ? <span className="seal seal-sm">考</span> : null}
                    </ExtLink>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="考试预警">
        <TaskList tasks={w.next.exams} now={now} empty="这一周没有考试。" />
      </Section>

      <Section title="各课学什么">
        {w.next.topics.length === 0 ? <p className="muted">还不知道这一周各课的主题（同步后会自动更新）。</p> : (
          <div className="focus-grid">
            {w.next.topics.map((t) => (
              <Link key={t.courseId} to={`/study/${t.courseId}/${t.week}`} className="card card-pad focus-card">
                <div className="row"><b>{t.courseName}</b><span className="small muted right">第 {t.week} 周</span></div>
                {t.topics.length ? <div className="topics">{t.topics.slice(0, 5).map((x) => <span key={x} className="topic">{x}</span>)}</div> : t.title ? <div className="small">{t.title}</div> : null}
                {t.overview ? <Markdown text={t.overview} className="small" /> : null}
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="上周回顾">
        <div className="stats stats-inline">
          <Stat n={w.last.onTime} label="按时交" />
          <Stat n={w.last.late} label="迟交" tone="amber" />
          <Stat n={w.last.missing} label="缺交 / 没交" tone="seal" />
        </div>
        {w.last.graded.length ? (
          <div className="card list" style={{ marginTop: 12 }}>
            {w.last.graded.map((g, i) => (
              <div key={i} className="list-row"><span className="badge ok">新成绩</span><span className="grow"><b>{g.courseName}</b> {g.title}</span><span className="figures small">{score(g.score)}{g.points !== null ? ` / ${g.points}` : ''}</span></div>
            ))}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

function Advice({ title, items, empty, tone }: { title: string; items: string[]; empty?: string; tone?: 'seal' }) {
  return (
    <div className={`card card-pad advice ${tone ? `is-${tone}` : ''}`}>
      <div className="kicker">{title}</div>
      {items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="small muted">{empty ?? '—'}</p>}
    </div>
  );
}
