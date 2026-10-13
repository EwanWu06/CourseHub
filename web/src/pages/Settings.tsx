import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api, refreshAll, useApi } from '../api.ts';
import { fmtDateTime } from '../format.ts';
import { SchoolCard } from '../components/SchoolCard.tsx';
import { Badge, Empty, ErrorNote, Masthead, Section, Spinner, Toggle } from '../components/ui.tsx';
import type { AiUsage, CourseCard, SchoolView, Settings as SettingsT, SyncStatus } from '../types.ts';

function AddSchool({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await api<SchoolView>('/api/schools', { method: 'POST', body: { name, baseUrl: url } });
      await api(`/api/schools/${s.id}/login`, { method: 'POST' });
      setName('');
      setUrl('');
      onAdded();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="card card-pad" onSubmit={submit} style={{ borderStyle: 'dashed' }}>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 180px' }}>
          <span>学校名称</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 Santa Monica College" required />
        </label>
        <label className="field" style={{ flex: '2 1 260px' }}>
          <span>Canvas 网址</span>
          <input className="input input-mono" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="例如 smc.instructure.com" required />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? <Spinner /> : '+'} 添加并登录</button>
      </div>
      <p className="hint" style={{ margin: '10px 0 0' }}>网址就是你登录 Canvas 后，浏览器地址栏里的那个域名。点按钮后会弹出一个 Chrome 窗口，像平时一样登录（SSO、Duo 都可以），建议勾选「保持登录」。</p>
      <ErrorNote error={error} />
    </form>
  );
}

function CourseSettings({ courses, onChanged }: { courses: CourseCard[]; onChanged: () => void }) {
  if (courses.length === 0) return <Empty glyph="课">学校登录并同步后，这里会列出所有课程。</Empty>;
  const save = async (id: string, body: unknown) => {
    await api(`/api/courses/${encodeURIComponent(id)}`, { method: 'PATCH', body });
    onChanged();
    refreshAll();
  };
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>颜色</th><th>课程</th><th>简称（显示用）</th><th>显示</th></tr></thead>
        <tbody>
          {courses.map(({ course, school }) => (
            <tr key={course.id} style={{ opacity: course.hidden ? 0.55 : 1 }}>
              <td><input type="color" value={course.color ?? school?.color ?? '#888888'} onChange={(e) => void save(course.id, { color: e.target.value })} aria-label="课程颜色" /></td>
              <td>
                <div>{course.name}</div>
                <div className="small muted">{school?.name}{course.term_name ? ` · ${course.term_name}` : ''}</div>
              </td>
              <td><input className="input" style={{ width: 160 }} defaultValue={course.nickname ?? ''} placeholder={course.code ?? ''} onBlur={(e) => e.target.value !== (course.nickname ?? '') && void save(course.id, { nickname: e.target.value })} /></td>
              <td><Toggle checked={!course.hidden} label="显示这门课" onChange={(v) => void save(course.id, { hidden: !v })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function ScheduleSettings({ value, onSave }: { value: SettingsT; onSave: (p: Partial<SettingsT>) => Promise<void> }) {
  const [s, setS] = useState(value);
  useEffect(() => setS(value), [value]);
  const dirty = JSON.stringify(s) !== JSON.stringify(value);
  const set = <K extends keyof SettingsT>(k: K, v: SettingsT[K]) => setS({ ...s, [k]: v });
  return (
    <div className="card card-pad stack">
      <div className="grid-2">
        <label className="field"><span>每日日报时间</span><input className="input" type="time" value={s.dailyTime} onChange={(e) => set('dailyTime', e.target.value)} /></label>
        <div className="field">
          <span>每周周报</span>
          <div className="row">
            <select className="select" value={s.weeklyDay} onChange={(e) => set('weeklyDay', Number(e.target.value))}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select>
            <input className="input" type="time" value={s.weeklyTime} onChange={(e) => set('weeklyTime', e.target.value)} />
          </div>
        </div>
        <label className="field"><span>同步频率</span>
          <select className="select" value={s.syncIntervalHours} onChange={(e) => set('syncIntervalHours', Number(e.target.value))}>
            {[1, 2, 3, 4, 6].map((h) => <option key={h} value={h}>每 {h} 小时</option>)}
          </select>
        </label>
        <div className="field">
          <span>只在这段时间同步（夜里不访问 Canvas）</span>
          <div className="row">
            <select className="select" value={s.syncWindowStart} onChange={(e) => set('syncWindowStart', Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select>
            <span className="muted">到</span>
            <select className="select" value={s.syncWindowEnd} onChange={(e) => set('syncWindowEnd', Number(e.target.value))}>{Array.from({ length: 24 }, (_, h) => <option key={h + 1} value={h + 1}>{h + 1}:00</option>)}</select>
          </div>
        </div>
      </div>
      <hr className="divider" />
      <div className="row"><Toggle checked={s.reminders} label="截止前提醒" onChange={(v) => set('reminders', v)} /><span>未交作业截止前提醒</span>
        <input className="input mono" style={{ width: 64 }} type="number" min={1} max={72} value={s.reminderHours[0] ?? 24} onChange={(e) => set('reminderHours', [Number(e.target.value), s.reminderHours[1] ?? 3])} /><span className="muted">小时 和</span>
        <input className="input mono" style={{ width: 64 }} type="number" min={1} max={72} value={s.reminderHours[1] ?? 3} onChange={(e) => set('reminderHours', [s.reminderHours[0] ?? 24, Number(e.target.value)])} /><span className="muted">小时</span>
      </div>
      <div className="row"><Toggle checked={s.notifyChanges} label="变化提醒" onChange={(v) => set('notifyChanges', v)} /><span>截止时间提前、48 小时内的新作业、新公告时立即通知</span></div>
      <div className="row"><button className="btn btn-primary" type="button" disabled={!dirty} onClick={() => void onSave(s)}>保存</button>{dirty ? <span className="small muted">有未保存的修改</span> : null}</div>
    </div>
  );
}

const MODELS: { id: SettingsT['aiModel']; name: string; note: string }[] = [
  { id: 'sonnet', name: 'Sonnet', note: '推荐：讲解清楚，额度友好' },
  { id: 'opus', name: 'Opus', note: '讲得更深，更耗 Max 额度' },
  { id: 'haiku', name: 'Haiku', note: '最快最省，讲解较简略' },
];

function AiSettings({ value, usage, onSave }: { value: SettingsT; usage: AiUsage | undefined; onSave: (p: Partial<SettingsT>) => Promise<void> }) {
  return (
    <div className="card card-pad stack">
      <div className="row"><Toggle checked={value.aiEnabled} label="启用 AI" onChange={(v) => void onSave({ aiEnabled: v })} /><span>用 Claude（你的 Max 订阅）生成学习讲解和日报建议</span></div>
      <div className="grid-2">
        {MODELS.map((m) => (
          <button key={m.id} type="button" className="card card-pad" style={{ textAlign: 'left', cursor: 'pointer', borderColor: value.aiModel === m.id ? 'var(--ink)' : undefined, borderWidth: value.aiModel === m.id ? 2 : 1 }} onClick={() => void onSave({ aiModel: m.id })}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 18, fontWeight: 600 }}>{m.name}</div>
            <div className="small muted">{m.note}</div>
          </button>
        ))}
      </div>
      <label className="field" style={{ maxWidth: 320 }}><span>自动生成学习讲解</span>
        <select className="select" value={value.aiAutoWeeks} onChange={(e) => void onSave({ aiAutoWeeks: Number(e.target.value) })}>
          <option value={0}>不自动生成（只在点按钮时）</option>
          <option value={1}>本周</option>
          <option value={2}>本周 + 下周（推荐）</option>
          <option value={3}>本周 + 之后两周</option>
        </select>
      </label>
      {usage ? <p className="small muted" style={{ margin: 0 }}>最近 7 天：调用 {usage.last7Days.runs} 次（成功 {usage.last7Days.ok} 次）。走的是你的订阅额度，不额外花钱。</p> : null}
    </div>
  );
}

const RUN_TONE: Record<string, 'ok' | 'warn' | 'bad' | undefined> = { ok: 'ok', partial: 'warn', error: 'bad' };
const RUN_LABEL: Record<string, string> = { ok: '成功', partial: '部分失败', error: '失败', running: '进行中' };

function SyncLog({ status, schools }: { status: SyncStatus | undefined; schools: SchoolView[] }) {
  const names = new Map(schools.map((s) => [s.id, s.name]));
  if (!status?.recent.length) return <Empty glyph="录">还没有同步记录。</Empty>;
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead><tr><th>时间</th><th>学校</th><th>结果</th><th>内容</th></tr></thead>
        <tbody>
          {status.recent.map((r) => {
            const st = r.stats ? (JSON.parse(r.stats) as { mode: string; courses: number; items: number; changes: number; requests: number; errors: string[] }) : null;
            return (
              <tr key={r.id}>
                <td className="nowrap mono small">{fmtDateTime(r.started_at)}</td>
                <td>{names.get(r.school_id) ?? r.school_id}</td>
                <td><Badge tone={RUN_TONE[r.status]}>{RUN_LABEL[r.status] ?? r.status}</Badge></td>
                <td className="small">
                  {st ? <span className="muted">{st.mode === 'ics' ? '仅日历订阅 · ' : ''}{st.courses} 门课 · {st.items} 项 · {st.changes} 处变化 · {st.requests} 次请求</span> : null}
                  {r.error ? <div style={{ color: 'var(--seal)' }}>{r.error}</div> : null}
                  {st?.errors.length ? <details><summary className="muted">{st.errors.length} 个小问题</summary><ul style={{ margin: '6px 0', paddingLeft: 18 }}>{st.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></details> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function Settings() {
  const schools = useApi<SchoolView[]>('/api/schools', { poll: 3000 });
  const courses = useApi<CourseCard[]>('/api/courses?all=1');
  const settings = useApi<SettingsT>('/api/settings');
  const usage = useApi<AiUsage>('/api/ai/usage');
  const sync = useApi<SyncStatus>('/api/sync', { poll: 5000 });
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveSettings = async (patch: Partial<SettingsT>) => {
    setError(null);
    try {
      settings.setData(await api<SettingsT>('/api/settings', { method: 'PUT', body: patch }));
      setSaved('已保存');
      setTimeout(() => setSaved(null), 1800);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="page">
      <Masthead kicker="Settings" title="设置" aside={saved ? <span style={{ color: 'var(--moss)' }}>✓ {saved}</span> : null} />
      <ErrorNote error={error ?? schools.error} />
      <Section num="i." title="学校" note="每所学校登录一次，之后自动保持">
        <div className="stack stagger">
          {(schools.data ?? []).map((s, i) => (
            <div key={s.id} style={{ ['--i' as string]: i }}><SchoolCard school={s} onChanged={schools.reload} /></div>
          ))}
          <AddSchool onAdded={schools.reload} />
        </div>
      </Section>
      <Section num="ii." title="课程" note="隐藏的课程不会出现在日报和截止日期里">
        <CourseSettings courses={courses.data ?? []} onChanged={courses.reload} />
      </Section>
      <Section num="iii." title="时间与提醒">
        {settings.data ? <ScheduleSettings value={settings.data} onSave={saveSettings} /> : <Spinner />}
      </Section>
      <Section num="iv." title="AI 学习讲解">
        {settings.data ? <AiSettings value={settings.data} usage={usage.data} onSave={saveSettings} /> : <Spinner />}
      </Section>
      <Section num="v." title="同步日志">
        <SyncLog status={sync.data} schools={schools.data ?? []} />
      </Section>
    </div>
  );
}
