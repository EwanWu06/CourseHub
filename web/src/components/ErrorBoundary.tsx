// One page crashing while it renders must not blank the whole app: the page shows what happened and how to get
// back, the rest keeps working, and the error is sent to the server log (listed on the status page).
import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'X-CourseHub': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: error.message, path: location.pathname, stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}` }),
    }).catch(() => undefined);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="callout bad">
          <div>
            <b>这一页出了点问题，其他页面不受影响。</b>
            <p className="small">错误已经记在系统状态里：{this.state.error.message}</p>
            <p>
              <button type="button" className="btn btn-sm" onClick={() => this.setState({ error: null })}>再试一次</button>{' '}
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => location.reload()}>刷新整个页面</button>{' '}
              <a className="btn btn-sm btn-ghost" href="/">回到今天</a>
            </p>
          </div>
        </div>
      </div>
    );
  }
}
