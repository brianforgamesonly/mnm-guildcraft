/**
 * Order 11: operator-only information (copy markers, token and job internals, platform usage) appears only in the
 * dev copy. The one decider: any value but 'dev', unset included, is production. Order 12: its own module (no
 * Workers types), so the Node checks can import it with src/operator-text.ts.
 */
export const isDevCopy = (copy: string | undefined) => copy === 'dev';
