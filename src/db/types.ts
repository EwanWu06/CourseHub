export type SchoolStatus = 'new' | 'ok' | 'needs_login' | 'error';

export interface SchoolRow {
  id: string; name: string; base_url: string; color: string; auth_mode: 'session' | 'token';
  ics_url: string | null; user_name: string | null; status: SchoolStatus; status_detail: string | null;
  last_sync_at: string | null; last_ok_at: string | null; links: string; created_at: string;
}

export interface CourseRow {
  id: string; school_id: string; canvas_id: string; name: string; code: string | null; nickname: string | null;
  color: string | null; hidden: number; term_name: string | null; start_at: string | null; end_at: string | null;
  html_url: string; syllabus_html: string | null; tabs: string | null; current_score: number | null;
  current_grade: string | null; week1: string | null; active: number; updated_at: string;
}

export type ItemKind = 'assignment' | 'quiz' | 'discussion' | 'page' | 'note' | 'event' | 'manual';

export interface ItemRow {
  id: string; school_id: string | null; course_id: string | null; kind: ItemKind; title: string;
  due_at: string | null; end_at: string | null; unlock_at: string | null; lock_at: string | null;
  points: number | null; html_url: string | null; provider: string; description_html: string | null;
  submission_types: string | null; sub_state: string | null; submitted_at: string | null;
  missing: number; late: number; excused: number; score: number | null; grade: string | null;
  canvas_done: number; local_done: number; source: 'api' | 'ics' | 'manual'; module_id: string | null;
  first_seen_at: string; updated_at: string; removed: number;
}

export interface ModuleRow {
  id: string; course_id: string; canvas_id: string; name: string; position: number; unlock_at: string | null;
  week_start: number | null; week_end: number | null; week_source: string | null;
}

export interface ModuleItemRow {
  id: string; module_id: string; course_id: string; title: string; type: string; content_id: string | null;
  page_url: string | null; html_url: string | null; external_url: string | null; position: number; indent: number;
  ref_id: string | null;
}

export interface PageRow {
  id: string; course_id: string; url: string; title: string; body_html: string | null; updated_at: string | null;
  front_page: number; html_url: string;
}

export type TextStatus = 'pending' | 'ok' | 'empty' | 'failed' | 'unsupported' | 'skipped';

export interface FileRow {
  id: string; course_id: string; canvas_id: string; name: string; content_type: string | null; size: number | null;
  updated_at: string | null; html_url: string; text_status: TextStatus; text_pages: number | null; text_error: string | null;
}

export interface TopicRow {
  id: string; course_id: string; kind: 'announcement' | 'discussion'; title: string; message_html: string | null;
  posted_at: string | null; author: string | null; html_url: string; reply_count: number; unread_count: number;
  assignment_item_id: string | null; first_seen_at: string;
}

export interface ConversationRow {
  id: string; school_id: string; subject: string; last_message: string | null; last_at: string | null;
  participants: string; context_name: string | null; workflow_state: string; html_url: string;
}

export interface WeekRow {
  course_id: string; week: number; start_date: string; title: string | null; topics: string; source: string;
}

export interface GuideRow {
  course_id: string; week: number; status: 'queued' | 'running' | 'ready' | 'failed'; content: string | null;
  input_hash: string | null; model: string | null; generated_at: string | null; error: string | null;
  attempts: number; next_attempt_at: string | null;
}

export interface ReportRow { id: string; type: 'daily' | 'weekly'; period: string; content: string; created_at: string }

export type ChangeKind = 'new_item' | 'due_changed' | 'graded' | 'missing' | 'announcement' | 'file';

export interface ChangeRow {
  id: number; school_id: string; course_id: string | null; kind: ChangeKind; ref_id: string; summary: string;
  data: string; created_at: string; notified: number;
}

export interface JobRow { name: string; last_run_at: string | null; last_status: string | null; last_error: string | null }

export interface SyncRunRow {
  id: number; school_id: string; started_at: string; finished_at: string | null; status: string;
  stats: string | null; error: string | null;
}

export interface AiRunRow {
  id: number; purpose: string; ref: string | null; model: string | null; started_at: string; duration_ms: number | null;
  input_tokens: number | null; output_tokens: number | null; cost_usd: number | null; ok: number; error: string | null;
}
