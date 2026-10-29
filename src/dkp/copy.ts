// Order 27: every member-facing DKP string (listed for approval in docs/COPY.md, "Work order 27").
import { md, plural } from '../discord.ts';

export const DKP_COPY = {
  off: 'DKP is off on this server.',
  notRunner: 'Only officers (or the role an admin named in `/dkp settings`) can run DKP.',
  own: 'Nobody can change their own points.',
  asked: "You asked for this change, so another officer has to approve it.",
  addLabel: 'Add DKP',
  removeLabel: 'Remove DKP',
  added: (channel: string) => `DKP is on. Standings and raid cards go in <#${channel}>. \`/dkp\` is now in this server's command list (reload Discord if you don't see it yet).`,
  kept: (channel: string) => `Kept <#${channel}>.`,
  created: (channel: string) => `Created <#${channel}>: DKP standings, raid cards and changes. Only GuildCraft posts there.`,
  commandFailed: (status: number) => `Discord refused to change \`/dkp\` on this server (it answered ${status || 'nothing'}). DKP is unchanged; press the button again to retry.`,
  channelFailed: (status: number) => `Could not create **GC-DKP** (Discord answered ${status || 'nothing'}). DKP is still off; press **Add DKP** again to retry.`,
  removed: (channel: string | null) =>
    `DKP is off. \`/dkp\` is removed from this server; every point and raid is kept, and **Add DKP** later resumes the same history.${channel ? ` <#${channel}> is left as it is: keep it or delete it.` : ''}`,
  removedRaid: 'The open raid was closed.',
  alreadyOff: 'DKP is already off on this server.',
  // standings
  standingsTitle: (pool: string) => `${pool} standings`,
  guildPool: 'Guild pool',
  nobody: 'No points yet.',
  frozen: ' (frozen)',
  fullStandings: 'Full standings',
  standingsMore: (n: number) => `…and ${plural(n, 'more member')}. Press **Full standings**.`,
  page: (n: number, of: number) => `Page ${n} of ${of}`,
  // adjustments
  adjustReason: 'A reason is required.',
  noPoints: 'Points must not be 0.',
  unknownPool: (typed: string) => `There is no pool called **${md(typed)}**. Pick one from the list.`,
  adjustDone: (posted: boolean) => (posted ? 'Done. The change is posted in GC-DKP.' : 'Done, but I could not post the change in GC-DKP.'),
  adjustLine: (member: string, points: number, pool: string, balance: number, by: string, reason: string, cut: number) =>
    `${member}: ${points > 0 ? '+' : ''}${points} in **${md(pool)}** (now ${balance})${cut ? `; ${cut} over the cap was not added` : ''}. By ${by}. Reason: ${md(reason)}`,
  approvalPosted: (threshold: number) => `That is over ${threshold} points, so it needs a second officer: it is posted in GC-DKP for approval.`,
  approvalCard: (member: string, points: number, pool: string, by: string, reason: string, due: string) =>
    `**Needs a second officer:** ${member}: ${points > 0 ? '+' : ''}${points} in **${md(pool)}**. Asked by ${by}. Reason: ${md(reason)}\nAnother officer presses **Approve** before <t:${due}:f>, or it lapses.`,
  approve: 'Approve',
  approved: (by: string) => `Approved by ${by}.`,
  lapsed: 'Lapsed: nobody approved it in time.',
  notOpen: 'This change was already approved or has lapsed.',
  approvedReply: 'Approved. The change is applied.',
  // settings
  settingsNow: 'DKP settings (changes apply from now on):',
  settingChanged: (label: string, value: string, by: string) => `**DKP setting changed:** ${label} is now ${value}. By ${by}.`,
  settingRange: (label: string, min: number, max: number) => `${label} must be between ${min} and ${max}.`,
  settingSaved: 'Saved. The change is posted in GC-DKP.',
  runnerDefault: 'the officer role (and admins)',
  runnerRole: (role: string) => `<@&${role}> (and admins)`,
  whoRuns: 'Who runs DKP',
  namedValue: (name: string, zone: string, points: number, by: string) => `**Named value:** ${md(name)} in ${md(zone)} now pays ${points} raid points. By ${by}.`,
  unknownZone: (typed: string) => `No zone is called **${md(typed)}**.`,
} as const;
