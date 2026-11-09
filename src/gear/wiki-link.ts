// Order 44: one rule for an item's wiki link, read by the gear index (/gear upgrades' names) and the Gear panel's lines.

/**
 * A link's address with its parentheses encoded (review fix: wiki titles such as "Archer Starter Quest (Faelindral)" put
 * them in the address, which would end a markdown link early; src/board/factions.ts encodes them the same way).
 */
export const linkUrl = (url: string) => url.replace(/\(/g, '%28').replace(/\)/g, '%29');

/** Order 17's rule for wiki links (order 36 follow-up): only an https address is ever linked; anything else is none. */
export const wikiHref = (url: unknown): string | null => (typeof url === 'string' && url.startsWith('https://') ? url : null);

/** Markdown text linked to the address, or the text alone when there is none. The text is already escaped. */
export const wikiLinked = (text: string, url: string | null): string => (url ? `[${text}](${linkUrl(url)})` : text);
