// Reading one Canvas assignment: is it a discussion, and what do its instructions ask for (cached per object, so
// the item rows and the logic pass read it once).
import type { CanvasAssignment } from '../canvas/types.ts';
import { htmlToText } from '../util/html.ts';
import { readInstructions } from './instructions.ts';
import type { InstructionFindings } from './instructions.ts';

/** A Canvas discussion: the student's posts are in the submission and can be counted. */
export function isCanvasDiscussion(a: Pick<CanvasAssignment, 'submission_types' | 'discussion_topic'>): boolean {
  return (a.submission_types ?? []).includes('discussion_topic') || !!a.discussion_topic;
}

/** A discussion in name too (one held in an external tool): its instructions are read the same way. */
export function isDiscussionLike(a: Pick<CanvasAssignment, 'submission_types' | 'discussion_topic' | 'name'>): boolean {
  return isCanvasDiscussion(a) || /\bdiscussions?\b/i.test(a.name);
}

const cache = new WeakMap<object, InstructionFindings>();

export function instructionsOf(a: CanvasAssignment): InstructionFindings {
  let f = cache.get(a);
  if (!f) cache.set(a, (f = readInstructions(a.name, htmlToText(a.description ?? ''), { discussion: isDiscussionLike(a) })));
  return f;
}
