import type { ReactNode } from 'react';
import { Layout } from './components/Layout.tsx';
import { Placeholder } from './pages/Placeholder.tsx';
import { Settings } from './pages/Settings.tsx';
import { matchRoute } from './route-match.ts';
import { useLocation } from './router.tsx';

type Route = { pattern: string; render: (p: Record<string, string>) => ReactNode };

const ROUTES: Route[] = [
  { pattern: '/', render: () => <Placeholder title="今天" kicker="Today" /> },
  { pattern: '/deadlines', render: () => <Placeholder title="截止日期" kicker="Deadlines" /> },
  { pattern: '/courses', render: () => <Placeholder title="课程" kicker="Courses" /> },
  { pattern: '/courses/:id/:tab?/:sub?', render: () => <Placeholder title="课程" kicker="Course" /> },
  { pattern: '/study', render: () => <Placeholder title="学习" kicker="Study" /> },
  { pattern: '/study/:courseId/:week', render: () => <Placeholder title="学习" kicker="Study" /> },
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
