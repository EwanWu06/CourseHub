import { useMemo } from 'react';
import { dateKey, monthGrid } from '../lib/tasks.ts';
import type { TaskView } from '../types.ts';

const HEAD = ['一', '二', '三', '四', '五', '六', '日'];

export function MonthCalendar({ year, month, tasks, selected, onSelect }: { year: number; month: number; tasks: TaskView[]; selected: string | null; onSelect: (key: string) => void }) {
  const byDay = useMemo(() => {
    const m = new Map<string, TaskView[]>();
    for (const t of tasks) {
      if (!t.dueAt) continue;
      const k = dateKey(new Date(t.dueAt));
      m.set(k, [...(m.get(k) ?? []), t]);
    }
    return m;
  }, [tasks]);
  const today = dateKey(new Date());
  return (
    <div className="cal card" role="grid" aria-label={`${year} 年 ${month + 1} 月`}>
      {HEAD.map((h) => <div key={h} className="cal-h" role="columnheader">周{h}</div>)}
      {monthGrid(year, month).map((cell) => {
        const items = byDay.get(cell.date) ?? [];
        return (
          <button type="button" key={cell.date} role="gridcell" className={`cal-d ${cell.inMonth ? '' : 'out'} ${cell.date === today ? 'today' : ''} ${selected === cell.date ? 'sel' : ''}`}
            onClick={() => onSelect(cell.date)} aria-label={`${cell.date}，${items.length} 项`}>
            <span className="num">{cell.day}</span>
            {items.slice(0, 3).map((t) => (
              <span key={t.id} className={`pill ${t.status === 'done' ? 'done' : ''} ${t.status === 'overdue' || t.status === 'missing' ? 'hot' : ''}`} style={{ ['--c' as string]: t.color }}>{t.title}</span>
            ))}
            {items.length > 3 ? <span className="more">+{items.length - 3}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
