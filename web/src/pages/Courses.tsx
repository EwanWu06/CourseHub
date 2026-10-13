import { useApi } from '../api.ts';
import { fmtCountdown, fmtDue } from '../format.ts';
import { Empty, ErrorNote, Masthead, Spinner } from '../components/ui.tsx';
import { Link, navigate } from '../router.tsx';
import type { CourseCard } from '../types.ts';

export function Courses() {
  const { data, error } = useApi<CourseCard[]>('/api/courses');
  const now = new Date();
  const bySchool = new Map<string, CourseCard[]>();
  for (const c of data ?? []) {
    const key = c.school?.name ?? '';
    bySchool.set(key, [...(bySchool.get(key) ?? []), c]);
  }
  return (
    <div className="page">
      <Masthead kicker="Courses" title="课程" aside={<Link to="/inbox" className="btn btn-sm">收件箱</Link>} />
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.length === 0 ? <Empty glyph="课">还没有课程。去「设置」添加学校并登录。</Empty> : (
        [...bySchool.entries()].map(([school, cards]) => (
          <section key={school} className="section">
            <div className="section-head">
              <span className="dot-lg" style={{ background: cards[0].school?.color }} />
              <h2>{school}</h2>
              <span className="note">{cards.length} 门课</span>
            </div>
            <div className="course-grid stagger">
              {cards.map((c, i) => {
                const color = c.course.color ?? c.school?.color ?? '#888';
                const due = c.nextDue;
                return (
                  <article key={c.course.id} className="course-card card" style={{ ['--c' as string]: color, ['--i' as string]: i }}
                    onClick={() => navigate(`/courses/${c.course.id}`)} role="link" tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && navigate(`/courses/${c.course.id}`)}>
                    <div className="course-band" />
                    <div className="card-pad">
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <div className="grow">
                          <h3 className="course-name">{c.course.display_name}</h3>
                          <div className="small muted course-full">{c.course.name}</div>
                        </div>
                        {c.score !== null ? (
                          <div className="score">
                            <div className="n">{c.grade ?? Math.round(c.score)}</div>
                            <div className="l">{c.score.toFixed(1)}%</div>
                          </div>
                        ) : null}
                      </div>
                      <hr className="divider" />
                      {due ? (
                        <div className="next-due">
                          <div className="small muted">下一项</div>
                          <div className="next-title">{due.title}</div>
                          <div className="small"><span className="mono">{fmtDue(due.dueAt, now, { dateOnly: due.dueDateOnly })}</span>{!due.dueDateOnly && fmtCountdown(due.dueAt, now) ? <span className="hot"> · {fmtCountdown(due.dueAt, now)}</span> : null}</div>
                        </div>
                      ) : <div className="small muted">近期没有要交的</div>}
                      <div className="row small muted" style={{ marginTop: 12 }}>
                        {c.course.term_name ? <span>{c.course.term_name}</span> : null}
                        {c.newAnnouncements ? <span className="badge warn">{c.newAnnouncements} 条新公告</span> : null}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
