import { api, useApi } from '../api.ts';
import { fmtRelative } from '../format.ts';
import { Empty, ErrorNote, Masthead, Spinner } from '../components/ui.tsx';
import { periodLabel } from '../lib/reports.ts';
import { useReportGenerator } from '../lib/useReportGenerator.ts';
import { Link, navigate, useLocation } from '../router.tsx';
import type { ReportListItem } from '../types.ts';

export function Reports() {
  const { query } = useLocation();
  const type = query.get('type') === 'weekly' ? 'weekly' : 'daily';
  const { data, error, reload } = useApi<ReportListItem[]>(`/api/reports?type=${type}`);
  const gen = useReportGenerator(type, () => {
    reload();
    void api<ReportListItem[]>(`/api/reports?type=${type}`).then((list) => { if (list[0]) navigate(`/reports/${list[0].id}`); });
  });
  const label = type === 'daily' ? '日报' : '周报';

  return (
    <div className="page">
      <Masthead
        kicker="Reports"
        title="报告"
        aside={
          <button type="button" className="btn btn-primary" disabled={gen.busy} onClick={() => void gen.start()}>
            {gen.busy ? <><span className="spinner" /> 正在生成{label}…</> : type === 'daily' ? '生成今天的日报' : '生成周报'}
          </button>
        }
      />
      <div className="toolbar">
        <div className="seg" role="group" aria-label="报告类型">
          <button type="button" aria-pressed={type === 'daily'} onClick={() => navigate('/reports')}>日报</button>
          <button type="button" aria-pressed={type === 'weekly'} onClick={() => navigate('/reports?type=weekly')}>周报</button>
        </div>
        <span className="small muted">{type === 'daily' ? '每天早上 7:00 自动生成' : '每周日 20:00 自动生成，看下一周'}</span>
      </div>
      <ErrorNote error={error ?? gen.error} />
      {!data ? <Spinner /> : data.length === 0 ? (
        <Empty glyph={type === 'daily' ? '日' : '周'}>还没有{label}。{type === 'daily' ? '明早 7:00 会自动生成，也可以现在点右上角生成。' : '周日晚上会自动生成，也可以现在生成。'}</Empty>
      ) : (
        <ol className="report-index stagger">
          {data.map((r, i) => (
            <li key={r.id} style={{ ['--i' as string]: i }}>
              <Link to={`/reports/${r.id}`} className="report-entry">
                <span className="report-date">{periodLabel(r.type, r.period)}</span>
                <span className="report-headline">{r.headline}</span>
                <span className="small muted">{fmtRelative(r.createdAt)}生成{r.aiError ? ' · 没有 AI 安排' : ''}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
