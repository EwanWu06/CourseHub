// Date/time wording for the UI (Chinese). Pure functions; local time zone of the browser.

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const pad = (n: number) => String(n).padStart(2, '0');

function dayIndex(d: Date): number {
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function hhmm(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function weekdayName(d: Date): string {
  return WEEKDAYS[d.getDay()];
}

export function fmtDate(d: Date, now: Date = new Date()): string {
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  return `${d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`} ${weekdayName(d)}`;
}

export function fmtDue(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '无截止日期';
  const d = new Date(iso);
  const diff = dayIndex(d) - dayIndex(now);
  const time = hhmm(d);
  if (diff === 0) return `今天 ${time}`;
  if (diff === 1) return `明天 ${time}`;
  if (diff === -1) return `昨天 ${time}`;
  if (diff >= 2 && diff <= 6) return `${weekdayName(d)} ${time}`;
  return `${fmtDate(d, now)} ${time}`;
}

export function fmtCountdown(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso) - now.getTime();
  const minutes = Math.round(ms / 60_000);
  if (ms >= 0) {
    if (minutes < 60) return `还剩 ${Math.max(minutes, 1)} 分钟`;
    const hours = Math.floor(minutes / 60);
    return hours < 48 ? `还剩 ${hours} 小时` : null;
  }
  const late = -minutes;
  if (late < 60) return `已逾期 ${late} 分钟`;
  if (late < 24 * 60) return `已逾期 ${Math.floor(late / 60)} 小时`;
  return `已逾期 ${Math.floor(late / (24 * 60))} 天`;
}

export function fmtRelative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return '从未';
  const s = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return '刚刚';
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86_400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86_400)} 天前`;
}

export function fmtDateTime(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return `${fmtDate(d, now)} ${hhmm(d)}`;
}

export function fmtBytes(n: number | null): string {
  if (n === null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
