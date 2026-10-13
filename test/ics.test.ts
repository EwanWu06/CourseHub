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
