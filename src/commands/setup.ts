// /guildcraft setup member_role: officer_role: (PRD FR-8). Board, review and vault channels arrive in order 4.
import { audit, type Guild } from '../access.ts';
import type { Ctx } from '../context.ts';
import { ephemeral, optString, type InteractionReply, type Option } from '../discord.ts';

const describeRoles = (g: Pick<Guild, 'member_role_id' | 'officer_role_id'>) =>
  [
    `Member role: ${g.member_role_id ? `<@&${g.member_role_id}>` : 'none (anyone in the server can use GuildCraft)'}`,
    `Officer role: ${g.officer_role_id ? `<@&${g.officer_role_id}>` : 'none'} (Administrator and Manage Server always count as officers)`,
  ].join('\n');

export async function guildcraftSetup(c: Ctx, opts: Option[]): Promise<InteractionReply> {
  const memberRole = optString(opts, 'member_role');
  const officerRole = optString(opts, 'officer_role');
  if (memberRole === undefined && officerRole === undefined) return ephemeral(`Current settings:\n${describeRoles(c.guild)}`);
  const before = { member_role_id: c.guild.member_role_id, officer_role_id: c.guild.officer_role_id };
  const after = { member_role_id: memberRole ?? before.member_role_id, officer_role_id: officerRole ?? before.officer_role_id };
  await c.db.batch([
    c.db.prepare('UPDATE guild SET member_role_id = ?, officer_role_id = ? WHERE id = ?').bind(after.member_role_id, after.officer_role_id, c.guild.id),
    audit(c.db, c.guild.id, c.userId, 'guild.setup', `guild:${c.guild.id}`, before, after),
  ]);
  return ephemeral(`Saved.\n${describeRoles(after)}`);
}
