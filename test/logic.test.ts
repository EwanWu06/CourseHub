// What an assignment needs for full credit, read from its instructions. Every sentence below is copied from a real
// assignment at SMC (ENGL C1000) or LACCD (CHEM 102), the phrasing teachers actually use.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readInstructions, milestoneDate } from '../src/logic/instructions.ts';
import { discussionProgress } from '../src/logic/progress.ts';
import { atLocal } from '../src/util/time.ts';

const replies = (title: string, text: string) => readInstructions(title, text, { discussion: true }).replies?.value;

test('reply requirements in the words real teachers use', () => {
  assert.equal(replies('Discussion: Let\'s Introduce Ourselves', 'Click on "reply" below to enter your response. Write 200-300 words minimum and reply to at least two other students for 10 points.'), 2);
  assert.equal(replies('Discussion: The Source of Self-Regard', 'Then write at least two replies to your fellow students. Don\'t just write "I liked your post".'), 2);
  assert.equal(replies('Discussion: The Source of Self-Regard', 'One original post and two thoughtful replies nets you 25 points.'), 2);
  assert.equal(replies('Discussion: Science Fiction as Metaphor', 'In addition to your main post, reply at least twice to other posts to receive full credit.'), 2);
  assert.equal(replies('Discussion: What\'s Your Topic?', 'Reply at least two times to other students with questions, critiques, or suggestions.'), 2);
  assert.equal(replies('Reaction Rate Discussion', 'Respond to at least 2 peers\' posts by reflecting on their scenarios and connecting them to the key concepts we have learned.'), 2);
  assert.equal(replies('Faster Reaction or More Product?', 'Replied to at least two different classmates . In each reply, evaluate one specific prediction.'), 2);
  assert.equal(replies('Titrations in the Real World Discussion', 'After posting, respond to at least two classmates:'), 2);
  assert.equal(replies('Experiment 34: Share and compare results', 'Responded to at least one of your peers\' posts.'), 1);
  assert.equal(replies('Experiment 34: Share and compare results', 'Reply to a classmate\'s post, comparing and contrasting your results.'), 1);
});

test('the reply quote is the teacher\'s own sentence', () => {
  const r = readInstructions('Discussion', 'Write at least 100 words explaining your comparison.\nReply at least two times to other students with questions, critiques, or suggestions.', { discussion: true });
  assert.equal(r.replies?.quote, 'Reply at least two times to other students with questions, critiques, or suggestions.');
});

test('"different classmates" is noted', () => {
  assert.equal(readInstructions('D', 'Please respond to at least two different classmates .', { discussion: true }).repliesDistinct, true);
  assert.equal(readInstructions('D', 'Reply at least two times to other students.', { discussion: true }).repliesDistinct, false);
});

test('more than one count: the larger one wins (missing a reply costs points, an extra one costs nothing)', () => {
  const r = readInstructions('D', 'Reply to a classmate\'s post.\nRespond to at least 2 peers\' posts.', { discussion: true });
  assert.equal(r.replies?.value, 2);
});

test('sentences that mention replies without asking for any', () => {
  assert.equal(replies('D', 'Replies to other students = 10 points (five per reply)'), undefined);
  assert.equal(replies('D', 'I will respond to emails within 24 hours.'), undefined);
  assert.equal(replies('D', 'Click "reply" to enter your info! Write at least 400-500 words and include some multimedia.'), undefined);
  assert.equal(replies('D', 'Hit "reply" below to enter your post in the discussion thread. 50 points.'), undefined);
  assert.equal(replies('D', 'IMPORTANT CAVEAT: NO DOUBLES. READ THE THREAD BEFORE POSTING.'), undefined);
  assert.equal(replies('D', 'You do not need to reply to other students this week.'), undefined);
});

test('posts: one by default, more only when stated', () => {
  assert.equal(readInstructions('D', 'Make at least 1 primary post that meets the submission criteria.', { discussion: true }).posts?.value, 1);
  assert.equal(readInstructions('D', 'Make two original posts and reply to two classmates.', { discussion: true }).posts?.value, 2);
  assert.equal(readInstructions('D', 'Write a 400-500 word post.', { discussion: true }).posts, undefined);
});

test('an earlier deadline for the first post, from the title or the text', () => {
  assert.deepEqual(readInstructions('Getting to Know Each Other Discussion (Initial Post Due on Thursday)', '', { discussion: true }).postDue?.value, { weekday: 4, time: null });
  assert.deepEqual(readInstructions('Reaction Rate Discussion - Initial Response Due Thursday', '', { discussion: true }).postDue?.value, { weekday: 4, time: null });
  assert.deepEqual(readInstructions('Reaction Rate Discussion', 'First response due: This Thursday by 11:59 PM\nResponses to peers due: This Sunday by 11:59 PM', { discussion: true }).postDue?.value, { weekday: 4, time: '23:59' });
  assert.deepEqual(readInstructions('Experiment 34', 'First response due: October 9, 2026, at 11:59 PM\nResponses to peers due: October 11, 2026, at 11:59 PM', { discussion: true }).postDue?.value, { date: '2026-10-09', time: '23:59' });
  assert.deepEqual(readInstructions('D', 'Post your initial response by Wednesday at 11:59pm, then reply to two classmates by Sunday.', { discussion: true }).postDue?.value, { weekday: 3, time: '23:59' });
  // pointing at Canvas's own checkpoint dates is not a date
  assert.equal(readInstructions('D', 'First response due: see the “Reply to Topic” due date shown at the top of this discussion.', { discussion: true }).postDue, undefined);
  // only for discussions: "first response paper is due Friday" in an essay is a different assignment
  assert.equal(readInstructions('Essay 1', 'The first response paper is due Friday.', { discussion: false }).postDue, undefined);
});

test('length and one-shot / in-lab rules', () => {
  const d = readInstructions('D', 'Write 200-300 words minimum and reply to at least two other students for 10 points.', { discussion: true });
  assert.deepEqual(d.words?.value, { min: 200, max: 300 });
  assert.deepEqual(readInstructions('D', 'Write at least 100 words explaining your comparison.', { discussion: true }).words?.value, { min: 100, max: null });
  assert.deepEqual(readInstructions('D', '500 words minimum. Include some tasty images.', { discussion: true }).words?.value, { min: 500, max: null });
  const lab = readInstructions('Exp #34: An Equilibrium Constant Lab Report', 'Digital Lab Submission Reminders:\nYou will have one attempt to complete this assignment.\nDo not push the "submit" button until you have completed the assignment. There is no way to unsubmit assignments.\nYou may only complete the assignment if you are physically in the lab.', { discussion: false });
  assert.equal(lab.oneAttempt?.quote, 'You will have one attempt to complete this assignment.');
  assert.equal(lab.inPerson?.quote, 'You may only complete the assignment if you are physically in the lab.');
  const video = readInstructions('15.2 The Rate of a Chemical Reaction', 'You have unlimited attempts to complete the video.', { discussion: false });
  assert.equal(video.oneAttempt, undefined);
});

test('the date of an earlier first-post deadline', () => {
  const sunday = atLocal('2026-10-18', 23, 59).toISOString(); // a Sunday
  assert.equal(milestoneDate(sunday, { weekday: 4, time: '23:59' }), atLocal('2026-10-15', 23, 59).toISOString());
  assert.equal(milestoneDate(sunday, { weekday: 4, time: null }), atLocal('2026-10-15', 23, 59).toISOString(), 'no time written: same time of day as the deadline');
  assert.equal(milestoneDate(sunday, { weekday: 0, time: null }), null, 'same day as the deadline: nothing earlier to remind about');
  assert.equal(milestoneDate(sunday, { date: '2026-10-15', time: '21:00' }), atLocal('2026-10-15', 21, 0).toISOString());
  assert.equal(milestoneDate(sunday, { date: '2026-10-25', time: null }), null, 'after the deadline: not an earlier step');
  assert.equal(milestoneDate(sunday, { date: '2026-09-01', time: null }), null, 'weeks before: not this assignment\'s week');
  const thursday = atLocal('2026-10-15', 23, 59).toISOString();
  assert.equal(milestoneDate(thursday, { weekday: 4, time: null }), null);
  assert.equal(milestoneDate(thursday, { weekday: 2, time: null }), atLocal('2026-10-13', 23, 59).toISOString());
});

test('my own posts in a discussion: posts, replies to others, and how many different people', () => {
  const entries = [
    { id: '1', parent_id: null },
    { id: '2', parent_id: '90' },
    { id: '3', parent_id: '91' },
    { id: '4', parent_id: '1' }, // answering a reply under my own post: talking to myself doesn't count
  ];
  const authors = new Map([['90', 'u-a'], ['91', 'u-b']]);
  assert.deepEqual(discussionProgress(entries, 'me', (id) => authors.get(id), new Set()), { posts: 1, replies: 2, people: 2 });
  // two replies to the same classmate count once as people
  const same = new Map([['90', 'u-a'], ['91', 'u-a']]);
  assert.deepEqual(discussionProgress(entries, 'me', (id) => same.get(id), new Set()), { posts: 1, replies: 2, people: 1 });
  // replying to the teacher is a reply, but not a classmate
  const teacher = new Map([['90', 'u-a'], ['91', 'prof']]);
  assert.deepEqual(discussionProgress(entries, 'me', (id) => teacher.get(id), new Set(['prof'])), { posts: 1, replies: 2, people: 1 });
  // an author we couldn't look up: people unknown, replies still counted
  assert.deepEqual(discussionProgress(entries, 'me', (id) => (id === '90' ? 'u-a' : undefined), new Set()), { posts: 1, replies: 2, people: null });
  assert.deepEqual(discussionProgress([], 'me', () => undefined, new Set()), { posts: 0, replies: 0, people: 0 });
});

test('how many peer reviews a review column asks for', () => {
  const r = (t: string) => readInstructions('Research Paper Peer Reviews', t, { discussion: false }).reviews?.value;
  assert.equal(r('Thirty points for reviewing three rough drafts.'), 3);
  assert.equal(r("You will be assigned three of your colleagues' rough drafts to review."), 3);
  assert.equal(r('Three thoughtful peer reviews = 30 points.'), 3);
  assert.equal(r('Excessively brief, non-specific comments will not receive full credit.'), undefined);
  assert.equal(r('Write two full pages.'), undefined);
});

test('bullets are not part of the quote', () => {
  const r = readInstructions('D', '• Respond to at least 2 peers\' posts.', { discussion: true });
  assert.equal(r.replies?.quote, 'Respond to at least 2 peers\' posts.');
});
