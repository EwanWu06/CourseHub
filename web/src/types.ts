// Shapes returned by the Course Hub API (mirrors src/server routes).
export type TaskStatus = 'done' | 'todo' | 'overdue' | 'missing' | 'past' | 'event';
export type ItemKind = 'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'event' | 'manual';

export interface TaskView {
  id: string; title: string; kind: ItemKind; provider: string; courseId: string | null; courseName: string | null;
  schoolId: string | null; schoolName: string | null; color: string; dueAt: string | null; htmlUrl: string | null;
  points: number | null; status: TaskStatus; estMinutes: number; source: 'api' | 'ics' | 'manual' | 'syllabus'; localDone: boolean;
  category: string | null; categorySource: string | null; syllabusNote: string | null;
  dueFromSyllabus: boolean; dueDateOnly: boolean;
  note: string | null;
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
  /** next 7 days of work to hand in (no exams, no calendar events) plus anything overdue */
  homework: TaskView[];
  week: { open: number; minutes: number };
  study: { courseId: string; courseName: string; color: string; week: number; title: string | null; topics: string[]; guide: string | null }[];
  announcements: Announcement[];
  latestDaily: { id: string; type: 'daily'; period: string; createdAt: string; headline: string; blocks: { slot: string; title: string; minutes: number }[] } | null;
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

export interface StudyCourse { course: Course; school: { id: string; name: string; color: string } | null; currentWeek: number | null; lastWeek: number | null; ready: number }

export interface GuideBrief { status: 'queued' | 'running' | 'ready' | 'failed'; stale: boolean; generatedAt: string | null; error: string | null }

export interface StudyWeekRow { week: number; startDate: string; title: string | null; topics: string[]; materialCount: number; guide: GuideBrief | null }

export interface StudyCourseDetail { course: Course; school: { id: string; name: string; color: string } | null; currentWeek: number | null; weeks: StudyWeekRow[]; undatedModules: { id: string; name: string }[] }

export interface GuideContent {
  overview: string; objectives: string[];
  concepts: { term: string; term_zh: string; explanation: string; example: string; pitfalls: string; sources: { material_id: string; page: number | null }[] }[];
  cheatsheet: string; assignments: { item_id: string; relation: string }[]; self_test: { question: string; answer: string }[];
  study_plan: { step: string; minutes: number }[]; coverage: { level: 'full' | 'partial' | 'minimal'; note: string };
}

export interface StudyWeekDetail {
  course: Course; school: { id: string; name: string; color: string } | null; week: number; startDate: string; endDate: string; topics: string[]; moduleNames: string[];
  materials: { id: string; kind: string; title: string; url: string | null; pages: number | null; scanned: boolean; hasText: boolean }[];
  assignments: TaskView[];
  guide: { status: GuideBrief['status'] | null; generatedAt: string | null; error: string | null; model: string | null; stale: boolean; queued: boolean; content: GuideContent | null };
  qa: StudyQa[];
}

export interface StudyQa { id: number; question: string; answer: string | null; status: 'pending' | 'done' | 'failed'; error: string | null; created_at: string }

export interface ReportListItem { id: string; type: 'daily' | 'weekly'; period: string; createdAt: string; headline: string; aiError: string | null }

export interface DailyData {
  date: string; overdue: TaskView[]; dueToday: TaskView[]; next3Days: TaskView[]; laterThisWeek: TaskView[]; eventsToday: TaskView[]; examsSoon: TaskView[];
  announcements: { id: string; courseName: string; title: string; postedAt: string; htmlUrl: string }[];
  grades: { itemId: string; title: string; courseName: string; score: number | null; points: number | null }[];
  dueChanges: { itemId: string; title: string; courseName: string; from: string | null; to: string | null }[];
  loginNeeded: { schoolId: string; name: string }[];
  studyFocus: { courseId: string; courseName: string; week: number; overview: string | null; status: string | null }[];
  totals: { todo: number; minutes: number };
}

export interface DailyAi { headline: string; blocks: { slot: '上午' | '下午' | '晚上'; title: string; item_id?: string; minutes: number; note?: string }[]; tips: string[] }

export interface WeeklyData {
  weekStart: string; weekEnd: string;
  last: { onTime: number; late: number; missing: number; graded: { title: string; courseName: string; score: number | null; points: number | null }[] };
  next: {
    days: { date: string; items: TaskView[]; minutes: number }[];
    exams: TaskView[];
    topics: { courseId: string; courseName: string; week: number; title: string | null; topics: string[]; overview: string | null }[];
  };
  busiest: string | null;
}

export interface WeeklyAi { headline: string; focus: string[]; risks: string[]; suggestions: string[] }

export type ReportBody =
  | { kind: 'daily'; data: DailyData; ai: DailyAi | null; aiError: string | null }
  | { kind: 'weekly'; data: WeeklyData; ai: WeeklyAi | null; aiError: string | null };

export interface ReportDetail { id: string; type: 'daily' | 'weekly'; period: string; createdAt: string; headline: string; report: ReportBody }

export interface StatusIssue { kind: string; text: string; action?: 'login' | 'sync' | 'backup' | 'notify-test' }
export interface SystemStatus {
  app: { app: string; version: string; pid: number; startedAt: string };
  schools: { id: string; name: string; color: string; status: SchoolView['status']; statusDetail: string | null; authMode: string; loginAt: string | null; aliveAt: string | null; renewals: number; lastSyncAt: string | null; lastOkAt: string | null; icsFallback: boolean; lastRun: { status: string; error: string | null; finishedAt: string | null } | null }[];
  jobs: { name: string; label: string; lastRunAt: string | null; lastStatus: string | null; lastError: string | null }[];
  ai: { enabled: boolean; model: string; running: string | null; pending: number; today: { calls: number; failed: number; inputTokens: number; outputTokens: number }; last: { ok: boolean; error: string | null; at: string; purpose: string } | null };
  backups: { date: string; bytes: number }[];
  notifier: { applet: boolean; unread: number };
  issues: StatusIssue[];
}
