import { useEffect, useState } from 'react';
import { api, refreshAll } from '../api.ts';
import { fmtCountdown, fmtDue } from '../format.ts';
import { CATEGORY_LABEL, KIND_LABEL, STATUS_LABEL, providerNote, reqChips, sealFor } from '../lib/tasks.ts';
import { Link } from '../router.tsx';
import type { TaskView } from '../types.ts';
import { Icon } from './Icon.tsx';

function countdownTone(t: TaskView, now: Date): string {
  if (t.status === 'overdue' || t.status === 'missing') return 'hot';
  if (!t.dueAt || t.status !== 'todo') return '';
  const h = (Date.parse(t.dueAt) - now.getTime()) / 3_600_000;
  return h < 24 ? 'hot' : h < 48 ? 'warm' : '';
}

/** What full credit takes and how far along it is ("首帖 ✓ · 回复 1/2"), plus rules worth knowing (one attempt, PDF only…). */
function Requirements({ task }: { task: TaskView }) {
  const chips = reqChips(task);
  const notes = task.requirements?.notes ?? [];
  if (!chips.length && !notes.length) return null;
  return (
    <div className="task-reqs">
      {chips.map((c, i) => <span key={i} className={`req is-${c.tone}`} title={c.title}>{c.text}</span>)}
      {notes.map((n, i) => <span key={`n${i}`} className="req-note" title={n.quote ? `原文：${n.quote}` : undefined}>{n.text}</span>)}
    </div>
  );
}

function CategoryChip({ task }: { task: TaskView }) {
  const [cat, setCat] = useState(task.category);
  useEffect(() => setCat(task.category), [task.category]);
  const change = async (value: string) => {
    const next = value === 'auto' ? null : value;
    try {
      const t = await api<TaskView>(`/api/items/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { category: next } });
      setCat(t.category);
      refreshAll();
    } catch {
      setCat(task.category);
    }
  };
  const user = task.categorySource === 'user';
  return (
    <label className={`cat-chip ${cat === 'exam' ? 'is-exam' : ''} ${user ? 'is-user' : ''}`} title={user ? '你手动设置的类别（点击可修改）' : '自动判断的类别，不对的话点一下修改'}>
      <select value={cat ?? ''} onChange={(e) => void change(e.target.value)} aria-label="类别">
        {!cat ? <option value="">{KIND_LABEL[task.kind]}</option> : null}
        {Object.entries(CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        {user ? <option value="auto">↺ 恢复自动判断</option> : null}
      </select>
    </label>
  );
}

export function TaskRow({ task, now = new Date(), showDate = true, index = 0 }: { task: TaskView; now?: Date; showDate?: boolean; index?: number }) {
  const [localDone, setLocalDone] = useState(task.localDone);
  useEffect(() => setLocalDone(task.localDone), [task.localDone]);
  const doneElsewhere = task.status === 'done' && !task.localDone;
  const done = doneElsewhere || localDone;
  const isEvent = task.kind === 'event';
  const seal = done ? null : sealFor(task, now);
  const countdown = done || isEvent || task.dueDateOnly ? null : fmtCountdown(task.dueAt, now); // no fake 23:59 countdowns
  const note = providerNote(task.provider);
  const [userNote, setUserNote] = useState(task.note);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  useEffect(() => setUserNote(task.note), [task.note]);

  const saveNote = async () => {
    const value = draft.trim();
    setEditing(false);
    if (value === (userNote ?? '')) return;
    const previous = userNote;
    setUserNote(value || null);
    try {
      await api(`/api/items/${encodeURIComponent(task.id)}`, { method: 'PATCH', body: { note: value } });
      refreshAll();
    } catch {
      setUserNote(previous);
    }
  };

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
          <CategoryChip task={task} />
          {task.points ? <span className="mono">{task.points} 分</span> : null}
          {note ? <span className="provider">{note}</span> : null}
          {task.source === 'ics' ? <span title="登录过期期间来自日历订阅，提交状态未知">日历订阅</span> : null}
          {!userNote && !editing ? <button type="button" className="add-note" onClick={() => { setDraft(''); setEditing(true); }}>＋备注</button> : null}
        </div>
        <Requirements task={task} />
        {task.syllabusNote ? <div className="syllabus-note">📅 {task.syllabusNote}</div> : null}
        {task.dueNote ? <div className="syllabus-note">📅 {task.dueNote}</div> : null}
        {editing ? (
          <input className="note-input" autoFocus value={draft} maxLength={300} placeholder="写一句备注，比如：带计算器 / 要打印出来交" aria-label="备注"
            onChange={(e) => setDraft(e.target.value)} onBlur={() => void saveNote()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveNote();
              if (e.key === 'Escape') setEditing(false);
            }} />
        ) : userNote ? (
          <button type="button" className="user-note" title="点击修改备注（清空即删除）" onClick={() => { setDraft(userNote); setEditing(true); }}>✎ {userNote}</button>
        ) : null}
      </div>
      <div className="task-side">
        <div className="due-box">
          <div className="due">
            {task.dueFromSyllabus ? <span className="from-syllabus" title={task.syllabusNote ?? '日期来自教学大纲'}>大纲</span> : null}
            {task.dueIsClose ? <span className="from-syllabus" title="Canvas 上没有截止日期；这是它关闭、不能再提交的时间">开放到</span> : null}
            {showDate ? fmtDue(task.dueAt, now, { dateOnly: task.dueDateOnly }) : task.dueDateOnly ? '时间见大纲' : task.dueAt ? fmtDue(task.dueAt, now).split(' ').at(-1) : ''}
          </div>
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

export function TaskList({ tasks, now, showDate = true, empty, dense = false }: { tasks: TaskView[]; now?: Date; showDate?: boolean; empty?: string; dense?: boolean }) {
  if (tasks.length === 0) return empty ? <p className="muted small" style={{ margin: '4px 0 0' }}>{empty}</p> : null;
  return (
    <div className={`card tasks stagger ${dense ? 'dense' : ''}`}>
      {tasks.map((t, i) => <TaskRow key={t.id} task={t} now={now} showDate={showDate} index={i} />)}
    </div>
  );
}
