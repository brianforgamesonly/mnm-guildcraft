// Order 32: the one function that decides who may sign up for an event: the member role, the event's sign-up role, the
// lock, frozen and left. Every route calls it: a press, Change character, Change role and /event roster. "Frozen" is DKP's
// word for a member whose status is 'left' (docs/PRD.md); they thaw with their own next command. Can't make it is never
// gated: a member can always say they aren't coming.
import type { Status } from './types.ts';

/** Changes a member may make to one event in a minute (a press, Change character, Change role); officers' don't count. */
export const SPAM_LIMIT = 10;
export const SPAM_WINDOW_MS = 60_000;

export type SignupRefusal = { code: 'closed' | 'cancelled' | 'spam' | 'frozen' | 'left' | 'locked' } | { code: 'member_role' | 'signup_role'; role: string };

export interface Asking {
  event: { status: string; lock_at: string | null; signup_role: string | null };
  /** guild.member_role_id. */
  memberRole: string | null;
  /** The roles of the member being signed up, from this press or the option's resolved member. */
  roles: string[];
  /** member.status, or null when GuildCraft has no row for them. */
  memberStatus: string | null;
  /** Their current status on this event. */
  current: Status | null;
  /** Can't make it, or an officer taking them off. */
  leaving: boolean;
  route: 'member' | 'officer';
  /** An officer's /event roster: Discord resolved the member, so they are in the server. A press always is. */
  inServer: boolean;
  /** Their own changes to this event in the last minute. */
  recent: number;
  now: number;
}

export function signupRefusal(a: Asking): SignupRefusal | null {
  if (a.event.status === 'cancelled') return { code: 'cancelled' };
  if (a.event.status !== 'open') return { code: 'closed' };
  if (a.route === 'member' && a.recent >= SPAM_LIMIT) return { code: 'spam' };
  if (a.leaving) return null;
  if (a.memberStatus === 'left') return { code: 'frozen' };
  if (a.current === 'left' && !a.inServer) return { code: 'left' };
  if (a.route === 'member' && a.event.lock_at && Date.parse(a.event.lock_at) <= a.now) return { code: 'locked' };
  if (a.memberRole && !a.roles.includes(a.memberRole)) return { code: 'member_role', role: a.memberRole };
  if (a.event.signup_role && !a.roles.includes(a.event.signup_role)) return { code: 'signup_role', role: a.event.signup_role };
  return null;
}
