// Order 30 (ITEM 1): what the one-off backfill changes on one forum: only a field that is empty at that moment.
import { mayNeedReaction, reactionOf, type DefaultReaction } from '../../src/emoji.ts';

export interface ForumFields {
  topic?: string | null;
  default_reaction_emoji?: DefaultReaction | null;
}

/** The PATCH body for one forum, or null when both fields are already set (an officer's choice stands). */
export function planForum(ch: ForumFields, guidelines: string, emojiId: string | null): Record<string, unknown> | null {
  const body = {
    ...(ch.topic ? {} : { topic: guidelines }),
    ...(emojiId && mayNeedReaction(ch.default_reaction_emoji) ? { default_reaction_emoji: reactionOf(emojiId) } : {}),
  };
  return Object.keys(body).length ? body : null;
}
