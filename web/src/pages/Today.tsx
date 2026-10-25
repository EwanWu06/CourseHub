import { refreshAll, useApi } from '../api.ts';
import { fmtRelative, hhmm, weekdayName } from '../format.ts';
import { CountUp } from '../components/CountUp.tsx';
import { TaskList, TaskRow } from '../components/TaskRow.tsx';
import { ErrorNote, ExtLink, Loading, useDocumentTitle } from '../components/ui.tsx';
import { lunarDate, zhMonth } from '../lib/almanac.ts';
import { hoursText } from '../lib/reports.ts';
import { CATEGORY_LABEL, KIND_LABEL, dateKey, providerNote } from '../lib/tasks.ts';
import { bundleTasks, examCountdown, examDaysUntil, examScope, examUrgency, homeworkCounts, homeworkDays } from '../lib/today.ts';
import { useReportGenerator } from '../lib/useReportGenerator.ts';
import { Link } from '../router.tsx';
import type { Overview, SchoolView, TaskView } from '../types.ts';

const WEEK_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const EXAMS_SHOWN = 6;

function greeting(h: number): string {
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

/** One figure of the header: big numeral, its label, an optional aside ("约 4 小时"). */
function Stat({ n, label, tone, sub }: { n: number; label: string; tone?: 'bad' | 'warn'; sub?: string }) {
  return (
    <div className={`tstat ${tone && n ? `is-${tone}` : ''} ${n ? '' : 'is-zero'}`}>
      <dt>{label}</dt>
      <dd>
        {/* the final value, invisible, holds the width so counting up never shifts the row */}
        <b className="tstat-n"><span className="tstat-ghost" aria-hidden="true">{n}</span><span aria-hidden="true"><CountUp value={n} /></span><span className="sr-only">{n}</span></b>
        {sub ? <span className="tstat-sub">{sub}</span> : null}
      </dd>
    </div>
  );
}

const SHORT_WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/**
 * The next seven days as a ruler: one column per day, its height the estimated hours due that day (the busiest
 * day in ink, the rest in grey), a 考 seal standing on exam days. Details on hover or focus; a click jumps to the day.
 */
function WeekRuler({ tasks, exams, now }: { tasks: TaskView[]; exams: TaskView[]; now: Date }) {
  const { days } = homeworkDays(tasks, now);
  const cols = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const day = days.find((x) => x.key === key);
    const exam = exams.find((e) => e.dueAt && dateKey(new Date(e.dueAt)) === dateKey(d));
    return { key, d, i, minutes: day?.minutes ?? 0, count: day?.tasks.length ?? 0, exam };
  });
  const max = Math.max(...cols.map((c) => c.minutes));
  const busiest = max > 0 ? cols.find((c) => c.minutes === max)!.key : null;
  const name = (c: (typeof cols)[number]) => (c.i === 0 ? '今天' : c.i === 1 ? '明天' : SHORT_WEEK[c.d.getDay()]);
  // heights in px: the bar, what stands on it (the busiest day's figure, then the seal), and the plot that holds them all
  const bar = (c: (typeof cols)[number]) => (c.count ? Math.max(4, Math.round((max ? c.minutes / max : 0) * 44)) : 0);
  const top = (c: (typeof cols)[number]) => bar(c) + (c.key === busiest ? 18 : 0);
  const sealAt = (c: (typeof cols)[number]) => (c.count ? top(c) + 6 : 3);
  const plot = Math.max(62, ...cols.map((c) => (c.exam ? sealAt(c) + 23 : top(c)) + 4));
  return (
    <ol className="ruler" style={{ ['--plot' as string]: `${plot}px` }} aria-label="未来 7 天的作业量">
      {cols.map((c) => {
        const what = c.count ? `${c.count} 项，约 ${hoursText(c.minutes)}` : '没有要交的';
        return (
          <li key={c.key}>
            <button type="button" disabled={!c.count && !c.exam}
              className={`ruler-col ${c.key === busiest ? 'is-busiest' : ''} ${c.i === 0 ? 'is-today' : ''} ${c.count || c.exam ? '' : 'is-empty'}`}
              style={{ ['--bar' as string]: `${bar(c)}px`, ['--i' as string]: c.i }}
              aria-label={`${name(c)} ${c.d.getMonth() + 1}/${c.d.getDate()}：${what}${c.exam ? `；考试 ${c.exam.title}` : ''}`}
              onClick={() => document.getElementById(c.count ? `hw-${c.key}` : 'exams')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <span className="ruler-plot" aria-hidden="true">
                {c.exam ? <span className="seal seal-sm ruler-exam" style={{ ['--y' as string]: `${sealAt(c)}px` }}>考</span> : null}
                {c.key === busiest ? <span className="ruler-cap">{hoursText(c.minutes)}</span> : null}
                {c.count ? <span className="ruler-bar" /> : null}
                <span className="ruler-tip">
                  {c.count ? <><b>约 {hoursText(c.minutes)}</b> · {c.count} 项{c.exam ? <i>考试：{c.exam.title}</i> : null}</> : <><b>考试</b> · {c.exam?.title}</>}
                </span>
              </span>
              <span className="ruler-day" aria-hidden="true">{name(c)}</span>
              <span className="ruler-date" aria-hidden="true">{c.d.getMonth() + 1}/{c.d.getDate()}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/** The ticket's stub: "17 天后", or the word itself for the next three days. */
function TicketStub({ iso, now }: { iso: string; now: Date }) {
  const days = examDaysUntil(iso, now);
  return days >= 3
    ? <div className="ticket-stub"><span className="ticket-n">{days}</span><span className="ticket-u">天后</span></div>
    : <div className="ticket-stub is-word"><span className="ticket-w">{examCountdown(iso, now)}</span></div>;
}

function examWhen(e: TaskView) {
  const d = new Date(e.dueAt!);
  // "10/13 周二 18:30" holds together; with no time yet, the note goes on its own quiet line (never a line starting with "·")
  const date = <span className="nowrap">{d.getMonth() + 1}/{d.getDate()} {weekdayName(d)}</span>;
  return e.dueDateOnly ? <>{date}<span className="ticket-when-note">时间见大纲</span></> : <>{date} <span className="nowrap">{hhmm(d)}</span></>;
}

function ExamBand({ exams, now }: { exams: TaskView[]; now: Date }) {
  return (
    <section id="exams" className="exam-band" aria-label="考试">
      <div className="band-head">
        <span className="seal seal-sm">考</span>
        <h2>考试</h2>
        <span className="small muted">{exams.length ? `30 天内 ${exams.length} 场` : '30 天内没有考试'}</span>
        <Link to="/deadlines?kind=exam" className="small right">全部考试 →</Link>
      </div>
      {exams.length ? (
        <div className="tickets stagger">
          {exams.slice(0, EXAMS_SHOWN).map((e, i) => {
            const scope = examScope(e.syllabusNote);
            const body = (
              <>
                <TicketStub iso={e.dueAt!} now={now} />
                <div className="ticket-body">
                  <div className="ticket-title">{e.title}</div>
                  <div className="ticket-meta"><span className="course-chip"><i />{e.courseName}</span></div>
                  <div className="ticket-when figures">{examWhen(e)}</div>
                  {scope ? <div className="ticket-scope">范围：{scope}</div> : null}
                </div>
              </>
            );
            const props = { className: `ticket urg-${examUrgency(e.dueAt!, now)}`, style: { ['--c' as string]: e.color }, title: e.syllabusNote ?? undefined };
            return (
              <div key={e.id} className="ticket-slot" style={{ ['--i' as string]: i }}>
                {e.htmlUrl ? <ExtLink href={e.htmlUrl} {...props}>{body}</ExtLink> : <div {...props}>{body}</div>}
              </div>
            );
          })}
          {exams.length > EXAMS_SHOWN ? <Link to="/deadlines?kind=exam" className="ticket ticket-more">还有 {exams.length - EXAMS_SHOWN} 场 →</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

function Homework({ tasks, exams, now, undated }: { tasks: TaskView[]; exams: TaskView[]; now: Date; undated: number }) {
  const { overdue, days, done } = homeworkDays(tasks, now);
  return (
    <section className="hw" aria-label="要交的作业">
      <div className="band-head">
        <h2>要交的</h2>
        <span className="small muted">7 天内 · 不含考试</span>
        <Link to="/deadlines" className="small right">全部截止日期 →</Link>
      </div>
      <WeekRuler tasks={tasks} exams={exams} now={now} />
      {overdue.length ? (
        <div className="hw-day is-overdue">
          <div className="hw-day-head"><b>逾期 / 缺交</b><span className="small">{overdue.length} 项 · 还能补交的尽快补</span></div>
          <TaskList tasks={overdue} now={now} dense exitOnDone />
        </div>
      ) : null}
      {days.length === 0 && overdue.length === 0 ? <p className="muted hw-empty">7 天内没有要交的作业。</p> : null}
      {days.map((d) => (
        <div key={d.key} id={`hw-${d.key}`} className="hw-day">
          <div className="hw-day-head"><b>{d.label}</b><span className="small muted">{d.tasks.length} 项 · 约 {hoursText(d.minutes)}</span></div>
          <HomeworkList tasks={d.tasks} now={now} />
        </div>
      ))}
      {undated ? <p className="small hw-undated"><Link to="/deadlines">另有 {undated} 项没有截止日期 →</Link></p> : null}
      {done.length ? (
        <details className="hw-done">
          <summary>已完成 / 已过 {done.length} 项</summary>
          <TaskList tasks={done} now={now} dense />
        </details>
      ) : null}
    </section>
  );
}

/** A day's work with same-kind batches (a week's lecture videos) folded into one expandable row. */
function HomeworkList({ tasks, now }: { tasks: TaskView[]; now: Date }) {
  return (
    <div className="card tasks dense">
      {bundleTasks(tasks).map((e, i) => ('task' in e
        ? <TaskRow key={e.task.id} task={e.task} now={now} showDate={false} index={i} exitOnDone />
        : <BundleRow key={e.key} tasks={e.bundle} minutes={e.minutes} now={now} />))}
    </div>
  );
}

function BundleRow({ tasks, minutes, now }: { tasks: TaskView[]; minutes: number; now: Date }) {
  const first = tasks[0];
  const what = (first.category && CATEGORY_LABEL[first.category]) || KIND_LABEL[first.kind] || '项';
  const provider = providerNote(first.provider);
  const when = first.dueDateOnly ? '时间见大纲' : first.dueAt ? hhmm(new Date(first.dueAt)) : '';
  return (
    <details className="task-bundle" style={{ ['--c' as string]: first.color }}>
      <summary className="task">
        <span className="bundle-count">{tasks.length}</span>
        <div className="task-body">
          <div className="task-title">{tasks.length} 个{what}</div>
          <div className="task-meta">
            <span className="course-chip"><i />{first.courseName}</span>
            <span>约 {hoursText(minutes)}</span>
            {provider ? <span className="provider">{provider}</span> : null}
          </div>
        </div>
        <div className="task-side"><span className="due">{when}</span><span className="bundle-toggle small">展开</span></div>
      </summary>
      <div className="bundle-items"><TaskList tasks={tasks} now={now} showDate={false} dense exitOnDone /></div>
    </details>
  );
}

function DailyCard({ overview }: { overview: Overview }) {
  const r = overview.latestDaily;
  const isToday = !!r && r.period === dateKey(new Date());
  const gen = useReportGenerator('daily', refreshAll);
  return (
    <div className="card side-card">
      <div className="side-head"><h3>今日日报</h3>{isToday ? <Link to={`/reports/${r!.id}`} className="small right">查看 →</Link> : null}</div>
      {isToday ? (
        <>
          <p className="daily-headline">{r!.headline || '今天的日报已生成。'}</p>
          {r!.blocks.length ? (
            <ul className="plan-mini">
              {r!.blocks.map((b, i) => <li key={i}><span className="slot">{b.slot}</span><span className="grow">{b.title}</span><span className="figures small muted">{b.minutes} 分</span></li>)}
            </ul>
          ) : null}
        </>
      ) : (
        <>
          <p className="small muted side-text">每天 7:00 自动生成：今天要交什么、怎么安排时间。{r ? <> 上一份：<Link to={`/reports/${r.id}`}>{r.period}</Link></> : null}</p>
          <button type="button" className="btn btn-sm" disabled={gen.busy} onClick={() => void gen.start()}>
            {gen.busy ? <><span className="spinner" /> 正在生成…</> : '现在生成'}
          </button>
          <ErrorNote error={gen.error} />
        </>
      )}
    </div>
  );
}

function StudyCard({ study }: { study: Overview['study'] }) {
  if (study.length === 0) return null;
  return (
    <div className="card side-card">
      <div className="side-head"><h3>本周学习</h3><Link to="/study" className="small right">全部 →</Link></div>
      <ul className="study-mini">
        {study.map((s) => (
          <li key={s.courseId} style={{ ['--c' as string]: s.color }}>
            <Link to={`/study/${s.courseId}/${s.week}`}>
              <span className="course-chip"><i />{s.courseName}</span>
              <span className="small muted nowrap">第 {s.week} 周</span>
              <span className="grow ellipsis small">{s.topics.join(' · ') || s.title || ''}</span>
              {s.guide === 'ready' ? <span className="badge ok">讲解</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NoticesCard({ overview, now }: { overview: Overview; now: Date }) {
  return (
    <div className="card side-card">
      <div className="side-head"><h3>最新公告</h3></div>
      {overview.announcements.length === 0 ? <p className="small muted side-text">暂无公告</p> : (
        <ul className="notice-mini">
          {overview.announcements.slice(0, 5).map((a) => (
            <li key={a.id} style={{ ['--c' as string]: a.color }}>
              <Link to={`/courses/${a.courseId}/announcements`} className="notice-title ellipsis">{a.title}</Link>
              <span className="small muted nowrap"><span className="course-chip"><i />{a.courseName}</span> · {fmtRelative(a.postedAt, now)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Today() {
  const { data, error } = useApi<Overview>('/api/overview', { poll: 60_000 });
  const schools = useApi<SchoolView[]>('/api/schools');
  useDocumentTitle('今天');
  const now = new Date();
  const name = schools.data?.find((s) => s.user_name)?.user_name?.split(' ')[0] ?? '';
  const counts = data ? homeworkCounts(data.homework, now) : null;
  const lunar = lunarDate(now);

  return (
    <div className="page today">
      <header className="today-head">
        <div className="today-date">
          <span className="today-day">{now.getDate()}</span>
          <div className="today-lines">
            <div className="today-md">{zhMonth(now.getMonth() + 1)}<span className="sep" aria-hidden="true">·</span>{WEEK_ZH[now.getDay()]}</div>
            <div className="today-lunar">{lunar ? `农历 ${lunar}` : `${now.getFullYear()} 年`}</div>
            <div className="kicker">{greeting(now.getHours())}{name ? `，${name}` : ''}</div>
          </div>
        </div>
        {data && counts ? (
          <dl className="today-stats">
            <Stat n={counts.overdue} label="逾期 / 缺交" tone="bad" />
            <Stat n={counts.today} label="今天截止" tone="warn" />
            <Stat n={counts.next3} label="3 天内" />
            <Stat n={data.week.open} label="本周还剩" sub={data.week.minutes ? `约 ${hoursText(data.week.minutes)}` : undefined} />
          </dl>
        ) : null}
      </header>
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.schools.length === 0 ? (
        <div className="callout info">还没有添加学校。去 <Link to="/settings"><b>设置</b></Link> 添加学校并登录，几分钟后这里就会出现所有作业。</div>
      ) : (
        <>
          {data.loginNeeded.length ? (
            <div className="callout bad">
              <b>需要重新登录：</b>{data.loginNeeded.map((s) => s.name).join('、')}。期间截止日期由日历订阅兜底，提交状态可能不准。
              <Link to="/settings" className="btn btn-sm btn-seal right">去登录</Link>
            </div>
          ) : null}
          {data.platforms.filter((p) => !p.ok).map((p) => (
            <div key={`${p.courseId}:${p.platform}`} className="callout warn">
              <b>{p.courseName} 的 {p.platform} 作业{p.lastOkAt ? `暂时没读到（上次成功 ${fmtRelative(p.lastOkAt, now)}）` : '还没能读取'}：</b>{p.error ?? '原因不明'}。
              这期间请以 {p.platform} 为准。
              <ExtLink href={p.url} className="btn btn-sm right">打开 {p.platform}</ExtLink>
            </div>
          ))}
          <ExamBand exams={data.exams} now={now} />
          <div className="today-cols">
            <Homework tasks={data.homework} exams={data.exams} now={now} undated={data.undated ?? 0} />
            <aside className="today-aside">
              <DailyCard overview={data} />
              <StudyCard study={data.study} />
              <NoticesCard overview={data} now={now} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
