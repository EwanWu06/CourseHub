import { useEffect, useState } from 'react';
import { api, refreshAll } from '../api.ts';
import { fmtCountdown, fmtDue } from '../format.ts';
import { KIND_LABEL, STATUS_LABEL, providerNote, sealFor } from '../lib/tasks.ts';
import { Link } from '../router.tsx';
import type { TaskView } from '../types.ts';
import { Icon } from './Icon.tsx';

function countdownTone(t: TaskView, now: Date): string {
  if (t.status === 'overdue' || t.status === 'missing') return 'hot';
  if (!t.dueAt || t.status !== 'todo') return '';
  const h = (Date.parse(t.dueAt) - now.getTime()) / 3_600_000;
  return h < 24 ? 'hot' : h < 48 ? 'warm' : '';
}

export function TaskRow({ task, now = new Date(), showDate = true, index = 0 }: { task: TaskView; now?: Date; showDate?: boolean; index?: number }) {
  const [localDone, setLocalDone] = useState(task.localDone);
  useEffect(() => setLocalDone(task.localDone), [task.localDone]);
  const doneElsewhere = task.status === 'done' && !task.localDone;
  const done = doneElsewhere || localDone;
  const isEvent = task.kind === 'event';
  const seal = done ? null : sealFor(task, now);
  const countdown = done || isEvent ? null : fmtCountdown(task.dueAt, now);
  const note = providerNote(task.provider);

  const toggle = async () => {
    const next = !localDone;
    setLocalDone(next);
    try {
      await api(`/api/items/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { localDone: next } });
      refreshAll();
    } catch {
      setLocalDone(!next);
    }
  };

  return (
    <div className={`task ${done ? 'is-done' : ''}`} style={{ ['--c' as string]: task.color, ['--i' as string]: index }}>
      {isEvent ? (
        <span className="check event" aria-hidden="true">◆</span>
      ) : (
        <button type="button" className="check" role="checkbox" aria-checked={done} disabled={doneElsewhere}
          title={doneElsewhere ? '已在 Canvas 完成' : done ? '标记为未完成' : '在本地标记为已完成（不影响 Canvas）'} onClick={toggle}>
          <Icon name="check" size={13} />
        </button>
      )}
      <div className="task-body">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          {task.courseName ? (
            <Link to={`/courses/${task.courseId}`} className="course-chip"><i />{task.courseName}</Link>
          ) : task.schoolName ? <span className="course-chip"><i />{task.schoolName}</span> : null}
          <span>{KIND_LABEL[task.kind]}</span>
          {task.points ? <span className="mono">{task.points} 分</span> : null}
          {note ? <span className="provider">{note}</span> : null}
          {task.source === 'ics' ? <span title="登录过期期间来自日历订阅，提交状态未知">日历订阅</span> : null}
        </div>
      </div>
      <div className="task-side">
        <div className="due-box">
          {showDate ? <div className="due">{fmtDue(task.dueAt, now)}</div> : <div className="due">{task.dueAt ? fmtDue(task.dueAt, now).split(' ').at(-1) : ''}</div>}
          {countdown ? <div className={`countdown ${countdownTone(task, now)}`}>{countdown}</div> : done ? <div className="countdown done-label">{STATUS_LABEL.done}</div> : task.status === 'past' ? <div className="countdown">{task.source === 'ics' ? '状态未知' : STATUS_LABEL.past}</div> : null}
        </div>
        {seal ? <span className="seal" title={STATUS_LABEL[task.status]}>{seal}</span> : null}
        {task.htmlUrl ? (
          <a className="btn btn-sm btn-ghost open" href={task.htmlUrl} target="_blank" rel="noopener noreferrer" title="在 Canvas 打开">
            <Icon name="external" size={14} />
          </a>
        ) : null}
      </div>
    </div>
  );
}

export function TaskList({ tasks, now, showDate = true, empty }: { tasks: TaskView[]; now?: Date; showDate?: boolean; empty?: string }) {
  if (tasks.length === 0) return empty ? <p className="muted small" style={{ margin: '4px 0 0' }}>{empty}</p> : null;
  return (
    <div className="card tasks stagger">
      {tasks.map((t, i) => <TaskRow key={t.id} task={t} now={now} showDate={showDate} index={i} />)}
    </div>
  );
}
