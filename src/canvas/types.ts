// Subset of Canvas REST API response shapes used by the sync. IDs arrive as strings because the client asks
// for application/json+canvas-string-ids.

export interface CanvasTerm { id?: string; name?: string | null; start_at?: string | null; end_at?: string | null }

export interface CanvasEnrollment {
  type: string; enrollment_state?: string; computed_current_score?: number | null; computed_current_grade?: string | null;
}

export interface CanvasCourse {
  id: string; name?: string; course_code?: string; start_at?: string | null; end_at?: string | null; term?: CanvasTerm | null;
  enrollments?: CanvasEnrollment[]; access_restricted_by_date?: boolean; workflow_state?: string; syllabus_body?: string | null;
  /** include[]=teachers */
  teachers?: { id: string; display_name?: string }[] | null;
  apply_assignment_group_weights?: boolean;
}

export interface CanvasSubmission {
  workflow_state?: string; submitted_at?: string | null; score?: number | null; grade?: string | null; late?: boolean;
  missing?: boolean; excused?: boolean | null; user_id?: string;
  /** a discussion's submission lists the student's own entries (top-level posts have no parent) */
  discussion_entries?: { id: string; parent_id?: string | null; user_id?: string; created_at?: string }[] | null;
  /** discussion checkpoints (include[]=sub_assignment_submissions): one entry per checkpoint */
  sub_assignment_submissions?: (Omit<CanvasSubmission, 'sub_assignment_submissions'> & { sub_assignment_tag: string })[] | null;
}

/** A graded discussion split into an initial post and replies, each with its own due date (include[]=checkpoints). */
export interface CanvasCheckpoint {
  tag: string; name?: string; points_possible?: number | null; due_at?: string | null; unlock_at?: string | null; lock_at?: string | null;
  overrides?: { due_at?: string | null }[];
}

export interface CanvasAssignment {
  id: string; name: string; description?: string | null; due_at?: string | null; unlock_at?: string | null; lock_at?: string | null;
  points_possible?: number | null; submission_types?: string[]; html_url?: string; quiz_id?: string | null;
  is_quiz_assignment?: boolean; is_quiz_lti_assignment?: boolean;
  discussion_topic?: { id: string; require_initial_post?: boolean | null; reply_to_entry_required_count?: number | null; group_category_id?: string | null } | null;
  /** peer reviews: once they hand in, each student reviews peer_review_count classmates */
  peer_reviews?: boolean; peer_review_count?: number | null; automatic_peer_reviews?: boolean;
  /** -1 = unlimited */
  allowed_attempts?: number | null; allowed_extensions?: string[] | null;
  external_tool_tag_attributes?: { url?: string | null } | null; submission?: CanvasSubmission | null; published?: boolean;
  assignment_group_id?: string | null; has_sub_assignments?: boolean; checkpoints?: CanvasCheckpoint[] | null;
}

export interface CanvasAssignmentGroup {
  id: string; name: string; group_weight?: number | null; position?: number;
  rules?: { drop_lowest?: number; drop_highest?: number; never_drop?: string[] } | null;
}

export interface CanvasQuiz {
  id: string; title: string; due_at?: string | null; unlock_at?: string | null; lock_at?: string | null; html_url?: string;
  assignment_id?: string | null; quiz_type?: string; points_possible?: number | null; published?: boolean;
  /** minutes; null = untimed */
  time_limit?: number | null;
  /** -1 = unlimited */
  allowed_attempts?: number | null;
}

export interface CanvasPlannerSubmissions {
  submitted?: boolean; excused?: boolean; graded?: boolean; late?: boolean; missing?: boolean; needs_grading?: boolean;
}

export interface CanvasPlannerItem {
  plannable_id: string; plannable_type: string; plannable_date?: string | null;
  plannable?: {
    id?: string; title?: string; due_at?: string | null; todo_date?: string | null; points_possible?: number | null; assignment_id?: string | null;
    details?: string | null; workflow_state?: string | null; sub_assignment_tag?: string | null;
  };
  course_id?: string | null; context_name?: string; html_url?: string;
  submissions?: CanvasPlannerSubmissions | false; planner_override?: { marked_complete?: boolean; dismissed?: boolean } | null;
}

export interface CanvasCalendarEvent {
  id: string; title: string; start_at?: string | null; end_at?: string | null; all_day?: boolean; location_name?: string | null;
  description?: string | null; html_url?: string; context_code?: string;
}

export interface CanvasModuleItem {
  id: string; title: string; type: string; content_id?: string | null; html_url?: string | null; url?: string | null;
  page_url?: string | null; external_url?: string | null; position?: number; indent?: number;
  content_details?: { due_at?: string | null; points_possible?: number | null; locked_for_user?: boolean };
  /** what the module needs done with this item, and whether this student has (students get `completed`) */
  completion_requirement?: { type: string; min_score?: number | null; completed?: boolean } | null;
}

export interface CanvasModule {
  id: string; name: string; position?: number; unlock_at?: string | null; state?: string; items_count?: number; items?: CanvasModuleItem[];
  prerequisite_module_ids?: string[] | null; require_sequential_progress?: boolean;
}

export interface CanvasPage {
  page_id: string; url: string; title: string; updated_at?: string | null; front_page?: boolean; published?: boolean;
  html_url?: string; body?: string | null;
}

export interface CanvasFile {
  id: string; display_name: string; filename?: string; 'content-type'?: string; size?: number; updated_at?: string | null;
  url?: string; folder_id?: string; locked_for_user?: boolean; hidden_for_user?: boolean;
}

export interface CanvasDiscussionTopic {
  id: string; title: string; message?: string | null; posted_at?: string | null; created_at?: string | null; author?: { display_name?: string } | null;
  user_name?: string | null; html_url?: string; discussion_subentry_count?: number; unread_count?: number;
  assignment_id?: string | null; todo_date?: string | null; is_announcement?: boolean; context_code?: string;
}

export interface CanvasConversation {
  id: string; subject?: string | null; last_message?: string | null; last_message_at?: string | null;
  participants?: { name: string }[]; context_name?: string | null; workflow_state?: string;
}

export interface CanvasProfile {
  id: string; name?: string; short_name?: string; primary_email?: string; login_id?: string; time_zone?: string;
  calendar?: { ics?: string } | null;
}

export interface CanvasTab { id: string; label?: string; html_url?: string; hidden?: boolean; visibility?: string; type?: string }
