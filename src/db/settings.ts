import type { DB } from './index.ts';
import { one, run } from './sql.ts';

export interface Settings {
  syncIntervalHours: number;
  syncWindowStart: number;
  syncWindowEnd: number;
  dailyTime: string;
  weeklyDay: number;
  weeklyTime: string;
  reminders: boolean;
  reminderHours: number[];
  notifyChanges: boolean;
  aiEnabled: boolean;
  aiModel: 'sonnet' | 'opus' | 'haiku';
  aiAutoWeeks: number;
}

export const DEFAULT_SETTINGS: Settings = {
  syncIntervalHours: 2,
  syncWindowStart: 7,
  syncWindowEnd: 24,
  dailyTime: '07:00',
  weeklyDay: 0,
  weeklyTime: '20:00',
  reminders: true,
  reminderHours: [24, 3],
  notifyChanges: true,
  aiEnabled: true,
  aiModel: 'sonnet',
  aiAutoWeeks: 2,
};

export function getKV(db: DB, key: string): string | null {
  return one<{ value: string }>(db, 'SELECT value FROM settings WHERE key = $key', { key })?.value ?? null;
}

export function setKV(db: DB, key: string, value: string): void {
  run(db, 'INSERT INTO settings (key, value) VALUES ($key, $value) ON CONFLICT(key) DO UPDATE SET value = excluded.value', { key, value });
}

export function getSettings(db: DB): Settings {
  const raw = getKV(db, 'app');
  const stored = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function updateSettings(db: DB, patch: Partial<Settings>): Settings {
  const known: Partial<Settings> = {};
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (k in patch && patch[k] !== undefined) (known as Record<string, unknown>)[k] = patch[k];
  }
  const next = { ...getSettings(db), ...known };
  setKV(db, 'app', JSON.stringify(next));
  return next;
}
