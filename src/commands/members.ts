// /guildcraft remove-member user: (officer; PRD FR-8) and the buttons that act on members (order 7, ITEM 3):
// the preview's Confirm and Cancel, and the departure notice's Remove and Keep (src/departures.ts).
// Officer rights are re-read from the button press itself, never from the message that carries the button.
//
// remove-member on someone still in the server: allowed (an officer may target anyone, themselves included).
// They are marked 'left' with a member.removed row; the nightly run never sets anyone back to 'active', so they
// stay 'left' until they use GuildCraft themselves. Their removed characters stay removed until they run
// /character add with the same name, which restores each one with its skills (order 2's restore path).
import type { Ctx } from '../context.ts';
import { button, ephemeral, md, optString, plural, row, STYLE_DANGER, STYLE_SECONDARY, updateMessage, type MessageReply, type Option } from '../discord.ts';
import { describeCharacter, keepMember, membersCharacters, NOTICE_PREFIX, removeMember, REMOVE_PREFIX, type CharacterBrief } from '../departures.ts';

export const OFFICER_ONLY = 'Only officers can do that.';

const listOf = (characters: CharacterBrief[]) => characters.map(describeCharacter).join(', ');

/** The preview: what Confirm would do, with Confirm and Cancel. Nothing changes until Confirm. */
export const guildcraftRemoveMember = (c: Ctx, opts: Option[]) => removeMemberPreview(c, optString(opts, 'user'));
/** Order 18: /officer remove-member member: (the same preview). */
export const officerRemoveMember = (c: Ctx, opts: Option[]) => removeMemberPreview(c, optString(opts, 'member'));

async function removeMemberPreview(c: Ctx, userId: string | undefined): Promise<MessageReply> {
  if (!userId) return ephemeral('Pick the member to remove.');
  const { member, characters } = await membersCharacters(c.db, c.guild.id, userId);
  if (!member) return ephemeral(`<@${userId}> has never used GuildCraft in this server, so there is nothing to remove.`);
  const who = `**${md(member.name)}**`;
  const what = characters.length
    ? `This will remove ${plural(characters.length, 'character')}: ${listOf(characters)}.`
    : `${who} has no characters registered.`;
  return ephemeral(
    [
      what,
      `${who} is then marked as having left: hidden from \`/craft find\`, \`/roster\` and the roster board until they use GuildCraft again.`,
      'Their skills are kept, and `/character add` with the same name restores a character. Nothing is deleted.',
    ].join('\n'),
    { components: [row([button(`${REMOVE_PREFIX}yes:${userId}`, 'Confirm', STYLE_DANGER), button(`${REMOVE_PREFIX}no:${userId}`, 'Cancel', STYLE_SECONDARY)])] },
  );
}

const removedText = (name: string, characters: CharacterBrief[], by: string) =>
  `${by} removed **${md(name)}**${characters.length ? ` and ${plural(characters.length, 'character')}: ${listOf(characters)}` : ' (no characters)'}. ` +
  'Their skills are kept: `/character add` with the same name restores a character.';

/** rm:yes:<user> / rm:no:<user>: the preview's buttons (the preview is private to the officer who ran it). */
export async function removeMemberButton(c: Ctx, customId: string): Promise<MessageReply> {
  const [choice, userId] = customId.slice(REMOVE_PREFIX.length).split(':');
  if (!c.officer) return ephemeral(OFFICER_ONLY);
  if (choice === 'no' || !userId) return updateMessage({ content: 'Cancelled. Nothing was changed.', components: [] });
  const done = await removeMember(c, userId, 'command');
  if (!done) return updateMessage({ content: `<@${userId}> has never used GuildCraft in this server, so there was nothing to remove.`, components: [] });
  return updateMessage({ content: removedText(done.name, done.characters, 'Done:'), components: [] });
}

/** dep:remove:<user> / dep:keep:<user>: the departure notice's buttons, in the review channel. */
export async function noticeButton(c: Ctx, customId: string): Promise<MessageReply> {
  const [choice, userId] = customId.slice(NOTICE_PREFIX.length).split(':');
  if (!c.officer) return ephemeral(OFFICER_ONLY);
  if (!userId || (choice !== 'keep' && choice !== 'remove')) return ephemeral('Sorry, that button has expired.');
  const { member } = await membersCharacters(c.db, c.guild.id, userId);
  if (!member) return updateMessage({ content: 'This member is no longer recorded. Nothing was changed.', embeds: [], components: [] });
  const by = `<@${c.userId}>`;
  if (member.status === 'active') return updateMessage({ content: `**${md(member.name)}** is back and active again, so nothing was changed. (Checked by ${by}.)`, embeds: [], components: [] });
  if (choice === 'keep') {
    await keepMember(c, userId);
    return updateMessage({
      content: `${by} kept **${md(member.name)}**'s characters. They stay hidden while ${md(member.name)} is away and show again once they're back and use GuildCraft.`,
      embeds: [],
      components: [],
    });
  }
  const done = await removeMember(c, userId, 'notice');
  return updateMessage({ content: removedText(done!.name, done!.characters, by), embeds: [], components: [] });
}
