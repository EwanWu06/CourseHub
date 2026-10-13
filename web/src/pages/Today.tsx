import { refreshAll, useApi } from '../api.ts';
import { dateKey } from '../lib/tasks.ts';
import { useReportGenerator } from '../lib/useReportGenerator.ts';
import { fmtDue, fmtRelative } from '../format.ts';
import { TaskList } from '../components/TaskRow.tsx';
import { ErrorNote, ExtLink, Section, Spinner } from '../components/ui.tsx';
import { Link } from '../router.tsx';
import type { Overview, SchoolView } from '../types.ts';

const MONTHS_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEK_ZH = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

function greeting(h: number): string {
  if (h < 5) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
}

function DailyCard({ overview }: { overview: Overview }) {
  const r = overview.latestDaily;
  const today = dateKey(new Date());
  const gen = useReportGenerator('daily', refreshAll);
  return (
    <div className="card card-pad">
      <div className="kicker">Daily brief</div>
      <h3 style={{ fontFamily: 'var(--font-zh)', fontSize: 18, margin: '2px 0 8px' }}>今日日报</h3>
      {r && r.period === today ? (
        <>
          <p style={{ margin: 0 }}>{r.headline || '今天的日报已生成。'}</p>
          <Link to={`/reports/${r.id}`} className="btn btn-sm" style={{ marginTop: 12 }}>查看日报</Link>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>日报每天早上 7:00 自动生成：今天要交什么、怎么安排时间。{r ? <> 上一份：<Link to={`/reports/${r.id}`}>{r.period}</Link></> : null}</p>
          <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} disabled={gen.busy} onClick={() => void gen.start()}>
            {gen.busy ? <><span className="spinner" /> 正在生成…</> : '现在生成'}
          </button>
          <ErrorNote error={gen.error} />
        </>
      )}
    </div>
  );
}

export function Today() {
  const { data, error } = useApi<Overview>('/api/overview', { poll: 60_000 });
  const schools = useApi<SchoolView[]>('/api/schools');
  const now = new Date();
  const name = schools.data?.find((s) => s.user_name)?.user_name?.split(' ')[0] ?? '';

  return (
    <div className="page">
      <header className="masthead">
        <div className="dateline">
          <span className="day">{now.getDate()}</span>
          <div>
            <div className="md">{MONTHS_ZH[now.getMonth()]} · {WEEK_ZH[now.getDay()]}</div>
            <div className="kicker">{now.getFullYear()} · {greeting(now.getHours())}{name ? `，${name}` : ''}</div>
          </div>
        </div>
        {data ? (
          <div className="stats">
            <div className="stat is-seal"><div className="n">{data.counts.overdue}</div><div className="l">逾期 / 缺交</div></div>
            <div className="stat is-amber"><div className="n">{data.counts.today}</div><div className="l">今天截止</div></div>
            <div className="stat"><div className="n">{data.counts.next3}</div><div className="l">接下来 3 天</div></div>
          </div>
        ) : null}
      </header>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.schools.length === 0 ? (
        <div className="callout info">还没有添加学校。去 <Link to="/settings"><b>设置</b></Link> 添加学校并登录，几分钟后这里就会出现所有作业。</div>
      ) : (
        <div className="today-grid">
          <div>
            {data.loginNeeded.length ? (
              <div className="callout bad" style={{ marginBottom: 18 }}>
                <b>需要重新登录：</b>{data.loginNeeded.map((s) => s.name).join('、')}。期间截止日期由日历订阅兜底，提交状态可能不准。
                <Link to="/settings" className="btn btn-sm btn-seal right">去登录</Link>
              </div>
            ) : null}
            {data.overdue.length ? (
              <Section title="逾期 / 缺交" note="还能补交的尽快补">
                <TaskList tasks={data.overdue} now={now} />
              </Section>
            ) : null}
            <Section title="今天" note={data.today.length ? `${data.today.length} 项` : undefined}>
              <TaskList tasks={data.today} now={now} showDate={false} empty="今天没有截止的作业。" />
            </Section>
            <Section title="接下来 3 天" note={<Link to="/deadlines">全部截止日期 →</Link>}>
              <TaskList tasks={data.next3} now={now} empty="接下来 3 天没有截止的作业。" />
            </Section>
          </div>
          <aside className="today-side">
            {data.exams.length ? (
              <div className="card card-pad exam-card">
                <div className="kicker">Exams ahead</div>
                <h3 style={{ fontFamily: 'var(--font-zh)', fontSize: 18, margin: '2px 0 10px' }}>近期考试</h3>
                <ul className="notice-list">
                  {data.exams.map((e) => (
                    <li key={e.id} style={{ ['--c' as string]: e.color }}>
                      <span className="notice-title">{e.title}</span>
                      <div className="small"><span className="course-chip"><i />{e.courseName}</span> · <span className="mono">{fmtDue(e.dueAt, now, { dateOnly: e.dueDateOnly })}</span></div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <DailyCard overview={data} />
            <div className="card card-pad">
              <div className="kicker">Notices</div>
              <h3 style={{ fontFamily: 'var(--font-zh)', fontSize: 18, margin: '2px 0 10px' }}>最新公告</h3>
              {data.announcements.length === 0 ? <p className="muted small" style={{ margin: 0 }}>暂无公告</p> : (
                <ul className="notice-list">
                  {data.announcements.slice(0, 6).map((a) => (
                    <li key={a.id} style={{ ['--c' as string]: a.color }}>
                      <Link to={`/courses/${a.courseId}/announcements`} className="notice-title">{a.title}</Link>
                      <div className="small muted"><span className="course-chip"><i />{a.courseName}</span> · {fmtRelative(a.postedAt, now)} · <ExtLink href={a.htmlUrl}>Canvas</ExtLink></div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
