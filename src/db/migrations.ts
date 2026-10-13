// Each entry runs once, in order; schema_version in `meta` counts applied entries.
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE schools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    base_url TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    auth_mode TEXT NOT NULL DEFAULT 'session',
    ics_url TEXT,
    user_name TEXT,
    status TEXT NOT NULL DEFAULT 'new',
    status_detail TEXT,
    last_sync_at TEXT,
    last_ok_at TEXT,
    links TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  );
  CREATE TABLE courses (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    canvas_id TEXT NOT NULL,
    name TEXT NOT NULL,
    code TEXT,
    nickname TEXT,
    color TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    term_name TEXT,
    start_at TEXT,
    end_at TEXT,
    html_url TEXT NOT NULL,
    syllabus_html TEXT,
    tabs TEXT,
    current_score REAL,
    current_grade TEXT,
    week1 TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    school_id TEXT REFERENCES schools(id) ON DELETE CASCADE,
    course_id TEXT REFERENCES courses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    due_at TEXT,
    end_at TEXT,
    unlock_at TEXT,
    lock_at TEXT,
    points REAL,
    html_url TEXT,
    provider TEXT NOT NULL DEFAULT 'canvas',
    description_html TEXT,
    submission_types TEXT,
    sub_state TEXT,
    submitted_at TEXT,
    missing INTEGER NOT NULL DEFAULT 0,
    late INTEGER NOT NULL DEFAULT 0,
    excused INTEGER NOT NULL DEFAULT 0,
    score REAL,
    grade TEXT,
    canvas_done INTEGER NOT NULL DEFAULT 0,
    local_done INTEGER NOT NULL DEFAULT 0,
    source TEXT NOT NULL,
    module_id TEXT,
    first_seen_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    removed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX items_due ON items(due_at);
  CREATE INDEX items_course ON items(course_id);
  CREATE TABLE modules (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    canvas_id TEXT NOT NULL,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    unlock_at TEXT,
    week_start INTEGER,
    week_end INTEGER,
    week_source TEXT
  );
  CREATE TABLE module_items (
    id TEXT PRIMARY KEY,
    module_id TEXT NOT NULL REFERENCES modules(id) ON DELETE CASCADE,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    content_id TEXT,
    page_url TEXT,
    html_url TEXT,
    external_url TEXT,
    position INTEGER NOT NULL DEFAULT 0,
    indent INTEGER NOT NULL DEFAULT 0,
    ref_id TEXT
  );
  CREATE INDEX module_items_module ON module_items(module_id);
  CREATE TABLE pages (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    body_html TEXT,
    updated_at TEXT,
    front_page INTEGER NOT NULL DEFAULT 0,
    html_url TEXT NOT NULL
  );
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    canvas_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content_type TEXT,
    size INTEGER,
    updated_at TEXT,
    html_url TEXT NOT NULL,
    text_status TEXT NOT NULL DEFAULT 'pending',
    text_pages INTEGER,
    text_error TEXT
  );
  CREATE TABLE topics (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    message_html TEXT,
    posted_at TEXT,
    author TEXT,
    html_url TEXT NOT NULL,
    reply_count INTEGER NOT NULL DEFAULT 0,
    unread_count INTEGER NOT NULL DEFAULT 0,
    assignment_item_id TEXT,
    first_seen_at TEXT NOT NULL
  );
  CREATE TABLE conversations (
    id TEXT PRIMARY KEY,
    school_id TEXT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    subject TEXT NOT NULL,
    last_message TEXT,
    last_at TEXT,
    participants TEXT NOT NULL DEFAULT '',
    context_name TEXT,
    workflow_state TEXT NOT NULL DEFAULT 'read',
    html_url TEXT NOT NULL
  );
  CREATE TABLE weeks (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    week INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    title TEXT,
    topics TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'calc',
    PRIMARY KEY (course_id, week)
  );
  CREATE TABLE guides (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    week INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    content TEXT,
    input_hash TEXT,
    model TEXT,
    generated_at TEXT,
    error TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    PRIMARY KEY (course_id, week)
  );
  CREATE TABLE reports (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    period TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (type, period)
  );
  CREATE TABLE changes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    course_id TEXT,
    kind TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    data TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    notified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE jobs (
    name TEXT PRIMARY KEY,
    last_run_at TEXT,
    last_status TEXT,
    last_error TEXT
  );
  CREATE TABLE sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    school_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL DEFAULT 'running',
    stats TEXT,
    error TEXT
  );
  CREATE TABLE ai_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purpose TEXT NOT NULL,
    ref TEXT,
    model TEXT,
    started_at TEXT NOT NULL,
    duration_ms INTEGER,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    ok INTEGER NOT NULL,
    error TEXT
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE reminders_sent (
    item_id TEXT NOT NULL,
    threshold TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    PRIMARY KEY (item_id, threshold)
  );
  `,
  // 2: login keep-alive bookkeeping
  `
  ALTER TABLE schools ADD COLUMN login_at TEXT;
  ALTER TABLE schools ADD COLUMN alive_at TEXT;
  ALTER TABLE schools ADD COLUMN renewals INTEGER NOT NULL DEFAULT 0;
  `,
  // 3: assignment groups and real categories (exam vs homework …), dates found in the syllabus
  `
  CREATE TABLE assignment_groups (
    id TEXT PRIMARY KEY,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    weight REAL,
    position INTEGER NOT NULL DEFAULT 0
  );
  ALTER TABLE items ADD COLUMN group_id TEXT;
  ALTER TABLE items ADD COLUMN category TEXT;
  ALTER TABLE items ADD COLUMN category_source TEXT;
  ALTER TABLE items ADD COLUMN syllabus_date TEXT;
  ALTER TABLE items ADD COLUMN syllabus_note TEXT;
  `,
  // 4: whether a syllabus date includes a time of day
  `
  ALTER TABLE items ADD COLUMN syllabus_time_known INTEGER NOT NULL DEFAULT 0;
  `,
  // 5: every notification sent, so a missed banner can be read later in the app
  `
  CREATE TABLE notices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL DEFAULT 'system',
    title TEXT NOT NULL,
    subtitle TEXT,
    body TEXT NOT NULL,
    url TEXT,
    created_at TEXT NOT NULL,
    read_at TEXT
  );
  CREATE INDEX notices_created ON notices(created_at);
  `,
  // 6: a personal note on any task ("带计算器"), never touched by syncs
  `
  ALTER TABLE items ADD COLUMN user_note TEXT;
  `,
  // 7: questions asked about a study week, with Claude's answers
  `
  CREATE TABLE study_qa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    week INTEGER NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    created_at TEXT NOT NULL,
    answered_at TEXT
  );
  CREATE INDEX study_qa_week ON study_qa(course_id, week);
  `,
  // 8: indexes for the tables that keep growing term after term (changes, topics, files, pages, runs…)
  `
  CREATE INDEX IF NOT EXISTS changes_pending ON changes(notified);
  CREATE INDEX IF NOT EXISTS changes_created ON changes(created_at);
  CREATE INDEX IF NOT EXISTS topics_course_kind ON topics(course_id, kind);
  CREATE INDEX IF NOT EXISTS files_course ON files(course_id);
  CREATE INDEX IF NOT EXISTS pages_course ON pages(course_id);
  CREATE INDEX IF NOT EXISTS items_school ON items(school_id, removed);
  CREATE INDEX IF NOT EXISTS ai_runs_started ON ai_runs(started_at);
  CREATE INDEX IF NOT EXISTS sync_runs_school ON sync_runs(school_id, id);
  CREATE INDEX IF NOT EXISTS reminders_sent_at ON reminders_sent(sent_at);
  `,
  // 9: publisher platforms read alongside Canvas (Achieve…): when each course's work was last read, and why not
  `
  CREATE TABLE platform_status (
    course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    last_try_at TEXT,
    last_ok_at TEXT,
    error TEXT,
    items INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (course_id, platform)
  );
  `,
];
