import type { ReactNode } from 'react';
import { Layout } from './components/Layout.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Settings } from './pages/Settings.tsx';
import { Today } from './pages/Today.tsx';
import { Deadlines } from './pages/Deadlines.tsx';
import { Courses } from './pages/Courses.tsx';
import { CourseDetail } from './pages/CourseDetail.tsx';
import { Inbox } from './pages/Inbox.tsx';
import { StudyCourse, StudyIndex } from './pages/Study.tsx';
import { StudyWeek } from './pages/StudyWeek.tsx';
import { matchRoute } from './route-match.ts';
import { useLocation } from './router.tsx';

type Route = { pattern: string; render: (p: Record<string, string>) => ReactNode };

const ROUTES: Route[] = [
  { pattern: '/', render: () => <Today /> },
  { pattern: '/deadlines', render: () => <Deadlines /> },
  { pattern: '/courses', render: () => <Courses /> },
  { pattern: '/courses/:id/:tab?/:sub?', render: (p) => <CourseDetail key={p.id} id={p.id} tab={p.tab} sub={p.sub} /> },
  { pattern: '/inbox', render: () => <Inbox /> },
  { pattern: '/study', render: () => <StudyIndex /> },
  { pattern: '/study/:courseId', render: (p) => <StudyCourse key={p.courseId} courseId={p.courseId} /> },
  { pattern: '/study/:courseId/:week', render: (p) => <StudyWeek key={`${p.courseId}#${p.week}`} courseId={p.courseId} week={Number(p.week)} /> },
  { pattern: '/reports', render: () => <Placeholder title="报告" kicker="Reports" /> },
  { pattern: '/reports/:id', render: () => <Placeholder title="报告" kicker="Report" /> },
  { pattern: '/settings', render: () => <Settings /> },
];

export function App() {
  const { path } = useLocation();
  let page: ReactNode = <Placeholder title="找不到这一页" kicker="404" />;
  for (const r of ROUTES) {
    const params = matchRoute(r.pattern, path);
    if (params) {
      page = r.render(params);
      break;
    }
  }
  return <Layout>{page}</Layout>;
}
