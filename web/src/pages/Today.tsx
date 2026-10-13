import { refreshAll, useApi } from '../api.ts';
import { fmtRelative, hhmm, weekdayName } from '../format.ts';
import { TaskList, TaskRow } from '../components/TaskRow.tsx';
import { ErrorNote, ExtLink, Spinner } from '../components/ui.tsx';
import { hoursText } from '../lib/reports.ts';
import { CATEGORY_LABEL, KIND_LABEL, dateKey, providerNote } from '../lib/tasks.ts';
import { bundleTasks, examCountdown, examScope, examUrgency, homeworkCounts, homeworkDays } from '../lib/today.ts';
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

function Count({ n, label, tone }: { n: number | string; label: string; tone?: 'bad' | 'warn' }) {
  return <span className={`tcount ${tone && n ? `is-${tone}` : ''}`}><b>{n}</b>{label}</span>;
}

function examWhen(e: TaskView) {
  const d = new Date(e.dueAt!);
  // two unbreakable halves: "10/13 周二" and "时间见大纲" / "18:30" wrap as wholes on narrow cards
  return <><span className="nowrap">{d.getMonth() + 1}/{d.getDate()} {weekdayName(d)}</span> <span className="nowrap">{e.dueDateOnly ? '· 时间见大纲' : hhmm(d)}</span></>;
}

function ExamBand({ exams, now }: { exams: TaskView[]; now: Date }) {
  return (
    <section className="exam-band" aria-label="考试">
      <div className="band-head">
        <span className="seal seal-sm">考</span>
        <h2>考试</h2>
        <span className="small muted">{exams.length ? `30 天内 ${exams.length} 场` : '30 天内没有考试'}</span>
        <Link to="/deadlines?kind=exam" className="small right">全部考试 →</Link>
      </div>
      {exams.length ? (
        <div className="exam-cards">
          {exams.slice(0, EXAMS_SHOWN).map((e) => {
            const scope = examScope(e.syllabusNote);
            const body = (
              <>
                <div className="exam-count">{examCountdown(e.dueAt!, now)}</div>
                <div className="exam-title">{e.title}</div>
                <div className="exam-meta"><span className="course-chip"><i />{e.courseName}</span></div>
                <div className="exam-when mono">{examWhen(e)}</div>
                {scope ? <div className="exam-scope">范围：{scope}</div> : null}
              </>
            );
            const props = { className: `exam-card urg-${examUrgency(e.dueAt!, now)}`, style: { ['--c' as string]: e.color }, title: e.syllabusNote ?? undefined };
            return e.htmlUrl ? <ExtLink key={e.id} href={e.htmlUrl} {...props}>{body}</ExtLink> : <div key={e.id} {...props}>{body}</div>;
          })}
          {exams.length > EXAMS_SHOWN ? <Link to="/deadlines?kind=exam" className="exam-card exam-more">还有 {exams.length - EXAMS_SHOWN} 场 →</Link> : null}
        </div>
      ) : null}
    </section>
  );
}

function Homework({ tasks, now, undated }: { tasks: TaskView[]; now: Date; undated: number }) {
  const { overdue, days, done } = homeworkDays(tasks, now);
  return (
    <section className="hw" aria-label="要交的作业">
      <div className="band-head">
        <h2>要交的</h2>
        <span className="small muted">7 天内 · 不含考试</span>
        <Link to="/deadlines" className="small right">全部截止日期 →</Link>
      </div>
      {overdue.length ? (
        <div className="hw-day is-overdue">
          <div className="hw-day-head"><b>逾期 / 缺交</b><span className="small">{overdue.length} 项 · 还能补交的尽快补</span></div>
          <TaskList tasks={overdue} now={now} dense />
        </div>
      ) : null}
      {days.length === 0 && overdue.length === 0 ? <p className="muted hw-empty">7 天内没有要交的作业。</p> : null}
      {days.map((d) => (
        <div key={d.key} className="hw-day">
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
        ? <TaskRow key={e.task.id} task={e.task} now={now} showDate={false} index={i} />
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
      <div className="bundle-items"><TaskList tasks={tasks} now={now} showDate={false} dense /></div>
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
              {r!.blocks.map((b, i) => <li key={i}><span className="slot">{b.slot}</span><span className="grow">{b.title}</span><span className="mono small muted">{b.minutes} 分</span></li>)}
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
  const now = new Date();
  const name = schools.data?.find((s) => s.user_name)?.user_name?.split(' ')[0] ?? '';
  const counts = data ? homeworkCounts(data.homework, now) : null;

  return (
    <div className="page today">
      <header className="today-head">
        <div className="today-date">
          <span className="today-day">{now.getDate()}</span>
          <div>
            <div className="today-md">{now.getMonth() + 1} 月 · {WEEK_ZH[now.getDay()]}</div>
            <div className="kicker">{now.getFullYear()} · {greeting(now.getHours())}{name ? `，${name}` : ''}</div>
          </div>
        </div>
        {data && counts ? (
          <div className="today-counts">
            <Count n={counts.overdue} label="逾期 / 缺交" tone="bad" />
            <Count n={counts.today} label="今天截止" tone="warn" />
            <Count n={counts.next3} label="3 天内" />
            <Count n={data.week.open} label={`本周剩${data.week.minutes ? ` · 约 ${hoursText(data.week.minutes)}` : ''}`} />
          </div>
        ) : null}
      </header>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.schools.length === 0 ? (
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
            <Homework tasks={data.homework} now={now} undated={data.undated ?? 0} />
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
