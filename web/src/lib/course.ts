// Pure helpers for the course pages.

export function moduleWeekLabel(m: { week_start: number | null; week_end: number | null }): string | null {
  if (m.week_start === null) return null;
  return m.week_end && m.week_end !== m.week_start ? `第 ${m.week_start}–${m.week_end} 周` : `第 ${m.week_start} 周`;
}

export function fileStatus(status: string, error: string | null): { label: string; tone?: 'ok' | 'warn' | 'bad' } {
  switch (status) {
    case 'ok': return { label: '已读取文字', tone: 'ok' };
    case 'empty': return { label: '扫描版 / 无文字', tone: 'warn' };
    case 'pending': return { label: error ? '暂未开放' : '等待读取', tone: undefined };
    case 'unsupported': return { label: '不支持', tone: undefined };
    case 'skipped': return { label: '太大，跳过', tone: undefined };
    default: return { label: '读取失败', tone: 'bad' };
  }
}

const ICONS: Record<string, string> = {
  File: '📄', Page: '📃', Assignment: '✍️', Quiz: '❓', Discussion: '💬', ExternalUrl: '🔗', ExternalTool: '🧩', SubHeader: '§',
};

export function itemTypeIcon(type: string): string {
  return ICONS[type] ?? '•';
}
