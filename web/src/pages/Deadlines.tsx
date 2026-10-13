import { useMemo, useState } from 'react';
import { useApi } from '../api.ts';
import { useLocation } from '../router.tsx';
import { AddTask } from '../components/AddTask.tsx';
import { MonthCalendar } from '../components/MonthCalendar.tsx';
import { TaskList } from '../components/TaskRow.tsx';
import { Empty, ErrorNote, Masthead, Section, Spinner } from '../components/ui.tsx';
import { fmtDate } from '../format.ts';
import { dateKey, groupByDay } from '../lib/tasks.ts';
import type { CourseCard, SchoolView, TaskView } from '../types.ts';

const KINDS: { id: string; label: string; match: (t: TaskView) => boolean }[] = [
  { id: 'all', label: '全部类型', match: () => true },
  { id: 'assignment', label: '作业', match: (t) => t.kind === 'assignment' },
  { id: 'quiz', label: '测验', match: (t) => t.kind === 'quiz' },
  { id: 'discussion', label: '讨论', match: (t) => t.kind === 'discussion' },
  { id: 'event', label: '日程 / 考试', match: (t) => t.kind === 'event' },
  { id: 'manual', label: '手动添加', match: (t) => t.kind === 'manual' },
  { id: 'other', label: '阅读 / 备忘', match: (t) => t.kind === 'page' || t.kind === 'note' },
];

const DAY = 86_400_000;

export function Deadlines() {
  const now = new Date();
  const range = useMemo(() => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 21);
    return { from: start.toISOString(), to: new Date(start.getTime() + 160 * DAY).toISOString() };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const items = useApi<TaskView[]>(`/api/items?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&includeDone=1`);
  const undated = useApi<TaskView[]>('/api/items/undated');
  const courses = useApi<CourseCard[]>('/api/courses');
  const schools = useApi<SchoolView[]>('/api/schools');
  const { query } = useLocation();
  const [view, setView] = useState<'list' | 'month'>(query.get('view') === 'month' ? 'month' : 'list');
  const [school, setSchool] = useState('');
  const [course, setCourse] = useState('');
  const [kind, setKind] = useState('all');
  const [showDone, setShowDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const [selected, setSelected] = useState<string | null>(dateKey(now));

  const matcher = KINDS.find((k) => k.id === kind)!.match;
  const filter = (t: TaskView) => (!school || t.schoolId === school) && (!course || t.courseId === course) && matcher(t);
  const all = (items.data ?? []).filter(filter);
  const todayKey = dateKey(now);
  const visible = all.filter((t) => {
    if (showDone) return true;
    if (t.status === 'done') return false;
    const past = dateKey(new Date(t.dueAt!)) < todayKey;
    return !past || t.status === 'overdue' || t.status === 'missing';
  });
  const groups = groupByDay(visible, now);
  const selectedTasks = selected ? all.filter((t) => t.dueAt && dateKey(new Date(t.dueAt)) === selected) : [];
  const courseOptions = (courses.data ?? []).filter((c) => !school || c.course.school_id === school);
  const undatedList = (undated.data ?? []).filter(filter);

  return (
    <div className="page">
      <Masthead kicker="Deadlines" title="截止日期" aside={<button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>+ 手动添加任务</button>} />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="视图">
          <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}>列表</button>
          <button type="button" aria-pressed={view === 'month'} onClick={() => setView('month')}>月历</button>
        </div>
        <select className="select" value={school} onChange={(e) => { setSchool(e.target.value); setCourse(''); }} aria-label="学校">
          <option value="">全部学校</option>
          {(schools.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select className="select" value={course} onChange={(e) => setCourse(e.target.value)} aria-label="课程">
          <option value="">全部课程</option>
          {courseOptions.map((c) => <option key={c.course.id} value={c.course.id}>{c.course.nickname || c.course.code || c.course.name}</option>)}
        </select>
        <select className="select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="类型">
          {KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
        </select>
        <label className="row small"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 显示已完成 / 已过</label>
      </div>
      <ErrorNote error={items.error} />
      {!items.data ? <Spinner /> : view === 'list' ? (
        groups.length === 0 ? <Empty glyph="闲">这段时间没有符合条件的截止日期。</Empty> : (
          <div className="day-groups">
            {groups.map((g) => (
              <section key={g.key} className={`day ${g.key < todayKey ? 'past' : ''}`}>
                <div className="day-head">
                  {g.rel ? <span className="rel">{g.rel}</span> : null}
                  <span className="date">{g.date}</span>
                  <span className="n">{g.tasks.length} 项</span>
                </div>
                <TaskList tasks={g.tasks} now={now} showDate={false} />
              </section>
            ))}
          </div>
        )
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-sm" onClick={() => setCursor(({ y, m }) => (m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }))}>‹ 上个月</button>
            <h2 style={{ fontFamily: 'var(--font-zh)', fontSize: 20, margin: '0 8px' }}>{cursor.y} 年 {cursor.m + 1} 月</h2>
            <button type="button" className="btn btn-sm" onClick={() => setCursor(({ y, m }) => (m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }))}>下个月 ›</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(todayKey); }}>回到今天</button>
          </div>
          <MonthCalendar year={cursor.y} month={cursor.m} tasks={showDone ? all : all.filter((t) => t.status !== 'done')} selected={selected} onSelect={setSelected} />
          {selected ? (
            <Section title={fmtDate(new Date(`${selected}T12:00:00`), now)} note={`${selectedTasks.length} 项`}>
              <TaskList tasks={selectedTasks} now={now} showDate={false} empty="这一天没有截止的作业。" />
            </Section>
          ) : null}
        </>
      )}
      {undatedList.length ? (
        <Section title="无截止日期" note="老师没设截止时间，但需要完成">
          <TaskList tasks={undatedList} now={now} />
        </Section>
      ) : null}
      <AddTask open={adding} onClose={() => setAdding(false)} courses={courses.data ?? []} />
    </div>
  );
}
