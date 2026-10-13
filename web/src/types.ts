// Shapes returned by the Course Hub API (mirrors src/server routes).
export type TaskStatus = 'done' | 'todo' | 'overdue' | 'missing' | 'past' | 'event';
export type ItemKind = 'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'event' | 'manual';

export interface TaskView {
  id: string; title: string; kind: ItemKind; provider: string; courseId: string | null; courseName: string | null;
  schoolId: string | null; schoolName: string | null; color: string; dueAt: string | null; htmlUrl: string | null;
  points: number | null; status: TaskStatus; estMinutes: number; source: 'api' | 'ics' | 'manual' | 'syllabus'; localDone: boolean;
  category: string | null; categorySource: string | null; syllabusNote: string | null;
  dueFromSyllabus: boolean; dueDateOnly: boolean;
}

export interface LoginState { status: 'idle' | 'waiting' | 'success' | 'failed'; message: string; startedAt: string | null }

export interface SchoolView {
  id: string; name: string; base_url: string; color: string; auth_mode: 'session' | 'token'; ics_url: string | null;
  user_name: string | null; status: 'new' | 'ok' | 'needs_login' | 'error'; status_detail: string | null;
  last_sync_at: string | null; last_ok_at: string | null; links: { label: string; url: string }[]; created_at: string;
  failStreak: number; loginState: LoginState; hasAuth: boolean; hasToken: boolean;
  login_at: string | null; alive_at: string | null; renewals: number;
}

export interface Course {
  id: string; school_id: string; canvas_id: string; name: string; code: string | null; nickname: string | null; color: string | null;
  hidden: number; term_name: string | null; start_at: string | null; end_at: string | null; html_url: string; tabs: string[] | null;
  current_score: number | null; current_grade: string | null; week1: string | null; active: number; display_name: string;
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
  today: TaskView[]; next3: TaskView[]; overdue: TaskView[]; exams: TaskView[];
  announcements: Announcement[];
  latestDaily: ReportRow | null;
  loginNeeded: { id: string; name: string; statusDetail: string | null }[];
}

export interface CourseDetailT {
  course: Course; school: SchoolBrief | null; currentWeek: number | null;
  counts: { assignments: number; modules: number; pages: number; files: number; announcements: number; discussions: number };
}

export interface ModuleT { id: string; name: string; position: number; unlock_at: string | null; week_start: number | null; week_end: number | null; week_source: string | null }

export interface ModuleItemT {
  id: string; title: string; type: string; content_id: string | null; page_url: string | null; html_url: string | null; external_url: string | null;
  position: number; indent: number; ref_id: string | null;
  ref: { kind: string; id: string; status?: TaskStatus; dueAt?: string | null; textStatus?: string; size?: number | null } | null;
}

export interface PageT { id: string; course_id: string; url: string; title: string; body_html?: string | null; updated_at: string | null; front_page: number; html_url: string }

export interface FileT { id: string; name: string; content_type: string | null; size: number | null; updated_at: string | null; html_url: string; text_status: string; text_pages: number | null; text_error: string | null }

export interface TopicT { id: string; kind: 'announcement' | 'discussion'; title: string; message_html: string | null; posted_at: string | null; author: string | null; html_url: string; reply_count: number; unread_count: number; first_seen_at: string }

export interface GradesT { score: number | null; grade: string | null; htmlUrl: string; items: { id: string; title: string; kind: string; dueAt: string | null; points: number | null; score: number | null; grade: string | null; status: TaskStatus; htmlUrl: string | null; excused: boolean }[] }

export interface SyllabusT {
  html: string | null; htmlUrl: string; files: FileT[];
  analysis: { analyzedAt: string; error: string | null; summary: { examsApplied: number; examsRejected: number; categoriesApplied: number; weeksApplied: number; modulesApplied: number } | null } | null;
}

export interface ConversationT { id: string; school_id: string; subject: string; last_message: string | null; last_at: string | null; participants: string; context_name: string | null; workflow_state: string; html_url: string; schoolName: string; color: string }
