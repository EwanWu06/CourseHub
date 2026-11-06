import { useApi } from '../api.ts';
import { fmtDate, fmtRelative } from '../format.ts';
import { Empty, ErrorNote, Masthead, Loading } from '../components/ui.tsx';
import { Link } from '../router.tsx';
import type { GuideBrief, StudyCourse, StudyCourseDetail } from '../types.ts';

export function guideLabel(g: GuideBrief | null, materials: number): { text: string; tone: string } {
  if (!g) return materials ? { text: '未生成', tone: '' } : { text: '暂无资料', tone: 'muted' };
  if (g.status === 'ready') return g.stale ? { text: '有新资料', tone: 'warn' } : { text: '已生成', tone: 'ok' };
  if (g.status === 'running') return { text: '生成中…', tone: 'warn' };
  if (g.status === 'queued') return { text: '排队中', tone: '' };
  return { text: '生成失败', tone: 'bad' };
}

/** The term as a ruler of weeks: those behind in the course's pigment, this week in cinnabar, the rest still blank. */
function TermRuler({ weeks, current }: { weeks: number; current: number }) {
  return (
    <div className="term-ruler" style={{ ['--n' as string]: weeks }} aria-hidden="true">
      {Array.from({ length: weeks }, (_, k) => <i key={k} className={k + 1 < current ? 'is-past' : k + 1 === current ? 'is-now' : ''} />)}
    </div>
  );
}

export function StudyIndex() {
  const { data, error } = useApi<StudyCourse[]>('/api/study');
  return (
    <div className="page">
      <Masthead kicker="Study" title="学习" aside={<span className="small">每门课按周讲解：要学什么、要掌握什么</span>} />
      <ErrorNote error={error} />
      {!data ? <Loading /> : data.length === 0 ? <Empty glyph="学">还没有课程。</Empty> : (
        <div className="course-grid stagger">
          {data.map((c, i) => (
            <Link key={c.course.id} to={`/study/${c.course.id}`} className="card study-card" style={{ ['--c' as string]: c.course.color ?? c.school?.color ?? '#888', ['--i' as string]: i }}>
              <div className="course-band" />
              <div className="card-pad">
                <h3 className="course-name">{c.course.display_name}</h3>
                <div className="small muted">{c.school?.name}</div>
                <div className="study-meta">
                  <span className="big-week">{c.currentWeek && c.currentWeek > 0 ? `第 ${c.currentWeek} 周` : '—'}</span>
                  <span className="small muted">{c.lastWeek ? `共 ${c.lastWeek} 周 · ` : ''}已生成 {c.ready} 周讲解</span>
                </div>
                {c.lastWeek ? <TermRuler weeks={c.lastWeek} current={c.currentWeek ?? 0} /> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function StudyCourse({ courseId }: { courseId: string }) {
  const { data, error } = useApi<StudyCourseDetail>(`/api/study/${encodeURIComponent(courseId)}`, { poll: 15_000 });
  if (error) return <div className="page"><ErrorNote error={error} /></div>;
  if (!data) return <div className="page"><Loading /></div>;
  const color = data.course.color ?? data.school?.color ?? '#888';
  return (
    <div className="page" style={{ ['--c' as string]: color }}>
      <Masthead kicker={<><Link to="/study">学习</Link> · {data.course.display_name}</>} title={`${data.course.display_name} · 每周讲解`} aside={<Link to={`/courses/${courseId}`} className="btn btn-sm">课程主页</Link>} />
      {data.weeks.length === 0 ? <Empty glyph="周">还没算出这门课的周次（同步后会自动计算）。</Empty> : (
        <div className="week-grid stagger">
          {data.weeks.map((w, i) => {
            const label = guideLabel(w.guide, w.materialCount);
            const current = w.week === data.currentWeek;
            return (
              <Link key={w.week} to={`/study/${courseId}/${w.week}`} className={`card week-card ${current ? 'is-current' : ''} ${w.materialCount ? '' : 'is-empty'}`} style={{ ['--i' as string]: i }}>
                <div className="row">
                  <span className="week-no">第 {w.week} 周</span>
                  {current ? <span className="seal" style={{ fontSize: 12, minWidth: 26, height: 26 }}>本</span> : null}
                  <span className={`badge ${label.tone} right`}>{label.text}</span>
                </div>
                <div className="small muted">{w.startDate ? fmtDate(new Date(`${w.startDate}T12:00:00`)) : ''} 起</div>
                {w.topics.length ? <div className="topics">{w.topics.slice(0, 4).map((t) => <span key={t} className="topic">{t}</span>)}</div>
                  : w.title ? <div className="small week-title">{w.title}</div> : null}
                <div className="small muted" style={{ marginTop: 'auto' }}>{w.materialCount} 份资料{w.guide?.generatedAt ? ` · ${fmtRelative(w.guide.generatedAt)}生成` : ''}</div>
              </Link>
            );
          })}
        </div>
      )}
      {data.undatedModules.length ? (
        <section className="section">
          <div className="section-head"><h2>未分周的模块</h2><span className="note">这些模块没法确定属于哪一周</span></div>
          <div className="card list">{data.undatedModules.map((m) => <div key={m.id} className="list-row">{m.name}</div>)}</div>
        </section>
      ) : null}
    </div>
  );
}
