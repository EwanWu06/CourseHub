import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api, refreshAll } from '../api.ts';
import type { CourseCard } from '../types.ts';
import { ErrorNote, TimeSelect } from './ui.tsx';

/** Dialog for deadlines that live outside Canvas (e.g. Macmillan Achieve work that isn't synced). */
export function AddTask({ open, onClose, courses }: { open: boolean; onClose: () => void; courses: CourseCard[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [courseId, setCourseId] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('23:59');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const dueAt = date ? new Date(`${date}T${time || '23:59'}`).toISOString() : null;
      await api('/api/items', { method: 'POST', body: { title, courseId: courseId || null, dueAt, htmlUrl: link || null } });
      setTitle('');
      setLink('');
      refreshAll();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <dialog ref={ref} className="sheet" onClose={onClose}>
      <form onSubmit={submit} className="stack" style={{ padding: 22 }}>
        <div>
          <div className="kicker">Add a task</div>
          <h2 style={{ fontFamily: 'var(--font-zh)', fontSize: 22 }}>手动添加任务</h2>
          <p className="hint" style={{ margin: '4px 0 0' }}>用于没同步到 Canvas 的截止日期，比如 Macmillan Achieve 的作业。会出现在日报、周报和提醒里。</p>
        </div>
        <label className="field"><span>标题</span><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus /></label>
        <label className="field"><span>课程（可选）</span>
          <select className="select" value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">不属于某门课</option>
            {courses.map((c) => <option key={c.course.id} value={c.course.id}>{c.course.display_name} · {c.school?.name}</option>)}
          </select>
        </label>
        <div className="row">
          <label className="field grow"><span>截止日期</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <div className="field"><span>时间</span><TimeSelect value={time} label="时间" onChange={setTime} /></div>
        </div>
        <label className="field"><span>链接（可选）</span><input className="input input-mono" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" /></label>
        <ErrorNote error={error} />
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>取消</button>
          <button type="submit" className="btn btn-primary">添加</button>
        </div>
      </form>
    </dialog>
  );
}
