// The almanac line under Today's date: the month in Chinese numerals and the lunar date ("丙午年 九月十五").
// Pure and local-time; the lunar part comes from Intl's Chinese calendar and is left out where that isn't available.

const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 10 → "十月", 12 → "十二月" (month is 1–12). */
export function zhMonth(month: number): string {
  return `${month <= 10 ? DIGITS[month] : `十${DIGITS[month - 10]}`}月`;
}

/** Lunar day names as almanacs write them: 初一 … 初十, 十一 … 十九, 二十, 廿一 … 廿九, 三十. */
export function lunarDayName(day: number): string {
  if (day <= 10) return `初${DIGITS[day]}`;
  if (day < 20) return `十${DIGITS[day - 10]}`;
  if (day === 20) return '二十';
  if (day < 30) return `廿${DIGITS[day - 20]}`;
  return '三十';
}

/** "丙午年 九月十五" for the given day, or null when the browser has no Chinese calendar. */
export function lunarDate(d: Date): string | null {
  try {
    const parts = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { year: 'numeric', month: 'long', day: 'numeric' }).formatToParts(d);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const day = Number(get('day'));
    const month = get('month');
    if (!month || !Number.isInteger(day) || day < 1 || day > 30) return null;
    const year = get('yearName');
    return `${year ? `${year}年 ` : ''}${month}${lunarDayName(day)}`;
  } catch {
    return null;
  }
}
