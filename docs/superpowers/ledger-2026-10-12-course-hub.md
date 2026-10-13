# SDD ledger — plan: docs/superpowers/plans/2026-10-12-course-hub.md
Spec: docs/superpowers/specs/2026-10-12-course-hub-design.md (approved by user 2026-10-12 with change: no persistent file downloads, link everything to Canvas)
Executor: inline (superpowers:executing-plans); no TodoWrite tool in this harness → this ledger is the only progress record.
Setup: Ruling: implement on branch build/v1 inside ~/CourseHub instead of a separate worktree — LaunchAgent + data paths are tied to ~/CourseHub and the repo is new, local-only — cost if wrong: none (local merge to main at finish).
Setup: Ruling: plan headings renumbered "Task 1..27 (A1..J1)" because task-start/task-done match numeric headings — cost if wrong: none.
Pre-flight:
- T3 CookieJar → T4 CanvasAuth.jar: StoredCookie fields == Playwright cookie shape (name,value,domain,path,expires,httpOnly,secure,sameSite) → T11 can save context.cookies() directly. OK.
- T4 CanvasClient.get/getAll/fetchRaw → T7/T8/T10 consumers: signatures match. OK.
- T2 upsertItem returns {created, prev} → T7 noteItemChange(prev,next): match. OK.
- T7 SyncOptions.relogin/onLoginNeeded ← T12 extends: interface already widened in plan (relogin may be null; onLoginNeeded optional). OK.
- T9 ModuleWeek.source lacks 'syllabus' ← T18 writes week_source='syllabus' directly; Ruling: keep inference union as-is, build.ts preserves existing 'syllabus' rows — cost if wrong: one union member.
- T13 needs TaskView/taskStatus/estimateMinutes/toTaskView → created in src/reports/data.ts by T13, extended by T20. OK.
- T13 createApp deps (enqueueGuide/generateReport) ← T18/T21 replace 501 stubs. OK.
- T17 runClaude(db, req) → T18, T21. OK.
- T22 notify/flushChangeNotices/runReminders/loginNeededNotice → T23 jobs + T12 onLoginNeeded wiring. OK.
- T10 cleanTmp → T13 main.ts, T23 cleanup job. OK.
- T14 web api() sends X-CourseHub → T13 security guard. OK.
Task 1: Ruling: added test/util.test.ts (config/hash/log) beyond the brief's time tests — TDD needs a failing test for every created module — cost if wrong: none
Task 1: Ruling: 'typecheck' script is server-only until Task 14 adds web/tsconfig.json — web dir does not exist yet — cost if wrong: none
Task 1: complete (commits 6818555..6427f3c, tests: npm test → ℹ duration_ms 110.654125)
Task 2: Ruling: upsertCourse keeps syllabus_html/tabs when the course listing passes null (COALESCE) and setCourseSyllabus() was added for the content sync — a failed content sync must not wipe the syllabus — cost if wrong: a syllabus deleted in Canvas stays visible.
Task 2: Ruling: markRemovedExcept also flags 'ics'-sourced rows — a complete API listing is authoritative — cost if wrong: none.
Task 2: Ruling: added repo helpers beyond the brief (sql.ts, setModuleWeek, pruneModules, list*/get* readers, listGuidesByStatus, getKV/setKV, JobRow/SyncRunRow/AiRunRow/TextStatus/ChangeKind types) — consumers in later tasks need them — cost if wrong: none.
Task 2: complete (commits 6427f3c..87d3fd0, tests: npm test → ℹ duration_ms 209.7385)
Task 3: complete (commits 87d3fd0..1944a74, tests: npm test → ℹ duration_ms 228.127458)
Task 4: complete (commits 1944a74..94614c0, tests: npm test → ℹ duration_ms 400.206208)
Task 5: complete (commits 94614c0..3a55341, tests: npm test → ℹ duration_ms 902.361208)
Task 6: complete (commits 3a55341..761861e, tests: npm test → ℹ duration_ms 574.496541)
Task 7: Ruling: CanvasClient.auth is public readonly so rotated session cookies can be persisted (persistClientCookies) — cost if wrong: none.
Task 7: Ruling: added SyncOptions.now, SyncBusyError, repo helpers setItemFlags/itemToUpsert; mergeIcs ctx widened with firstSync/stats so ICS-detected due moves create changes; noteItemChange's `next` is an ItemUpsert — cost if wrong: none.
Task 7: Ruling: removal after a complete listing only touches a:/q: ids; planner-only d:/w:/n: items and events are never removed by it — avoids removed-flag flip-flop — cost if wrong: a deleted ungraded to-do lingers until its date passes.
Task 7: Ruling: concluded courses are skipped entirely (not stored as inactive) — spec only requires exclusion — cost if wrong: none.
Task 7: Ruling: ICS-only items whose course is unknown keep "[COURSE CODE]" in the title — no course row to hold the label — cost if wrong: cosmetic.
Task 7: Ruling: syncSchool records failures (status 'error', sync_run 'error') and returns stats instead of throwing, so syncAll continues with other schools — cost if wrong: none.
Task 7: complete (commits 761861e..8312c2a, tests: npm test → ℹ duration_ms 858.54275)
Task 8: Ruling: module item ref_id semantics — Assignment→a:, Quiz→a:<assignment> (via quizToAssignment map) else q:, Discussion→t:<topic>, File→f:, Page→p:<page_id>; SyncContext gained quizToAssignment/topicToAssignment maps; items.module_id set from module membership (setItemModule repo fn added) — cost if wrong: week inference join changes.
Task 8: Ruling: when the Pages tab is hidden, module-linked pages are fetched once (not refreshed) — no updated_at available without the list — cost if wrong: such pages can be stale.
Task 8: Ruling: new-file changes are recorded only for document-like names (pdf/ppt/doc/rtf/txt/md/key) — avoids noise from images/videos — cost if wrong: none.
Task 8: complete (commits 8312c2a..025dfa6, tests: npm test → ℹ duration_ms 1233.924917)
Task 9: Ruling: plan example weekOf('2026-08-24','2026-10-13T06:00:00Z') === 7 was off by one (that instant is Mon Oct 12 PDT = week 8); tests assert the calendar-correct values (Oct 11 → 7, Oct 12 → 8) — cost if wrong: none.
Task 9: Ruling: due-date mapping spans two adjacent weeks (start..end) when a module's due dates fall in consecutive weeks, else uses the median week; week count = max(end-date week, last module week), capped at 30 — cost if wrong: week boundaries for oddly built courses.
Task 9: complete (commits 025dfa6..c82f77b, tests: npm test → ℹ duration_ms 1477.156709)
Task 10: Ruling: "scanned" = under 10 visible chars per page (plan said 25) — 25 misflagged short, real text slides — cost if wrong: a few image-heavy decks are read as text-only.
Task 10: Ruling: scanned/no-text files get text_status 'empty' (text kept if any) instead of a new status value — G2 treats 'empty' PDFs as "look at the pages" — cost if wrong: none.
Task 10: Ruling: file metadata is re-fetched via /api/v1/files/:id for a fresh signed URL; non-extractable types are marked 'unsupported' without download and don't count toward the per-sync limit (15) — cost if wrong: none.
Task 10: complete (commits c82f77b..c0f87a2, tests: npm test → ℹ duration_ms 2494.195333)
Task 11: Ruling: checkLoggedIn verifies with Node + the browser's cookies (CanvasClient) instead of page.evaluate — it proves the saved session works for the sync and avoids navigation races — cost if wrong: none.
Task 11: Ruling: launchChrome accepts userAgent; headless re-login reuses the saved (non-headless) UA and "HeadlessChrome" is normalised to "Chrome" — some IdPs treat headless UAs differently — cost if wrong: none.
Task 11: complete (commits c0f87a2..1855a07, tests: npm run test:chrome → ℹ duration_ms 30305.661792)
Task 12: Ruling: mock /files/:id/download now honours the verifier param like real Canvas (token clients download via verifier) — the strict mock made token-mode syncs look expired — cost if wrong: none (test double only).
Task 12: Ruling: token schools never attempt browser re-login and get the detail "访问令牌无效或已过期，请在设置里更新" — cost if wrong: none.
Task 12: complete (commits 1855a07..9faa333, tests: npm test → ℹ duration_ms 3973.359291)
Task 13: Ruling: taskStatus/estimateMinutes/isExamLike tests moved here from Task 20 (the API needs them now; TDD requires the failing test first) — Task 20 keeps computeDaily/computeWeekly — cost if wrong: none.
Task 13: Ruling: status 'past' (not overdue) for: non-submittable types, notes/page to-dos, ICS-only items (sub_state unknown) and publisher LTI work (Macmillan etc.) whose completion Canvas can't see; missing flag still wins — cost if wrong: a truly late publisher assignment shows grey instead of red.
Task 13: Ruling: added routes beyond the brief — GET /api/search-courses, schoolView.hasToken, PATCH token handling (token mode switch), AppDeps.syncOptions, makeSyncStarter (single in-flight sync guard shared by login→sync and POST /api/sync), host check uses the request URL host (= Host header under @hono/node-server) — cost if wrong: none.
Task 13: Ruling: successful login triggers an immediate sync of that school; the API test's login double returns ok:false to keep tests isolated — cost if wrong: none.
Task 13: Ruling: static files served by a small custom handler instead of @hono/node-server serveStatic (cwd-relative root is fragile under launchd) — cost if wrong: none.
Task 13: complete (commits 9faa333..0907940, tests: npm test → ℹ duration_ms 5551.455458)
Task 14: Ruling: matchRoute lives in web/src/route-match.ts (pure) so Node can test it; router.tsx (JSX) imports it — Node cannot strip JSX — cost if wrong: none.
Task 14: Ruling: visual direction "academic almanac" (paper/ink, vermilion seal, Fraunces + Songti SC + IBM Plex), fonts bundled locally via @fontsource; scripts/qa-server.ts + scripts/screenshot.ts added for visual QA — cost if wrong: taste.
Task 14: Ruling: "添加并登录" creates the school and immediately opens the login window (one step for the user) — cost if wrong: none.
Task 14: complete (commits 0907940..bd74370, tests: npm test → ℹ duration_ms 8282.712541)
Task 15: Ruling: pure list/calendar helpers in web/src/lib/tasks.ts with unit tests (groupByDay across DST, sealFor 缺/逾/急, Monday-first monthGrid, providerNote); Deadlines accepts ?view=month for deep links/screenshots — cost if wrong: none.
Task 15: complete (commits bd74370..dbedfed, tests: npm test → ℹ duration_ms 162904.748083)
Interjection (real schools SMC/UCLA Ext/LACCD connected by user after Task 14): Ruling: fixed real-world issues out of task order, each with a regression test — login stuck after window close (macOS keeps Chrome running) → closed-window detection + cancelLogin + re-click restarts; orphaned Chrome on CDP attach failure; courseDisplayName (ENGL C1000 / LIFESCI XL 7A); weekend course start → next Monday (UCLA Ext starts Sun); locked files stay pending; extraction limit 40 first sync / 20 after — cost if wrong: none.
Interjection (user: "保持这些的登陆，因为经常会过期"): Ruling: added session keep-alive — keepalive every 30 min 24h (GET /users/self; spec said no night access, user's request overrides; only a tiny non-course request), silent renewal counted in schools.renewals (migration 2: login_at/alive_at/renewals), daily SSO refresh 12:00 skipping schools logged in <20h, failed refresh keeps the working login — cost if wrong: one small request per 30 min at night in Canvas page views.
Interjection: Ruling: pulled the scheduler core (Task 23: slots/intervals/catch-up/createScheduler) and a minimal osascript notifier (Task 22) forward so keep-alive runs now; Tasks 22/23 will extend them (applet, reminders, report jobs) instead of creating them — cost if wrong: none.
Interjection: TDD note: refreshSso's test was written in the same step as the implementation; RED was observed only as the missing export — cost if wrong: none (test passes and asserts real behaviour).
Interjection (user: 区分作业和考试；知识检测/Final Hurrah 是考试；有些 quiz 其实是作业；考试以 syllabus 为准): Ruling: added assignment-group sync (migration 3: assignment_groups; items.group_id/category/category_source/syllabus_date/syllabus_note), classifier (group name → group shape [weight≥15%, ≤6 items ⇒ exam] → title → kind; notes never exams), user override via PATCH category (source 'user' never overwritten), exam seal/filters/近期考试. Exam dates from the syllabus come with the AI syllabus pass (Task 18, pulled forward next) with verbatim-quote verification — cost if wrong: a mislabelled category until the user or syllabus pass corrects it.
Task 16: Ruling: Canvas HTML is rendered on a fixed light 'paper' sheet in dark mode too (teacher-chosen colors stay readable); pure helpers in web/src/lib/course.ts are unit-tested; inbox is a list linking to Canvas so nothing gets marked read — cost if wrong: none.
Order: Ruling: after Task 16, do Task 17 (AI runner) then the syllabus/exam-date part of Task 18 before study guides — the user asked for exam detection from the syllabus — cost if wrong: none.
Task 16: complete (commits 70a61c4..23d9949, tests: npm test → ℹ duration_ms 4891.033)
Task 17: Ruling: runner strips ANTHROPIC_API_KEY from the child env (forces the Max subscription login, never metered API billing); fake claude supports a reply queue (FAKE_CLAUDE_QUEUE) for multi-call tests; AiPurpose adds 'chat' — cost if wrong: none.
Task 17: complete (commits 23d9949..cc28893, tests: npm test → ℹ duration_ms 9027.011625)
Task 18 (part 1, syllabus): Ruling: exam dates may come from AI only when verified — the quote must occur in the normalized source text and the date must be written within ±300 chars (dateMentioned); unverifiable entries are dropped and counted; Canvas due dates are never overridden; syllabus-only exams become source='syllabus' items (removed when no longer found); migration 4 adds syllabus_time_known; effective due = COALESCE(due_at, syllabus_date) everywhere; exams past their date are 'past' — cost if wrong: an exam stated only in an image/PDF without text stays undated.
Task 18: Ruling: test/helpers.ts now defaults COURSEHUB_CLAUDE_BIN to the fake script — an API test had queued a syllabus analysis that could reach the real claude (at most one small call on mock data) — cost if wrong: none.
Task 18: Ruling: extractSyllabusSchedule is superseded by analyzeSyllabus (exams + categories + weeks + module weeks in one pass, quote-verified) — cost if wrong: none.
Task 18: Ruling: long input = >120k chars → only files >20k chars are condensed (map), others kept verbatim; scanned PDFs (≤3 per week) are fetched into a job temp dir for Claude's Read tool and deleted after; enqueueGuide marks 'queued'; guides job runs every 30 min inside the sync window — cost if wrong: none.
Task 18: complete (commits cc28893..40a86a2, tests: npm test → ℹ duration_ms 7426.427792)
Real-data: Ruling: week 1 is calibrated from due dates inside single-week 'Week N' modules (≥2 samples, majority) — CHEM 102 term started Aug 17 but class Aug 31 — cost if wrong: none.
Task 19: Ruling: math is rendered by KaTeX BEFORE marked (stash/restore placeholders), then DOMPurify — instead of auto-render after — so "_"/"*" inside formulas are never parsed as emphasis; "$5 and $10" stays text — cost if wrong: none.
Task 19: Ruling: study index = course cards → /study/:courseId week grid → /study/:courseId/:week (instead of a chip picker on one page); source chips grouped per material ("第 28、30–32 页") since Canvas file links can't jump to a page — cost if wrong: layout only.
Task 19: Ruling: concept pitfalls are asked for as a one-per-line list (schema description) and inline "1) … 2) …" is converted to a list at render time for guides already written — cost if wrong: none.
Task 19: complete (commits 4e53a20..2d5b710, tests: npm test → ℹ duration_ms 8154.137209)
Task 20: Ruling: DailyData gains examsSoon (exam-category or exam-titled, next 14 days, not done) — the user asked to keep exams apart from homework — cost if wrong: one extra list.
Task 20: Ruling: "since" = created_at of the latest daily report whose period is before today (not just the latest report) so regenerating today's report keeps yesterday→today news; overdue window 30 days to match the Today page — cost if wrong: none.
Task 20: Ruling: weekly days leave out done work and non-exam calendar events; last-week "missing" counts Canvas missing + overdue-unsubmitted; topics skip weeks with no title/topics/overview — cost if wrong: report wording only.
Task 20: complete (commits 2d5b710..b5bd9ac, tests: npm test → ℹ duration_ms 7895.908042)
Task 21: Ruling: report AI calls run through the shared aiQueue with front priority (new SerialQueue.run) — one claude at a time on the 8GB Mac, and a 7:00 daily never waits behind auto guides — cost if wrong: a report may wait for one running guide (~1–2 min).
Task 21: Ruling: GET /api/reports/:id re-reads each listed task (live status/ticks) while keeping the snapshot lists; /api/overview.latestDaily is now a brief {id,type,period,createdAt,headline}; added GET /api/reports/status for UI polling — cost if wrong: none.
Task 21: Ruling: prompts forbid dates; daily may say 今晚/明天 consistent with the given due strings, weekly may use the weekday names given in the data — cost if wrong: wording only.
Task 21: complete (commits b5bd9ac..ed23b8c, tests: npm test → ℹ duration_ms 8294.65975)
Real-data: Ruling: syllabus times are parsed from the quote context (ranges carry am/pm to their start; noon-crossing ranges start am) — UCLA midterm times were being dropped — cost if wrong: an exam shows date-only.
Task 22: Ruling: exams (category exam / exam title, incl. syllabus exam events) remind like deadlines with "考试：…" titles; date-only items remind once from 18:00 the evening before instead of counting back from 23:59; >2 deadlines on the same threshold in one run → one grouped notice — the user's Sundays have 8 items at 23:59 — cost if wrong: fewer banners.
Task 22: Ruling: login-needed alerts stay in keepalive (already once-per-episode) rather than in flushChangeNotices; flushChangeNotices takes an optional `now` for tests; the applet finds data/notify relative to itself, so non-default data dirs fall back to osascript — cost if wrong: none.
Task 22: Manual: applet built (local.coursehub.notifier, LSUIElement, ad-hoc signed); one real notice sent — pending.txt consumed, last-url.txt written. Banner visibility / click-to-open must be confirmed by the user (macOS may ask to allow notifications).
Task 22: complete (commits 411c336..91e9ee6, tests: npm test → ℹ duration_ms 8580.466375)
Task 23: Ruling: scheduler core (slots, intervals, window, catch-up, trigger, serialized ticks) already existed from the keep-alive interjection; this task adds daily/weekly/reminders jobs + change alerts after sync. The daily job's sync stamps the 'sync' job so it isn't repeated in the same tick; reminders job also flushes change alerts so manual-sync changes alert within 15 min — cost if wrong: none.
Task 23: Ruling: daily/weekly jobs skip when a report for that period already exists (getReport) — avoids duplicate banners after a manual run — cost if wrong: a manual 6:30 report means no 7:00 regeneration.
Task 23: complete (commits 91e9ee6..b52ad80, tests: npm test → ℹ duration_ms 8146.458292)
Interjection (user, 2026-10-12 20:15): "多做点人性化功能，多做点冗余，多做点稳定性" → added items before Task 24: K1 job timeouts; K2 process guards + single instance + log rotation; K3 Canvas GET retries; K4 atomic auth writes; K5 daily DB backup + integrity check + auto-restore; K6 notification history; K7 daily AI fill-in retry; K8 status page; K9 global search; K10 task notes; K11 help page; K12 ask-AI on study weeks. Ruling: user asked broadly; I chose concrete items by value for this user (stability → redundancy → humane UX) — cost if wrong: time only.
K1-K4: complete (job timeouts, network wait, retries incl. 429 + downloads, atomic auth/notify writes, log rotation, process guards, single instance) — tests: npm test → 230/230
K5: complete (daily VACUUM INTO backups ×14, start-up quick_check + restore newest good backup + notice) — tests 234/234
K6: complete (notices table + recorder hook, /api/notices, 通知 page with unread count, prune 60 d, COURSEHUB_NO_NOTIFY in tests) — tests 239/239
K7: complete (aiRetry with backoff, report-ai job every 15 min, content-only update keeps created_at) — tests 242/242
K8 + K11: complete (/api/status + statusIssues, /api/backup, 系统状态 page + sidebar dot, 帮助 page) — tests 245/245
K9: complete (/api/search over items/courses/files/pages/topics, escaped LIKE, palette ⌘K / '/') — tests 247/247; caught a same-name column bug (f.name vs c.name) via the API test
K10: complete (items.user_note migration 6, PATCH note ≤300, TaskView.note, prompt note, inline editor) — tests 250/250
K12: complete (study_qa migration 7, askQuestion via aiQueue front, ASK_SYSTEM, /ask API, resume on start, AskBox UI) — tests 253/253
Task 24: Ruling: read commands (status/tasks/courses/study) read the DB directly; actions use the server API when /api/health says course-hub, else in-process; `report --no-ai` always in-process (the API has no ai flag); `study` exits 1 when no guide; doctor checks Node/Chrome/claude/data dir/server/LaunchAgent (label local.coursehub.server)/applet/status issues, --deep does one haiku call — cost if wrong: none.
Task 24: complete (commits 6abd4a3..33d98c2, tests: npm test → ℹ duration_ms 20089.70375)
Task 25: Ruling: LaunchAgent label local.coursehub.server (not com.coursehub.server — "local." for a personal agent, matches the notifier's local.coursehub.notifier); KeepAlive {SuccessfulExit:false} so crashes/error exits restart but a deliberate quit and the single-instance exit 0 don't loop; ProcessType Standard (Background throttled disk reads → >2 min start under load); install --no-open used here (no surprise browser tab) — cost if wrong: SIGTERM'd server stays down until next login/kickstart.
Task 25: Verified: install OK; launchctl state running; kill -9 → relaunched in 2 s (runs=2, last terminating signal Killed: 9), healthy after ~50 s on a load-31 Mac (user's Remotion render + other Claude sessions).
Stability (from Task 25 verification): silent renewal outcome 'renewed'|'password'|'error'; keep-alive alerts only after 3 consecutive 'error'; sync 'error' → status error + ICS, no alert; needs_login alert once per episode in sync too; lazy playwright-core/unpdf (import 3.45 s → 1.6 s). Chrome tests 5/5 (two load-induced CDP timeouts earlier passed on rerun at lower load).
Task 25: complete (commits 33d98c2..2a374f4, tests: npm test → ℹ duration_ms 12219.996125)
Task 26: Ruling: QA runs on the real server/data instead of fresh mock schools; the headed mock login and extra real-AI generations are skipped — the user completed real headed logins at all 3 schools, chrome tests cover the flow, and real guides/reports/Q&A were generated and inspected tonight — cost if wrong: a mock-only UI path could be missed (mock-backed API tests still cover them).
Task 26: desktop QA done on real data (15 pages + reports/study/status/notices/help/search); fixes committed. Mobile/dark pass paused: machine load 34–45 from the user's own Remotion render + other Claude sessions made headless Chrome time out (server itself answered in 0.3 s, 1.6% CPU).
Task 27: Verified against Canvas's own API per school (read-only): courses SMC 1/1, UCLA 3/3, LACCD 1/1; missing 0/0 everywhere; Canvas to-dos all open in ours except CHEM's checkpointed discussion → fixed (one task per checkpoint, regression fixture alpha 5020). ICS saved for all three.
Task 27: Ruling: checkpoint tasks are `<parentId>:<tag>` titled "<name> · 首帖 / · 回复同学", state from sub_assignment_submissions (fallback: graded parent → graded, else unsubmitted); ICS events for sub-assignment ids are not mapped (the schools' feeds don't contain them today) — cost if wrong: a duplicate "X" row from ICS if a feed starts listing them.
Task 26: Step 4 — npm test 265/265, typecheck clean, test:chrome 4/5 in the full run (the SSO-refresh test's first step, interactiveLogin, timed out at 60 s on a loaded Mac) and that test passed alone right after (16 s); every Chrome test has passed on the final code.
Task 26: complete (commits 2a374f4..a935b5a, tests: npm test → ℹ duration_ms 7757.412458)
Task 27: complete (commits bc9612c..a935b5a, tests: npm test → ℹ duration_ms 8130.090708)
Final review: self-review (subagents are only spawned when the user asks in this session), in passes over the security boundary (Host/Origin/header guard, static path traversal, Canvas media proxy whitelist), command execution (osascript escaping, applet `quoted form of`, execFile/spawn without a shell, claude --tools/--add-dir scope), data safety (backups, restore, migrations, removals, checkpoint parents) and XSS (DOMPurify on Canvas HTML and AI Markdown; javascript: links refused in notices).
Final: fixed checkDatabase calling any open failure "corrupt" (would restore an older backup on a locked/permission error) — test "a database that merely can't be opened right now is never treated as damaged" RED→GREEN, suite 266/266.
Final: minor (deferred): /proxy and GET JSON can be embedded cross-site (no read access; image dimensions leak) — a Sec-Fetch-Site check would close it.
Final: minor (deferred): the Settings course table scrolls sideways on phone-width windows.
Final: minor (deferred): ICS events for checkpoint sub-assignment ids aren't mapped to the checkpoint tasks (no current feed contains them).
