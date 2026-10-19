// DRAFT copy — Brian approves the final text before launch (ORDER-RULES: Product).
// Lists every command in docs/PRD.md (FR-1 to FR-9).

export const HELP_FOOTER = 'draft — commands arrive over the next builds';

export const HELP_TEXT = [
  '## GuildCraft — every command',
  '**Your characters**',
  '`/character add` register a character (name, class, level, main)',
  '`/character edit` rename it or change class, level or main',
  '`/character remove` remove a character and its skills',
  '**Your skills and recipes**',
  '`/craft set` set one tradeskill level',
  '`/craft update` set up to 5 tradeskills at once',
  '`/craft me` your skills, levels and last update (private)',
  '`/craft know` · `/craft forget` mark a recipe as known, or undo it',
  '**Find a crafter**',
  '`/craft find` who can make an item, with its recipe and stats',
  '`/roster skill` everyone with a tradeskill, ranked',
  '`/roster member` one member\'s characters and skills',
  '`/roster top` the top 3 in each tradeskill',
  '`/roster recipes` who knows the rare reputation and discovery recipes',
  '**Items and data**',
  '`/item image` submit a screenshot of an item window',
  '`/craft report` report a wrong recipe, trivial or component',
  '`/recipe add` record a recipe the data is missing (officer-approved)',
  '**Officers and admins**',
  '`/recipe source` · `/recipe override` set how a recipe is obtained; correct a recipe',
  '`/guildcraft setup` · `/guildcraft remove-member` · `/guildcraft rebuild-board` · `/guildcraft status`',
  '`/craft help` this guide',
  '',
  `-# ${HELP_FOOTER} · Item data: Monsters and Memories Wiki (CC BY-SA 4.0)`,
].join('\n');
