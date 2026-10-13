// Shapes returned by the Course Hub API (mirrors src/server routes).
export type TaskStatus = 'done' | 'todo' | 'overdue' | 'missing' | 'past' | 'event';
export type ItemKind = 'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'event' | 'manual';

export interface TaskView {
  id: string; title: string; kind: ItemKind; provider: string; courseId: string | null; courseName: string | null;
  schoolId: string | null; schoolName: string | null; color: string; dueAt: string | null; htmlUrl: string | null;
  points: number | null; status: TaskStatus; estMinutes: number; source: 'api' | 'ics' | 'manual'; localDone: boolean;
}

export interface LoginState { status: 'idle' | 'waiting' | 'success' | 'failed'; message: string; startedAt: string | null }

export interface SchoolView {
  id: string; name: string; base_url: string; color: string; auth_mode: 'session' | 'token'; ics_url: string | null;
  user_name: string | null; status: 'new' | 'ok' | 'needs_login' | 'error'; status_detail: string | null;
  last_sync_at: string | null; last_ok_at: string | null; links: { label: string; url: string }[]; created_at: string;
  failStreak: number; loginState: LoginState; hasAuth: boolean; hasToken: boolean;
}

export interface Course {
  id: string; school_id: string; canvas_id: string; name: string; code: string | null; nickname: string | null; color: string | null;
  hidden: number; term_name: string | null; start_at: string | null; end_at: string | null; html_url: string; tabs: string[] | null;
  current_score: number | null; current_grade: string | null; week1: string | null; active: number;
}

export interface SchoolBrief { id: string; name: string; color: string; baseUrl: string }

export interface CourseCard { course: Course; school: SchoolBrief | null; nextDue: TaskView | null; newAnnouncements: number; score: number | null; grade: string | null }

export interface Settings {
  syncIntervalHours: number; syncWindowStart: number; syncWindowEnd: number; dailyTime: string; weeklyDay: number;
  weeklyTime: string; reminders: boolean; reminderHours: number[]; notifyChanges: boolean; aiEnabled: boolean;
  aiModel: 'sonnet' | 'opus' | 'haiku'; aiAutoWeeks: number;
}

export interface SyncRun { id: number; school_id: string; started_at: string; finished_at: string | null; status: string; stats: string | null; error: string | null }

export interface SyncStatus { running: boolean; recent: SyncRun[] }

export interface AiRun { id: number; purpose: string; ref: string | null; model: string | null; started_at: string; duration_ms: number | null; cost_usd: number | null; ok: number; error: string | null }

export interface AiUsage { last7Days: { runs: number; ok: number; costUsd: number }; recent: AiRun[] }

export interface Announcement { id: string; title: string; postedAt: string; htmlUrl: string; courseId: string; courseName: string; color: string; schoolName: string }

export interface ReportRow { id: string; type: 'daily' | 'weekly'; period: string; content: string; created_at: string }

export interface Overview {
  now: string;
  schools: { id: string; name: string; color: string; status: SchoolView['status']; statusDetail: string | null; lastSyncAt: string | null; userName: string | null }[];
  counts: { overdue: number; today: number; next3: number; missing: number };
  today: TaskView[]; next3: TaskView[]; overdue: TaskView[];
  announcements: Announcement[];
  latestDaily: ReportRow | null;
  loginNeeded: { id: string; name: string; statusDetail: string | null }[];
}
