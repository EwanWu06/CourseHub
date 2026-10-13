import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startHttp } from './helpers.ts';
import { parseIcs, fetchIcs } from '../src/canvas/ics.ts';

const ICS = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Instructure//Canvas//EN',
  'CALSCALE:GREGORIAN',
  'X-WR-CALNAME:Ewan Wu Calendar (Alpha College)',
  'BEGIN:VEVENT',
  'DTEND:20261016T065900Z',
  'DTSTAMP:20261012T000000Z',
  'DTSTART:20261016T065900Z',
  'DESCRIPTION:Read chapter 4 and answer the questions about cell respiration',
  '  and photosynthesis.',
  'SUMMARY:Homework 4: Cell Respiration [BIO 3]',
  'URL;VALUE=URI:https://alpha.instructure.com/courses/101/assignments/5001',
  'UID:event-assignment-5001',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261020',
  'DTEND;VALUE=DATE:20261021',
  'SUMMARY:No class - Campus holiday [BIO 3]',
  'UID:event-calendar-event-77',
  'URL;VALUE=URI:https://alpha.instructure.com/calendar?event_id=77&include_contexts=course_101',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261022T170000Z',
  'DTEND:20261022T183000Z',
  'SUMMARY:Midterm Exam [MATH 7]',
  'UID:event-calendar-event-9',
  'URL;VALUE=URI:https://alpha.instructure.com/calendar?event_id=9&include_contexts=course_42',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART:20261023T170000Z',
  'SUMMARY:Office hours',
  'UID:abc@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('parses a Canvas assignment event with folded description', () => {
  const [a] = parseIcs(ICS);
  assert.equal(a.uid, 'event-assignment-5001');
  assert.equal(a.kind, 'assignment');
  assert.equal(a.canvasId, '5001');
  assert.equal(a.courseCanvasId, '101');
  assert.equal(a.title, 'Homework 4: Cell Respiration');
  assert.equal(a.courseLabel, 'BIO 3');
  assert.equal(a.start, '2026-10-16T06:59:00.000Z');
  assert.equal(a.allDay, false);
  assert.equal(a.url, 'https://alpha.instructure.com/courses/101/assignments/5001');
  assert.equal(a.description, 'Read chapter 4 and answer the questions about cell respiration and photosynthesis.');
});

test('all-day calendar events start at local midnight', () => {
  const e = parseIcs(ICS)[1];
  assert.equal(e.kind, 'event');
  assert.equal(e.canvasId, '77');
  assert.equal(e.courseCanvasId, '101');
  assert.equal(e.allDay, true);
  assert.equal(e.start, '2026-10-20T07:00:00.000Z');
  assert.equal(e.end, '2026-10-21T07:00:00.000Z');
});

test('course id comes from include_contexts for calendar events', () => {
  const e = parseIcs(ICS)[2];
  assert.equal(e.courseCanvasId, '42');
  assert.equal(e.title, 'Midterm Exam');
  assert.equal(e.courseLabel, 'MATH 7');
  assert.equal(e.end, '2026-10-22T18:30:00.000Z');
});

test('non-Canvas UIDs are kept as other', () => {
  const e = parseIcs(ICS)[3];
  assert.equal(e.kind, 'other');
  assert.equal(e.canvasId, null);
  assert.equal(e.courseLabel, null);
  assert.equal(e.end, null);
});

test('fetchIcs downloads and parses; non-2xx throws', async () => {
  const srv = await startHttp((req, res) => {
    if (req.url === '/feeds/calendars/user_abc.ics') {
      res.writeHead(200, { 'Content-Type': 'text/calendar' });
      res.end(ICS);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  try {
    assert.equal((await fetchIcs(`${srv.url}/feeds/calendars/user_abc.ics`)).length, 4);
    await assert.rejects(fetchIcs(`${srv.url}/feeds/calendars/user_nope.ics`));
  } finally {
    await srv.close();
  }
});

const REAL = [
  'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Instructure//Canvas//EN',
  'BEGIN:VEVENT', 'UID:event-assignment-override-225628', 'DTSTART;VALUE=DATE;VALUE=DATE:20260925',
  'SUMMARY:Presentations: The First Half (11 students) [SMC 2026 Fall - ENGL C1000 (2074)]',
  'URL;VALUE=URI:https://online.smc.edu/calendar?include_contexts=course_84049&month=09&year=2026#assignment_2252184', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:event-sub-assignment-10449536', 'DTSTART;VALUE=DATE;VALUE=DATE:20261015',
  'SUMMARY:Titrations in the Real World Discussion (Initial Post Due Thursday) Reply to Topic [CHEM_102_17218FA26W]',
  'URL;VALUE=URI:https://ilearn.laccd.edu/calendar?include_contexts=course_374998&month=10&year=2026#assignment_10449535', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:event-sub-assignment-10449537', 'DTSTART;VALUE=DATE;VALUE=DATE:20261018',
  'SUMMARY:Titrations in the Real World Discussion (Initial Post Due Thursday) Required Replies (2) [CHEM_102_17218FA26W]',
  'URL;VALUE=URI:https://ilearn.laccd.edu/calendar?include_contexts=course_374998&month=10&year=2026#assignment_10449535', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:event-assignment-10399660', 'DTSTART:20260924T232500Z', 'DTEND:20260924T232500Z',
  'SUMMARY:Experiment 16: Le Châtelier’s Principle\; Buffers — Lab Report [CHEM_102_17218FA26W]',
  'URL;VALUE=URI:https://ilearn.laccd.edu/calendar?include_contexts=course_374998&month=09&year=2026#assignment_10399660', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('real Canvas feeds: an override event belongs to its assignment, not to the override id', () => {
  const ev = parseIcs(REAL).find((e) => e.uid === 'event-assignment-override-225628')!;
  assert.equal(ev.kind, 'assignment');
  assert.equal(ev.canvasId, '2252184');
  assert.equal(ev.courseCanvasId, '84049');
  assert.equal(ev.title, 'Presentations: The First Half');
});

test('real Canvas feeds: an all-day assignment date means due at 11:59 PM that day', () => {
  const ev = parseIcs(REAL).find((e) => e.uid === 'event-assignment-override-225628')!;
  assert.equal(ev.allDay, true);
  assert.equal(ev.start, new Date(2026, 8, 25, 23, 59, 59).toISOString());
  const timed = parseIcs(REAL).find((e) => e.uid === 'event-assignment-10399660')!;
  assert.equal(timed.start, '2026-09-24T23:25:00.000Z');
  assert.equal(timed.title, 'Experiment 16: Le Châtelier’s Principle; Buffers — Lab Report');
});

test('real Canvas feeds: checkpoint events map to the discussion and its checkpoint', () => {
  const evs = parseIcs(REAL).filter((e) => e.uid.startsWith('event-sub-assignment'));
  assert.deepEqual(evs.map((e) => [e.kind, e.canvasId, e.checkpoint, e.title]), [
    ['assignment', '10449535', 'reply_to_topic', 'Titrations in the Real World Discussion (Initial Post Due Thursday)'],
    ['assignment', '10449535', 'reply_to_entry', 'Titrations in the Real World Discussion (Initial Post Due Thursday)'],
  ]);
});
