// Fixture data for three mock Canvas schools. All dates are relative to `now` so tests stay stable.
//  alpha: 3 active courses (week-named modules; "Module N" modules; an 8-week late-start course) + 1 concluded
//  beta:  2 courses with term dates only (no course dates); inbox messages
//  gamma: shapes seen in the user's real schools — peer reviews, "available until"-only work, presenter overrides,
//         checkpointed discussions, Achieve grade placeholders, announcements from before the course started,
//         and Pages/Quizzes/Files hidden from students
import { addDays, atLocal, localDateStr, mondayOf } from '../src/util/time.ts';
import { makeDocx, makePdf, makePptx } from './files.ts';

export interface MockSubmission {
  workflow_state: 'unsubmitted' | 'submitted' | 'graded' | 'pending_review';
  submitted_at: string | null; score: number | null; grade: string | null; late: boolean; missing: boolean; excused: boolean | null;
}
export interface MockAssignment {
  id: string; name: string; description: string; due_at: string | null; unlock_at?: string | null; lock_at?: string | null;
  points_possible: number | null; submission_types: string[]; is_quiz_assignment?: boolean; quiz_id?: string;
  discussion_topic_id?: string; external_url?: string; submission: MockSubmission; group?: string;
  /** a checkpointed discussion: no due date of its own; per-checkpoint due date and submission */
  checkpoints?: {
    tag: 'reply_to_topic' | 'reply_to_entry'; due_at: string; points_possible: number; submitted_at: string | null;
    sub_id?: string; done_in_planner?: boolean; required?: number;
  }[];
  /** the student is in a section/ad-hoc override: the ICS feed lists it as event-assignment-override-<id> "(N students)" */
  override?: { id: string; label: string };
  /** the student's own posts in this discussion (Canvas puts them in the submission as discussion_entries) */
  entries?: { id: string; parent_id: string | null }[];
  /** peer reviews: each student reviews this many classmates once they hand in */
  peer_review_count?: number;
  require_initial_post?: boolean;
  allowed_extensions?: string[];
  allowed_attempts?: number;
}
export interface MockModuleItem {
  id: string; title: string; type: 'File' | 'Page' | 'Assignment' | 'Quiz' | 'Discussion' | 'ExternalUrl' | 'ExternalTool' | 'SubHeader';
  content_id?: string; page_url?: string; external_url?: string; position: number; indent?: number;
  /** a module completion requirement and whether this student has met it */
  requirement?: { type: 'must_submit' | 'must_view' | 'must_contribute' | 'must_mark_done' | 'min_score'; min_score?: number; completed: boolean };
}
export interface MockModule {
  id: string; name: string; position: number; unlock_at: string | null; items: MockModuleItem[]; omitItems?: boolean;
  /** locked until the prerequisite modules are complete */
  state?: 'locked' | 'unlocked' | 'started' | 'completed'; prereqs?: string[];
}
export interface MockPage { page_id: string; url: string; title: string; body: string; updated_at: string; front_page: boolean }
export interface MockFile { id: string; display_name: string; content_type: string; size: number; updated_at: string; bytes: Buffer | null; locked?: boolean }
export interface MockTopic {
  id: string; title: string; message: string; posted_at: string | null; author: string; is_announcement: boolean;
  assignment_id?: string; unread_count: number; discussion_subentry_count: number; created_at?: string;
}
export interface MockQuiz { id: string; title: string; due_at: string | null; quiz_type: string; assignment_id: string | null; points_possible: number | null; time_limit?: number | null; allowed_attempts?: number }
export interface MockEvent { id: string; title: string; start_at: string; end_at: string; all_day: boolean; description: string }
export interface MockCourse {
  id: string; name: string; course_code: string; start_at: string | null; end_at: string | null;
  term: { id: string; name: string; start_at: string | null; end_at: string | null };
  restricted?: boolean; score: number | null; grade: string | null; syllabus_body: string | null; tabs: string[];
  filesListForbidden?: boolean; assignments: MockAssignment[]; quizzes: MockQuiz[]; modules: MockModule[];
  /** list endpoints a student gets 404/403 for when the teacher hid the tab (seen at SMC, UCLA Ext, LACCD) */
  apiHidden?: ('pages' | 'quizzes' | 'files')[];
  groups?: { id: string; name: string; weight: number; rules?: Record<string, number> }[];
  applyWeights?: boolean;
  /** user ids of the course's teachers (include[]=teachers) */
  teachers?: string[];
  /** who wrote each classmate's post the student replied to (discussion entry_list) */
  entryAuthors?: Record<string, string>;
  pages: MockPage[]; files: MockFile[]; topics: MockTopic[]; events: MockEvent[];
}
export interface MockPlannerExtra {
  type: 'planner_note' | 'wiki_page' | 'assessment_request' | (string & {}); id: string; course_id: string | null; title: string; todo_date: string; page_url?: string;
  assignment_id?: string; workflow_state?: 'assigned' | 'completed';
}
export interface MockConversation {
  id: string; subject: string; last_message: string; last_message_at: string; participants: { name: string }[];
  context_name: string; workflow_state: 'read' | 'unread';
}
export interface MockData {
  user: { id: string; name: string }; icsToken: string; token: string; courses: MockCourse[];
  plannerExtras: MockPlannerExtra[]; plannerDoneAssignments: Set<string>; conversations: MockConversation[];
}

const TABS_ALL = ['home', 'announcements', 'assignments', 'discussions', 'grades', 'modules', 'files', 'pages', 'syllabus', 'quizzes'];

function sub(state: MockSubmission['workflow_state'], extra: Partial<MockSubmission> = {}): MockSubmission {
  return { workflow_state: state, submitted_at: null, score: null, grade: null, late: false, missing: false, excused: null, ...extra };
}

function asg(id: string, name: string, due_at: string | null, extra: Partial<MockAssignment> = {}): MockAssignment {
  return { id, name, description: `<p>Instructions for ${name}.</p>`, due_at, points_possible: 10, submission_types: ['online_upload'], submission: sub('unsubmitted'), ...extra };
}

function file(id: string, display_name: string, content_type: string, updated_at: string, bytes: Buffer | null, size?: number): MockFile {
  return { id, display_name, content_type, updated_at, bytes, size: size ?? bytes?.length ?? 0 };
}

export function buildFixtures(variant: 'alpha' | 'beta' | 'gamma', now: Date = new Date()): MockData {
  const today = localDateStr(now);
  const at = (days: number, hh = 23, mm = 59) => atLocal(addDays(today, days), hh, mm).toISOString();
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
  const monday = mondayOf(now);
  const weekStart = (weeksAgo: number) => atLocal(addDays(monday, -7 * weeksAgo), 0, 0).toISOString();
  const weeksAfter = (startWeeksAgo: number, weeks: number) => atLocal(addDays(monday, -7 * startWeeksAgo + 7 * weeks - 1), 23, 59).toISOString();
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  /** "October 21st" for a day relative to today, the way syllabi write dates. */
  const spoken = (days: number) => {
    const d = new Date(Date.parse(at(days, 12, 0)));
    const n = d.getDate();
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th';
    return `${MONTHS[d.getMonth()]} ${n}${suffix}`;
  };
  return variant === 'alpha' ? alpha() : variant === 'beta' ? beta() : gamma();

  function alpha(): MockData {
    const fall = { id: '1', name: 'Fall 2026', start_at: weekStart(5), end_at: weeksAfter(5, 16) };
    const weekTopics = ['Intro to Biology', 'Chemistry of Life', 'Cells', 'Membranes', 'Metabolism', 'Cell Respiration', 'Photosynthesis', 'Cell Cycle'];
    const bioModules: MockModule[] = weekTopics.map((topic, i) => ({
      id: String(301 + i), name: `Week ${i + 1}: ${topic}`, position: i + 1, unlock_at: null,
      items: [{ id: String(3100 + i * 10), title: `Readings for week ${i + 1}`, type: 'SubHeader', position: 1 }],
    }));
    bioModules[4].items.push(
      { id: '3141', title: 'Lab 3 Instructions', type: 'File', content_id: '7003', position: 2 },
      { id: '3142', title: 'Homework 5', type: 'Assignment', content_id: '5001', position: 3 },
      { id: '3143', title: 'Lab Report 2', type: 'Assignment', content_id: '5005', position: 4 },
    );
    bioModules[5].items.push(
      { id: '3151', title: 'Week 6 Slides', type: 'File', content_id: '7001', position: 2 },
      { id: '3152', title: 'Week 6 Notes', type: 'File', content_id: '7002', position: 3 },
      { id: '3153', title: 'Week 6 Overview', type: 'Page', page_url: 'week-6-overview', position: 4 },
      { id: '3154', title: 'Homework 6: Cell Respiration', type: 'Assignment', content_id: '5002', position: 5 },
      { id: '3155', title: 'Reading Quiz 6', type: 'Quiz', content_id: '802', position: 6 },
      { id: '3156', title: 'Old lecture (2019)', type: 'File', content_id: '7004', position: 7 },
      { id: '3157', title: 'Broken upload', type: 'File', content_id: '7005', position: 8 },
      { id: '3158', title: 'Lecture recording', type: 'File', content_id: '7006', position: 9 },
      { id: '3159', title: 'Krebs cycle video', type: 'ExternalUrl', external_url: 'https://www.youtube.com/watch?v=krebs', position: 10 },
      // ids 3100 + 10·week are the weeks' "Readings" subheaders: keep clear of them
      { id: '3163', title: 'Achieve: Chapter 6 Homework', type: 'Assignment', content_id: '5007', position: 11 },
      { id: '3164', title: 'Lab Safety Discussion', type: 'Assignment', content_id: '5020', position: 20 },
      { id: '3161', title: 'Lab Report 3', type: 'Assignment', content_id: '5003', position: 12 },
    );
    bioModules[6].items.push(
      { id: '3171', title: 'Week 7 Overview', type: 'Page', page_url: 'week-7-overview', position: 2 },
      { id: '3172', title: 'Discussion: Ethics of GMOs', type: 'Discussion', content_id: '501', position: 3 },
    );
    bioModules[7].omitItems = true; // forces the /modules/:id/items call
    bioModules.push({
      id: '399', name: 'Course Resources', position: 99, unlock_at: null,
      items: [{ id: '3990', title: 'Syllabus (PDF)', type: 'File', content_id: '7007', position: 1 }],
    });

    const bio: MockCourse = {
      id: '101', name: 'BIO 3 - General Biology', course_code: 'BIO 3', start_at: weekStart(5), end_at: weeksAfter(5, 16), term: fall,
      score: 92.3, grade: 'A-', tabs: TABS_ALL,
      syllabus_body: '<h2>BIO 3 Syllabus</h2><p>Week 6: Cell Respiration. Week 7: Photosynthesis.</p>',
      groups: [
        { id: '91', name: 'Homework', weight: 25 }, { id: '92', name: 'Reading Quizzes', weight: 10 }, { id: '93', name: 'Labs', weight: 20 },
        { id: '94', name: 'Discussions', weight: 5 }, { id: '95', name: 'Knowledge Checks', weight: 30 }, { id: '96', name: 'Achieve', weight: 10 },
      ],
      assignments: [
        asg('5001', 'Homework 5', at(-2), { group: '91', submission: sub('graded', { submitted_at: at(-3, 20, 0), score: 9, grade: '9' }) }),
        asg('5002', 'Homework 6: Cell Respiration', at(0), { group: '91' }),
        asg('5003', 'Lab Report 3', inHours(2), { group: '93', points_possible: 20 }),
        asg('5004', 'Reading Quiz 6', at(1, 9, 0), { group: '92', submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '802', points_possible: 5 }),
        asg('5005', 'Lab Report 2', at(-5), { group: '93', points_possible: 20, submission: sub('unsubmitted', { missing: true }) }),
        asg('5006', 'Discussion: Ethics of GMOs', at(3), { group: '94', submission_types: ['discussion_topic'], discussion_topic_id: '501' }),
        asg('5007', 'Achieve: Chapter 6 Homework', at(4), { group: '96', submission_types: ['external_tool'], external_url: 'https://achieve.macmillanlearning.com/courses/abc/assignments/123' }),
        asg('5008', 'Lab safety signature', at(-3), { group: '93', submission_types: ['on_paper'], points_possible: 0 }),
        asg('5020', 'Lab Safety Discussion (Initial Post Due Thursday)', null, {
          group: '94', submission_types: ['discussion_topic'], submission: sub('pending_review', { submitted_at: at(-1, 10, 0) }),
          checkpoints: [
            { tag: 'reply_to_topic', due_at: at(1), points_possible: 5, submitted_at: at(-1, 10, 0) },
            { tag: 'reply_to_entry', due_at: at(4), points_possible: 5, submitted_at: null },
          ],
        }),
        asg('5009', 'Extra credit essay', null, { group: '91' }),
        asg('5010', 'Homework 4', at(-9), { group: '91', submission: sub('unsubmitted', { excused: true }) }),
        asg('5011', 'Final Project', at(40), { group: '91', points_possible: 100 }),
        asg('5012', 'Knowledge Check 2', null, { group: '95', points_possible: 100, submission_types: ['on_paper'] }),
      ],
      quizzes: [
        { id: '801', title: 'Practice Quiz (ungraded)', due_at: at(6), quiz_type: 'practice_quiz', assignment_id: null, points_possible: null },
        { id: '802', title: 'Reading Quiz 6', due_at: at(1, 9, 0), quiz_type: 'assignment', assignment_id: '5004', points_possible: 5 },
      ],
      modules: bioModules,
      pages: [
        { page_id: '59', url: 'home', title: 'Welcome to BIO 3', body: '<p>Welcome!</p>', updated_at: at(-40, 9, 0), front_page: true },
        {
          page_id: '60', url: 'week-6-overview', title: 'Week 6 Overview', updated_at: at(-8, 9, 0), front_page: false,
          body: '<h2>Week 6</h2><p>This week covers cellular respiration.</p>'
            + '<p><img src="/courses/101/files/7001/preview" alt="diagram"></p>'
            + '<p><img class="equation_image" src="/equation_images/C_6H_%7B12%7DO_6" alt="glucose"></p>'
            + '<p>Next: <a href="/courses/101/pages/week-7-overview">Week 7 overview</a></p>'
            + '<iframe src="https://www.youtube.com/embed/krebs"></iframe><script>alert(1)</script>',
        },
        { page_id: '61', url: 'week-7-overview', title: 'Week 7 Overview', body: '<p>Photosynthesis: light reactions and the Calvin cycle.</p>', updated_at: at(-1, 9, 0), front_page: false },
        {
          page_id: '62', url: 'class-schedule', title: 'Class Schedule (Updated When Needed)', updated_at: at(-3, 9, 0), front_page: false,
          body: `<h2>Lecture Schedule</h2><table><tr><td>6</td><td>Cell Respiration</td></tr><tr><td>7</td><td>Photosynthesis</td></tr></table>`
            + `<h3>Upcoming Exams</h3><ul><li>Knowledge Check 2, covering Chapters 5–6, will take place during lab on ${spoken(9)}.</li>`
            + `<li>Lab Practical (in person) on ${spoken(16)}.</li></ul>`,
        },
      ],
      files: [
        file('7001', 'Week6_Cell_Respiration.pdf', 'application/pdf', at(-8, 9, 0), makePdf([
          'Week 6: Cellular Respiration\nGlycolysis happens in the cytoplasm',
          'Krebs cycle (citric acid cycle)\nOccurs in the mitochondrial matrix',
          'Electron transport chain\nProduces most ATP via oxidative phosphorylation',
        ])),
        file('7002', 'Week6_Notes.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', at(-8, 9, 0), makePptx([
          { text: ['ATP yield', 'About 30-32 ATP per glucose'], notes: 'Remember the NADH shuttle' },
          { text: ['Fermentation', 'Lactic acid vs alcoholic fermentation'] },
        ])),
        file('7003', 'Lab3_Instructions.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', at(-15, 9, 0), makeDocx([
          'Lab 3: Measuring respiration rate', 'Use the respirometer to measure oxygen consumption.',
        ])),
        file('7004', 'Old_Lecture.ppt', 'application/vnd.ms-powerpoint', at(-60, 9, 0), Buffer.from('legacy binary ppt')),
        file('7005', 'corrupt.pdf', 'application/pdf', at(-8, 9, 0), Buffer.from('this is not really a pdf')),
        file('7006', 'lecture-video.mp4', 'video/mp4', at(-8, 9, 0), null, 300 * 1024 * 1024),
        file('7007', 'Syllabus_BIO3.pdf', 'application/pdf', at(-40, 9, 0), makePdf([
          'BIO 3 Syllabus\nWeek 1: Intro to Biology\nWeek 2: Chemistry of Life\nWeek 6: Cell Respiration\nWeek 7: Photosynthesis',
        ])),
      ],
      topics: [
        { id: '401', title: 'Welcome to BIO 3', message: '<p>Glad to have you.</p>', posted_at: at(-30, 9, 0), author: 'Dr. Rivera', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 },
        { id: '402', title: 'Midterm review session', message: '<p>Review on Thursday at 5pm.</p>', posted_at: inHours(-20), author: 'Dr. Rivera', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 },
        { id: '501', title: 'Discussion: Ethics of GMOs', message: '<p>Post your view.</p>', posted_at: at(-6, 9, 0), author: 'Dr. Rivera', is_announcement: false, assignment_id: '5006', unread_count: 3, discussion_subentry_count: 12 },
        { id: '502', title: 'Introduce yourself', message: '<p>Say hi.</p>', posted_at: at(-34, 9, 0), author: 'Dr. Rivera', is_announcement: false, unread_count: 0, discussion_subentry_count: 25 },
      ],
      events: [
        { id: '9001', title: 'Midterm Exam', start_at: at(8, 10, 0), end_at: at(8, 11, 30), all_day: false, description: 'Chapters 1-7' },
      ],
    };

    const mathModules: MockModule[] = [
      { id: '310', name: 'Module 0: Start Here', position: 0, unlock_at: null, items: [{ id: '3200', title: 'Welcome', type: 'Page', page_url: 'math-welcome', position: 1 }] },
      { id: '311', name: 'Module 1: Limits', position: 1, unlock_at: null, items: [
        { id: '3210', title: 'Limits slides', type: 'File', content_id: '7101', position: 1 },
        { id: '3211', title: 'Homework 1', type: 'Assignment', content_id: '6003', position: 2 },
      ] },
      { id: '312', name: 'Module 2: Derivatives', position: 2, unlock_at: null, items: [{ id: '3220', title: 'Homework 2', type: 'Assignment', content_id: '6004', position: 1 }] },
      { id: '313', name: 'Module 3: Rules of Differentiation', position: 3, unlock_at: null, items: [{ id: '3230', title: 'WebAssign 3.1', type: 'Assignment', content_id: '6001', position: 1 }] },
      { id: '314', name: 'Module 4: Applications', position: 4, unlock_at: null, items: [{ id: '3240', title: 'Quiz 3', type: 'Assignment', content_id: '6002', position: 1 }] },
    ];
    const math: MockCourse = {
      id: '102', name: 'MATH 7 - Calculus I', course_code: 'MATH 7', start_at: weekStart(5), end_at: weeksAfter(5, 16), term: fall,
      score: 88.5, grade: 'B+', tabs: TABS_ALL.filter((t) => t !== 'files'), filesListForbidden: true, syllabus_body: null,
      assignments: [
        asg('6001', 'WebAssign 3.1', at(1), { submission_types: ['external_tool'], external_url: 'https://www.webassign.net/web/Student/Assignment-Responses/last?dep=123' }),
        asg('6002', 'Quiz 3', at(6), { submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '811' }),
        asg('6003', 'Homework 1', at(-25), { submission: sub('graded', { submitted_at: at(-26), score: 10, grade: '10' }) }),
        asg('6004', 'Homework 2', at(-11), { submission: sub('submitted', { submitted_at: at(-12) }) }),
      ],
      quizzes: [{ id: '811', title: 'Quiz 3', due_at: at(6), quiz_type: 'assignment', assignment_id: '6002', points_possible: 10 }],
      modules: mathModules,
      pages: [{ page_id: '70', url: 'math-welcome', title: 'Start Here', body: '<p>Read the syllabus first.</p>', updated_at: at(-36, 9, 0), front_page: true }],
      files: [file('7101', 'Limits_Slides.pdf', 'application/pdf', at(-30, 9, 0), makePdf(['Limits\nThe limit of f(x) as x approaches a', 'One-sided limits']))],
      topics: [{ id: '411', title: 'Office hours moved', message: '<p>Now on Wednesdays.</p>', posted_at: at(-2, 9, 0), author: 'Prof. Chen', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 }],
      events: [],
    };

    const late = { id: '2', name: 'Fall 2026 Late Start', start_at: weekStart(1), end_at: weeksAfter(1, 8) };
    const engl: MockCourse = {
      id: '103', name: 'ENGL 1A - College Composition', course_code: 'ENGL 1A', start_at: weekStart(1), end_at: weeksAfter(1, 8), term: late,
      score: null, grade: null, tabs: ['home', 'announcements', 'assignments', 'modules', 'grades'], syllabus_body: null,
      // due inside their modules' weeks whatever today's weekday (last Friday, this Sunday): relative-to-today dates
      // put both a week late from Thursday on, and the week calibration rightly moved the course a week
      assignments: [
        asg('7001', 'Essay 1 Draft', atLocal(addDays(monday, 6), 23, 59).toISOString(), { points_possible: 50 }),
        asg('7002', 'Narrative paragraph', atLocal(addDays(monday, -3), 23, 59).toISOString(), { submission: sub('submitted', { submitted_at: atLocal(addDays(monday, -4), 20, 0).toISOString() }) }),
      ],
      quizzes: [],
      modules: [
        { id: '320', name: 'Week 1: Narrative', position: 1, unlock_at: null, items: [{ id: '3300', title: 'Narrative paragraph', type: 'Assignment', content_id: '7002', position: 1 }] },
        { id: '321', name: 'Week 2: Description', position: 2, unlock_at: null, items: [{ id: '3310', title: 'Essay 1 Draft', type: 'Assignment', content_id: '7001', position: 1 }] },
      ],
      pages: [], files: [], topics: [], events: [],
    };

    const spring = { id: '0', name: 'Spring 2026', start_at: at(-260, 0, 0), end_at: at(-120) };
    const chem: MockCourse = {
      id: '104', name: 'CHEM 1A (Spring 2026)', course_code: 'CHEM 1A', start_at: at(-260, 0, 0), end_at: at(-120), term: spring,
      score: 90, grade: 'A-', tabs: ['home'], syllabus_body: null,
      assignments: [asg('8801', 'Old lab', at(-130))], quizzes: [], modules: [], pages: [], files: [], topics: [], events: [],
    };
    const restricted: MockCourse = {
      ...chem, id: '105', name: 'Restricted', course_code: 'R', restricted: true, assignments: [],
    };

    return {
      user: { id: '9001', name: 'Ewan Wu' }, icsToken: 'alpha-ics-token', token: 'mock-token',
      courses: [bio, math, engl, chem, restricted],
      plannerExtras: [
        { type: 'planner_note', id: '71', course_id: '101', title: 'Study group for BIO midterm', todo_date: at(1, 16, 0) },
        { type: 'wiki_page', id: '61', course_id: '101', title: 'Week 7 Overview', todo_date: at(5, 12, 0), page_url: 'week-7-overview' },
      ],
      plannerDoneAssignments: new Set(['5006']),
      conversations: [
        { id: '2001', subject: 'Lab partner?', last_message: 'Want to pair up for lab 3?', last_message_at: inHours(-50), participants: [{ name: 'Sam Lee' }, { name: 'Ewan Wu' }], context_name: 'BIO 3', workflow_state: 'unread' },
      ],
    };
  }

  function beta(): MockData {
    const term = { id: '7', name: 'Fall 2026', start_at: weekStart(4), end_at: weeksAfter(4, 16) };
    const psych: MockCourse = {
      id: '201', name: 'PSYCH 1 - Intro to Psychology', course_code: 'PSYCH 1', start_at: null, end_at: null, term,
      score: 95, grade: 'A', tabs: TABS_ALL, syllabus_body: '<p>Read one chapter per week.</p>',
      assignments: [
        asg('8001', 'Chapter 5 Quiz', at(1), { submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '821' }),
        asg('8002', 'Reflection Paper', at(10), { points_possible: 50 }),
        asg('8003', 'Achieve HW: Chapter 5', at(2), { submission_types: ['external_tool'], external_url: 'https://www.macmillanlearning.com/achieve/assignment/555' }),
        asg('8004', 'Chapter 1 Quiz', at(-21), { submission: sub('graded', { submitted_at: at(-22), score: 9, grade: '9' }) }),
        asg('8005', 'Chapter 2 Quiz', at(-14), { submission: sub('graded', { submitted_at: at(-15), score: 10, grade: '10' }) }),
        asg('8006', 'Chapter 3 Quiz', at(-7), { submission: sub('graded', { submitted_at: at(-8), score: 8, grade: '8' }) }),
      ],
      quizzes: [{ id: '821', title: 'Chapter 5 Quiz', due_at: at(1), quiz_type: 'assignment', assignment_id: '8001', points_possible: 10 }],
      modules: [
        { id: '401', name: 'Getting Started', position: 0, unlock_at: null, items: [{ id: '4000', title: 'Welcome', type: 'Page', page_url: 'psych-welcome', position: 1 }] },
        { id: '402', name: 'Module 1: History of Psychology', position: 1, unlock_at: null, items: [{ id: '4010', title: 'Chapter 1 Quiz', type: 'Assignment', content_id: '8004', position: 1 }] },
        { id: '403', name: 'Module 2: Research Methods', position: 2, unlock_at: null, items: [{ id: '4020', title: 'Chapter 2 Quiz', type: 'Assignment', content_id: '8005', position: 1 }] },
        { id: '404', name: 'Module 3: Biopsychology', position: 3, unlock_at: null, items: [{ id: '4030', title: 'Chapter 3 Quiz', type: 'Assignment', content_id: '8006', position: 1 }] },
        { id: '405', name: 'Module 4: Sensation & Perception', position: 4, unlock_at: null, items: [
          { id: '4040', title: 'Chapter 4 slides', type: 'File', content_id: '8101', position: 1 },
          { id: '4041', title: 'Chapter 5 Quiz', type: 'Assignment', content_id: '8001', position: 2 },
        ] },
        { id: '406', name: 'Module 5: Memory', position: 5, unlock_at: null, items: [{ id: '4050', title: 'Reflection Paper', type: 'Assignment', content_id: '8002', position: 1 }] },
      ],
      pages: [{ page_id: '90', url: 'psych-welcome', title: 'Welcome to PSYCH 1', body: '<p>Hello class</p>', updated_at: at(-28, 9, 0), front_page: true }],
      files: [file('8101', 'Ch4_Sensation.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', at(-6, 9, 0), makePptx([
        { text: ['Sensation vs Perception', 'Transduction converts stimuli into neural signals'], notes: 'Absolute threshold example' },
      ]))],
      topics: [{ id: '601', title: 'Exam 1 grades posted', message: '<p>Check your grades.</p>', posted_at: at(-1, 10, 0), author: 'Prof. Lee', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 }],
      events: [],
    };
    const hist: MockCourse = {
      id: '202', name: 'HIST 11 - US History', course_code: 'HIST 11', start_at: null, end_at: null, term,
      score: null, grade: null, tabs: ['home', 'announcements', 'assignments', 'modules', 'grades', 'files'], syllabus_body: null,
      assignments: [
        asg('9001', 'Primary source analysis', at(0, 18, 0), { submission: sub('submitted', { submitted_at: at(-1, 15, 0) }) }),
      ],
      quizzes: [],
      modules: [1, 2, 3, 4, 5].map((w) => ({
        id: String(500 + w), name: `Week ${w}: ${['Colonial America', 'Revolution', 'Early Republic', 'Federalism', 'The Constitution'][w - 1]}`,
        position: w, unlock_at: null,
        items: w === 5 ? [{ id: '5050', title: 'Primary source analysis', type: 'Assignment' as const, content_id: '9001', position: 1 }] : [],
      })),
      pages: [], files: [],
      topics: [{ id: '611', title: 'Welcome to HIST 11', message: '<p>Welcome</p>', posted_at: at(-27, 9, 0), author: 'Dr. Park', is_announcement: true, unread_count: 0, discussion_subentry_count: 0 }],
      events: [],
    };
    return {
      user: { id: '9002', name: 'Ewan Wu' }, icsToken: 'beta-ics-token', token: 'mock-token',
      courses: [psych, hist],
      plannerExtras: [],
      plannerDoneAssignments: new Set(),
      conversations: [
        { id: '3001', subject: 'Question about Chapter 5', last_message: 'See page 142.', last_message_at: inHours(-30), participants: [{ name: 'Prof. Lee' }, { name: 'Ewan Wu' }], context_name: 'PSYCH 1', workflow_state: 'unread' },
        { id: '3002', subject: 'Welcome', last_message: 'Welcome to class', last_message_at: inHours(-400), participants: [{ name: 'Dr. Park' }, { name: 'Ewan Wu' }], context_name: 'HIST 11', workflow_state: 'read' },
      ],
    };
  }
  function gamma(): MockData {
    const DAY = 86_400_000;
    const term = { id: '9', name: 'Fall 2026', start_at: weekStart(6), end_at: weeksAfter(6, 16) };
    const before = (iso: string, days: number) => new Date(Date.parse(iso) - days * DAY).toISOString();
    const ann = (id: string, title: string, posted_at: string | null, extra: Partial<MockTopic> = {}): MockTopic => ({
      id, title, message: `<p>${title}</p>`, posted_at, author: 'Instructor', is_announcement: true, unread_count: 0, discussion_subentry_count: 0, ...extra,
    });
    // the next Sunday after today, 11:59 PM: a week's discussion deadline
    const sunday = (() => {
      const d = new Date(Date.parse(at(0, 12, 0)));
      return at((7 - d.getDay()) % 7 || 7);
    })();
    // like SMC ENGL C1000: peer reviews, a survey that only has an "available until", presenters on an override, hidden tabs,
    // discussions whose instructions ask for replies, and a peer-review grade column
    const engl: MockCourse = {
      id: '301', name: '2026 Fall - ENGL C1000 (2074) - Academic Reading and Writing (O)', course_code: 'ENGL C1000',
      start_at: weekStart(6), end_at: weeksAfter(6, 12), term, score: 91, grade: 'A-', syllabus_body: '<p>Essays, presentations and peer reviews.</p>',
      tabs: ['home', 'modules', 'announcements', 'assignments', 'discussions', 'grades', 'syllabus'], apiHidden: ['pages', 'quizzes', 'files'],
      assignments: [
        asg('7101', 'Essay #2: Rough Draft', at(-3), { submission: sub('submitted', { submitted_at: at(-4, 20, 0) }), peer_review_count: 3 }),
        asg('7102', 'Course Survey', null, { lock_at: at(9), submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '7801', points_possible: 0 }),
        asg('7103', 'Presentations: The First Half', at(5), { override: { id: '225628', label: '11 students' } }),
        asg('7104', 'Extra Credit: Media Critique', null, { lock_at: at(-8), submission: sub('graded', { score: 5, grade: '5' }) }),
        // the main post is in, one of the two replies is missing: Canvas already says "submitted"
        asg('7105', "Discussion: What's Your Topic?", at(1), {
          submission_types: ['discussion_topic'], discussion_topic_id: '7355', points_possible: 20,
          description: '<p>Here we\'re going to throw around some ideas. So for this assignment, you need to:</p><ul><li>Write at least 100 words explaining your comparison. Tell us what it is, and why you think it will be a good comparison.</li><li>Reply at least two times to other students with questions, critiques, or suggestions.</li></ul>',
          submission: sub('submitted', { submitted_at: at(-6, 19, 52) }), entries: [{ id: '9100', parent_id: null }, { id: '9101', parent_id: '9201' }],
        }),
        asg('7106', 'Discussion: Source Analysis', at(6), {
          submission_types: ['discussion_topic'], discussion_topic_id: '7356', points_possible: 20, entries: [],
          description: '<p>Write a review of the website of one of the following information sources.</p><p>Explain why you think these are good or bad academic research sources, about 200-300 words total.</p><p>IMPORTANT CAVEAT: NO DOUBLES. READ THE THREAD BEFORE POSTING.</p>',
        }),
        asg('7107', 'Peer Reviews for Bradbury Draft', at(4), {
          submission_types: ['none'], points_possible: 30,
          description: '<p>You will be assigned three of your colleagues\' rough drafts to review.</p><p>Note: you won\'t be assigned any peer reviews until you submit your own rough draft. Three thoughtful peer reviews = 30 points.</p>',
        }),
        // an earlier deadline only the title gives
        asg('7109', 'Syllabus Quiz!', at(-20), {
          submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '7811', points_possible: 15, submission: sub('graded', { score: 10, grade: '10' }),
        }),
        asg('7108', 'Week 8 Discussion (Initial Post Due Thursday)', sunday, {
          submission_types: ['discussion_topic'], discussion_topic_id: '7357', points_possible: 25, entries: [],
          description: '<p>Share one example, then respond to at least two classmates.</p>',
        }),
      ],
      teachers: ['9050'],
      entryAuthors: { '9201': 'u-sean', '9202': 'u-carol', '9203': '9050' },
      quizzes: [],
      modules: [
        // a minimum score unlocks the course (like SMC's syllabus quiz / UCLA's policy training): 10 of 15 isn't enough
        { id: '7160', name: 'Start Here', position: 0, unlock_at: null, state: 'started', items: [
          { id: '7161', title: 'Read: Course Policies', type: 'Page', page_url: 'course-policies', position: 1, requirement: { type: 'must_view', completed: false } },
          { id: '7162', title: 'Syllabus Quiz!', type: 'Assignment', content_id: '7109', position: 2, requirement: { type: 'min_score', min_score: 12, completed: false } },
        ] },
        { id: '7150', name: 'Week 7, Module 7', position: 1, unlock_at: null, items: [
          { id: '7151', title: 'Essay #2: Rough Draft', type: 'Assignment', content_id: '7101', position: 1, requirement: { type: 'must_submit', completed: true } },
          { id: '7152', title: 'Presentations: The First Half', type: 'Assignment', content_id: '7103', position: 2 },
        ] },
        { id: '7170', name: 'Week 8, Module 8', position: 2, unlock_at: null, state: 'locked', prereqs: ['7160'], items: [
          { id: '7171', title: 'Week 8 Discussion (Initial Post Due Thursday)', type: 'Assignment', content_id: '7108', position: 1 },
        ] },
      ],
      pages: [{ page_id: '7190', url: 'course-policies', title: 'Read: Course Policies', body: '<p>Late work loses 10% per day.</p>', updated_at: at(-30, 9, 0), front_page: false }],
      files: [], events: [],
      topics: [
        ann('7201', 'Welcome to English C1000!', before(weekStart(6), 2)),
        ann('7202', 'New York Times on Freedom Of Speech', null, { created_at: before(weekStart(6), 55) }),
        ann('7203', 'Week 7, Module 7!', at(-1, 16, 0)),
      ],
    };
    // like LACCD CHEM 102: 23:59 homework (all-day in the ICS feed), timed lab reports, checkpointed discussions
    const chem: MockCourse = {
      id: '302', name: 'CHEM 102 : General Chemistry II - FALL 2026', course_code: 'CHEM_102_17218FA26W',
      start_at: weekStart(6), end_at: weeksAfter(6, 16), term, score: 88, grade: 'B+', syllabus_body: null,
      tabs: ['home', 'announcements', 'modules', 'discussions', 'grades'], apiHidden: ['pages', 'quizzes', 'files'],
      assignments: [
        asg('7301', 'Chapter 18 Homework', at(2)),
        asg('7302', 'Exp #24: A Rate Law and Activation Energy', at(1, 16, 25), { override: { id: '789771', label: '3 students' } }),
        asg('7303', 'Titrations in the Real World Discussion', null, {
          submission_types: ['discussion_topic'], discussion_topic_id: '7351', submission: sub('unsubmitted'),
          checkpoints: [
            { tag: 'reply_to_topic', due_at: at(3), points_possible: 25, submitted_at: null, sub_id: '10449536' },
            { tag: 'reply_to_entry', due_at: at(6), points_possible: 10, submitted_at: null, sub_id: '10449537', required: 2 },
          ],
        }),
        // Canvas marks "Required Replies (2)" submitted at the first reply
        asg('7305', 'Faster Reaction or More Product? - Initial Response Due Thursday', null, {
          submission_types: ['discussion_topic'], discussion_topic_id: '7358', require_initial_post: true,
          description: '<p>A complete grade means that you have:</p><ul><li>Posted an initial response that answers all four questions.</li><li>Replied to at least two different classmates . In each reply, evaluate one specific prediction.</li></ul>',
          submission: sub('pending_review', { submitted_at: at(-2, 17, 0) }),
          entries: [{ id: '9300', parent_id: null }, { id: '9301', parent_id: '9401' }],
          checkpoints: [
            { tag: 'reply_to_topic', due_at: at(-1), points_possible: 25, submitted_at: at(-2, 17, 0), sub_id: '10392524' },
            { tag: 'reply_to_entry', due_at: at(2), points_possible: 25, submitted_at: at(-2, 17, 20), sub_id: '10392525', required: 2 },
          ],
        }),
        asg('7304', 'Experiment 34: Share and compare results', null, {
          submission_types: ['discussion_topic'], discussion_topic_id: '7352', submission: sub('pending_review', { submitted_at: at(-4, 19, 0) }),
          checkpoints: [
            { tag: 'reply_to_topic', due_at: at(-3), points_possible: 10, submitted_at: at(-4, 19, 0), sub_id: '9911994' },
            { tag: 'reply_to_entry', due_at: at(-1), points_possible: 5, submitted_at: null, sub_id: '9911995', required: 1, done_in_planner: true },
          ],
        }),
        asg('7306', 'Titrations and pH Curves', at(5), {
          submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '7810', points_possible: 100,
          description: '<p>Digital Lab Submission Reminders:</p><ul><li>You will have one attempt to complete this assignment.</li><li>Do not push the "submit" button until you have completed the assignment. There is no way to unsubmit assignments.</li><li>You may only complete the assignment if you are physically in the lab.</li></ul>',
        }),
        asg('7307', 'Lab report upload', at(4), { allowed_extensions: ['pdf'] }),
        // a PlayPosit lecture video that still carries a file-type setting: nothing is uploaded
        asg('7308', '19.6 Gibbs Free Energy', at(5), { submission_types: ['external_tool'], external_url: 'https://www.playposit.com/lti/1.3/launch', allowed_extensions: ['pdf'], points_possible: 2 }),
      ],
      teachers: ['9051'],
      entryAuthors: { '9401': 'u-dana' },
      groups: [{ id: '95', name: 'Lab', weight: 25, rules: { drop_lowest: 2 } }, { id: '96', name: 'Knowledge Checks', weight: 25 }],
      applyWeights: true,
      quizzes: [], pages: [], files: [], events: [],
      modules: [{ id: '7350', name: 'Chapter 18 | Week 7', position: 1, unlock_at: null, items: [
        { id: '7353', title: 'Chapter 18 Homework', type: 'Assignment', content_id: '7301', position: 1 },
        { id: '7354', title: 'Titrations in the Real World Discussion', type: 'Discussion', content_id: '7351', position: 2 },
      ] }],
      topics: [
        ann('7361', 'Knowledge Check #2', at(-2, 14, 40)),
        { id: '7351', title: 'Titrations in the Real World Discussion', message: '<p>Pick one titration.</p>', posted_at: at(-2, 9, 0), author: 'Instructor', is_announcement: false, assignment_id: '7303', unread_count: 0, discussion_subentry_count: 4 },
        { id: '7352', title: 'Experiment 34: Share and compare results', message: '<p>Share.</p>', posted_at: at(-9, 9, 0), author: 'Instructor', is_announcement: false, assignment_id: '7304', unread_count: 0, discussion_subentry_count: 30 },
      ],
    };
    // like UCLA Ext LIFESCI XL 7A: Achieve grade placeholders (no dates, nothing to submit) + Achieve links in modules
    const bio: MockCourse = {
      id: '303', name: '409680: Cell and Molecular Biology LIFESCI XL 7A (Fall 2026)', course_code: '409680',
      start_at: weekStart(4), end_at: weeksAfter(4, 12), term, score: null, grade: null, syllabus_body: null,
      tabs: ['home', 'announcements', 'modules', 'assignments', 'discussions', 'quizzes', 'grades'], apiHidden: ['pages', 'files'],
      assignments: [
        asg('7401', 'Achieve Category:  Week 1', null, { submission_types: ['none'], points_possible: 16, submission: sub('graded', { score: 15, grade: '15' }) }),
        asg('7402', 'Achieve Category:  Week 2', null, { submission_types: ['none'], points_possible: 33, submission: sub('graded', { score: 30, grade: '30' }) }),
        asg('7403', 'Achieve Category:  Week 5', null, { submission_types: ['none'], points_possible: 0 }),
        asg('7404', 'Week 4 Pre-Class Reading Guide Submission', at(1, 18, 30), { submission_types: ['online_text_entry', 'online_upload'], points_possible: 5 }),
      ],
      quizzes: [], pages: [], files: [], events: [],
      modules: [{ id: '7450', name: 'Achieve eBook', position: 1, unlock_at: null, items: [
        { id: '7452', title: 'Achieve E-book Link', type: 'ExternalTool', external_url: 'https://lmslink.bfwpub.com/index.php?custom_action=openItem&custom_resource_id=mwtool_602&custom_template_root=&custom_course_id=3de09d3e-5572-4b21-9c29-76961c25e2bc', position: 1 },
        { id: '7451', title: 'Achieve Assignments Link', type: 'ExternalTool', external_url: 'https://lmslink.bfwpub.com/index.php?custom_action=openItem&custom_resource_id=mwtool_600&custom_template_root=&custom_course_id=3de09d3e-5572-4b21-9c29-76961c25e2bc', position: 2 },
      ] }],
      topics: [ann('7461', 'First Class Meeting', at(-20, 12, 38))],
    };
    // like UCLA Ext MATH XL 33A: a must-read announcement posted before the first day
    const math: MockCourse = {
      id: '304', name: '410199: Linear Algebra MATH XL 33A (Fall 2026)', course_code: '410199',
      start_at: weekStart(3), end_at: weeksAfter(3, 12), term, score: null, grade: null, syllabus_body: null,
      tabs: ['home', 'announcements', 'modules', 'assignments', 'grades'], apiHidden: ['pages', 'quizzes', 'files'],
      assignments: [asg('7601', 'HW 2', at(9)), asg('7602', 'Exam 1', at(-5), { submission: sub('graded', { score: 90, grade: '90' }) })],
      quizzes: [], pages: [], files: [], events: [],
      modules: [{ id: '7650', name: 'Week 4: Subspaces and their Dimensions', position: 4, unlock_at: null, items: [{ id: '7651', title: 'HW 2', type: 'Assignment', content_id: '7601', position: 1 }] }],
      topics: [ann('7661', '[MUST READ] Week 1 Lectures moved to Sunday 6PM', before(weekStart(3), 4))],
    };
    return {
      user: { id: '9003', name: 'Ewan Wu' }, icsToken: 'gamma-ics-token', token: 'mock-token',
      courses: [engl, chem, bio, math],
      plannerExtras: [
        { type: 'assessment_request', id: '239991', course_id: '301', title: 'Essay #2: Rough Draft', todo_date: at(2), assignment_id: '7101', workflow_state: 'assigned' },
        { type: 'assessment_request', id: '239992', course_id: '301', title: 'Essay #2: Rough Draft', todo_date: at(2), assignment_id: '7101', workflow_state: 'completed' },
      ],
      plannerDoneAssignments: new Set(),
      conversations: [],
    };
  }
}
