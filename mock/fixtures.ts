// Fixture data for two mock Canvas schools. All dates are relative to `now` so tests stay stable.
//  alpha: 3 active courses (week-named modules; "Module N" modules; an 8-week late-start course) + 1 concluded
//  beta:  2 courses with term dates only (no course dates); inbox messages
import { addDays, atLocal, localDateStr, mondayOf } from '../src/util/time.ts';
import { makeDocx, makePdf, makePptx } from './files.ts';

export interface MockSubmission {
  workflow_state: 'unsubmitted' | 'submitted' | 'graded' | 'pending_review';
  submitted_at: string | null; score: number | null; grade: string | null; late: boolean; missing: boolean; excused: boolean | null;
}
export interface MockAssignment {
  id: string; name: string; description: string; due_at: string | null; unlock_at?: string | null; lock_at?: string | null;
  points_possible: number | null; submission_types: string[]; is_quiz_assignment?: boolean; quiz_id?: string;
  discussion_topic_id?: string; external_url?: string; submission: MockSubmission;
}
export interface MockModuleItem {
  id: string; title: string; type: 'File' | 'Page' | 'Assignment' | 'Quiz' | 'Discussion' | 'ExternalUrl' | 'ExternalTool' | 'SubHeader';
  content_id?: string; page_url?: string; external_url?: string; position: number; indent?: number;
}
export interface MockModule { id: string; name: string; position: number; unlock_at: string | null; items: MockModuleItem[]; omitItems?: boolean }
export interface MockPage { page_id: string; url: string; title: string; body: string; updated_at: string; front_page: boolean }
export interface MockFile { id: string; display_name: string; content_type: string; size: number; updated_at: string; bytes: Buffer | null; locked?: boolean }
export interface MockTopic {
  id: string; title: string; message: string; posted_at: string; author: string; is_announcement: boolean;
  assignment_id?: string; unread_count: number; discussion_subentry_count: number;
}
export interface MockQuiz { id: string; title: string; due_at: string | null; quiz_type: string; assignment_id: string | null; points_possible: number | null }
export interface MockEvent { id: string; title: string; start_at: string; end_at: string; all_day: boolean; description: string }
export interface MockCourse {
  id: string; name: string; course_code: string; start_at: string | null; end_at: string | null;
  term: { id: string; name: string; start_at: string | null; end_at: string | null };
  restricted?: boolean; score: number | null; grade: string | null; syllabus_body: string | null; tabs: string[];
  filesListForbidden?: boolean; assignments: MockAssignment[]; quizzes: MockQuiz[]; modules: MockModule[];
  pages: MockPage[]; files: MockFile[]; topics: MockTopic[]; events: MockEvent[];
}
export interface MockPlannerExtra { type: 'planner_note' | 'wiki_page'; id: string; course_id: string | null; title: string; todo_date: string; page_url?: string }
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

export function buildFixtures(variant: 'alpha' | 'beta', now: Date = new Date()): MockData {
  const today = localDateStr(now);
  const at = (days: number, hh = 23, mm = 59) => atLocal(addDays(today, days), hh, mm).toISOString();
  const inHours = (h: number) => new Date(now.getTime() + h * 3_600_000).toISOString();
  const monday = mondayOf(now);
  const weekStart = (weeksAgo: number) => atLocal(addDays(monday, -7 * weeksAgo), 0, 0).toISOString();
  const weeksAfter = (startWeeksAgo: number, weeks: number) => atLocal(addDays(monday, -7 * startWeeksAgo + 7 * weeks - 1), 23, 59).toISOString();
  return variant === 'alpha' ? alpha() : beta();

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
      { id: '3160', title: 'Achieve: Chapter 6 Homework', type: 'Assignment', content_id: '5007', position: 11 },
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
      assignments: [
        asg('5001', 'Homework 5', at(-2), { submission: sub('graded', { submitted_at: at(-3, 20, 0), score: 9, grade: '9' }) }),
        asg('5002', 'Homework 6: Cell Respiration', at(0)),
        asg('5003', 'Lab Report 3', inHours(2), { points_possible: 20 }),
        asg('5004', 'Reading Quiz 6', at(1, 9, 0), { submission_types: ['online_quiz'], is_quiz_assignment: true, quiz_id: '802', points_possible: 5 }),
        asg('5005', 'Lab Report 2', at(-5), { points_possible: 20, submission: sub('unsubmitted', { missing: true }) }),
        asg('5006', 'Discussion: Ethics of GMOs', at(3), { submission_types: ['discussion_topic'], discussion_topic_id: '501' }),
        asg('5007', 'Achieve: Chapter 6 Homework', at(4), { submission_types: ['external_tool'], external_url: 'https://achieve.macmillanlearning.com/courses/abc/assignments/123' }),
        asg('5008', 'Lab safety signature', at(-3), { submission_types: ['on_paper'], points_possible: 0 }),
        asg('5009', 'Extra credit essay', null),
        asg('5010', 'Homework 4', at(-9), { submission: sub('unsubmitted', { excused: true }) }),
        asg('5011', 'Final Project', at(40), { points_possible: 100 }),
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
      assignments: [
        asg('7001', 'Essay 1 Draft', at(5), { points_possible: 50 }),
        asg('7002', 'Narrative paragraph', at(-3), { submission: sub('submitted', { submitted_at: at(-4) }) }),
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
}
