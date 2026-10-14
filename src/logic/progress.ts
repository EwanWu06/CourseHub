// Where the student stands in a discussion, from their own entries (Canvas includes them in the assignment's
// submission): top-level posts, replies to other people's posts, and how many different classmates those reach.

export interface OwnEntry { id: string; parent_id?: string | null }
export interface DiscussionProgress { posts: number; replies: number; people: number | null }

/**
 * `authorOf(entryId)` names who wrote a post the student replied to (undefined = not known). Replies under the
 * student's own post don't count; replies to the teacher count as replies but not as classmates. `people` is null
 * when an author couldn't be looked up — then only the reply count is known.
 */
export function discussionProgress(entries: OwnEntry[], selfId: string | null, authorOf: (entryId: string) => string | null | undefined, teachers: Set<string>): DiscussionProgress {
  const own = new Set(entries.map((e) => String(e.id)));
  const toOthers = entries.filter((e) => e.parent_id && !own.has(String(e.parent_id)));
  const people = new Set<string>();
  let unknown = false;
  for (const e of toOthers) {
    const who = authorOf(String(e.parent_id));
    if (who === undefined || who === null) {
      unknown = true;
      continue;
    }
    if (who === selfId || teachers.has(who)) continue;
    people.add(who);
  }
  return { posts: entries.filter((e) => !e.parent_id).length, replies: toOthers.length, people: unknown ? null : people.size };
}
