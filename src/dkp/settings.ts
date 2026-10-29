// Order 27: the DKP settings, held once here (every rule is a setting with a default; docs/PRD.md "DKP add-on"). A row in
// dkp_setting exists only for a value a server changed; every reader goes through settingsOf, so a default is never
// typed twice. Who runs DKP is a role, decided in src/access.ts (isDkpRunner).

export interface NumberSetting {
  key: string;
  label: string;
  default: number;
  min: number;
  max: number;
  unit: string;
}

export const SETTINGS = [
  { key: 'kill_points', label: 'Raid points per named kill', default: 10, min: 0, max: 1000, unit: 'points' },
  { key: 'flat_points', label: 'Flat raid value', default: 30, min: 0, max: 1000, unit: 'points' },
  { key: 'guild_points', label: 'Guild points per kill or flat payout', default: 2, min: 0, max: 1000, unit: 'points' },
  { key: 'cap', label: 'Pool cap', default: 100, min: 1, max: 100000, unit: 'points' },
  { key: 'check_seconds', label: 'Check-again window', default: 300, min: 30, max: 3600, unit: 'seconds' },
  { key: 'second_officer_over', label: 'Second officer needed over', default: 20, min: 0, max: 100000, unit: 'points' },
  { key: 'approval_hours', label: 'Approval lapses after', default: 24, min: 1, max: 168, unit: 'hours' },
  { key: 'auto_close_hours', label: 'Raid auto-closes after', default: 8, min: 1, max: 24, unit: 'hours' },
] as const satisfies readonly NumberSetting[];

export type SettingKey = (typeof SETTINGS)[number]['key'];
export type Settings = Record<SettingKey, number> & { runner_role: string | null };
/** The one setting that is not a number: the role that runs DKP (null: the officer role). */
export const RUNNER_ROLE = 'runner_role';

/** The settings from dkp_setting's rows (key → text), each missing one at its default. */
export function settingsOf(rows: Record<string, string> | null | undefined): Settings {
  const out = Object.fromEntries(
    SETTINGS.map((s) => {
      const v = Number(rows?.[s.key]);
      return [s.key, Number.isInteger(v) && v >= s.min && v <= s.max ? v : s.default];
    }),
  ) as Record<SettingKey, number>;
  return { ...out, runner_role: rows?.[RUNNER_ROLE] || null };
}

export const settingOf = (key: string) => SETTINGS.find((s) => s.key === key);
