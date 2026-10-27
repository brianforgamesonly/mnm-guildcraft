# GuildCraft copy list

This is every piece of text GuildCraft shows to members, officers and admins in Discord. Every line marked APPROVED was approved for launch (the owner, by exception, 2026-10-20: work order 11). New or changed text added later is listed here as DRAFT until it is approved; work order 18's new command names changed some approved lines, which are now DRAFT. Text the bot no longer shows is taken out of the list.
Parts in angle brackets, such as \<item name> or \<character>, are filled in by the bot each time. @\<member> is a mention of a member, #\<channel> a link to a channel, @\<role> a role, \<date and time> a Discord timestamp shown in the reader's own time zone.
A count written "character(s)" shows as "1 character" or "3 characters".
"(dev only)" marks a line only the operator's dev copy shows (the test server); production, and so every guild, never shows it.

Where: the file and line the text started on in `src/` when the list was drawn up (order 10); later lines may have moved, so find a string by its text. "-#" at the start of a line is Discord's small grey text.

## Commands

Work order 18 replaced the commands: members have `/me`, `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request` and `/help`; officers `/officer`; admins `/guildcraft`. A line the bot still shows keeps its status under a heading that names how it is reached now ("formerly" names the old command); a line whose words changed shows its current words and is DRAFT. Every command and option description, every new line and every changed line is also listed in "Work order 18: the simpler commands (DRAFT)" at the end.

### Options several commands share

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:27 | `character` option (/skills): Optional; defaults to your main | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:28 | `skill` option (/roster skill): Tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:30 | `item` option (/officer recipe-source, /officer recipe-fix; formerly /recipe source, /recipe override): The item: pick its recipe from the list (each shows its tradeskill and trivial) | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:74 | A recipe in pick lists and replies: \<item> · \<tradeskill> · trivial \<number> (or: \<item> · \<tradeskill> · trivial unknown) | APPROVED (owner, by exception, 2026-10-20) |

### /me (formerly /character, /craft me, /craft forget)

(The panel's own lines, its buttons, forms and menus are under Work order 18.)

#### Add character (on /me; formerly /character add)

| Where | Text | Status |
|---|---|---|
| src/commands/character.ts:194 | Added **\<character>** (\<class>, level \<level>). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:156 | (added after "Added …", first character) It is your main (your first character). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:156 | (added after "Added …", when the form's "Make this your main?" is Yes) It is now your main. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:172 | Restored **\<character>** (\<class>, level \<level>), which you removed earlier, with its \<number> saved skill(s). It is your main. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:101 | A character name can't be empty. (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:102 | A character name can be at most 32 characters. (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:103 | A character name can't contain line breaks or control characters. (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:118 | Level must be a whole number from 1 to 100. (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:113 | Class **\<class>** isn't in the class list taken from the wiki data, so it's saved as typed. (The game is in Early Access; the list may be incomplete.) (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:49 | **\<name>** belongs to a removed character, so it can't be reused yet. An officer can rename the removed character to free the name. (also Edit character) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:50 | (added for officers) It belongs to @\<member>: `/officer edit-member` on them, then **Edit character** on the removed one, with a new name. | DRAFT (changes approved copy) |

#### Edit character (on /me; formerly /character edit)

| Where | Text | Status |
|---|---|---|
| src/commands/character.ts:213 | Nothing changed. | DRAFT (changes approved copy) |
| src/commands/character.ts:225 | There is a removed character of yours named **\<name>**. **Add character** on `/me` with that name restores it; or pick another name. | DRAFT (changes approved copy) |
| src/commands/character.ts:242 | **\<character>** is removed; it can't be made a main until it is restored. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:243 | **\<character>** is your main. To change that, make another character your main. (a guard: the Edit character form never sends it, as No on the main changes nothing) | DRAFT (changes approved copy) |
| src/commands/character.ts:264 | Updated **\<character>** (\<class>, level \<level>) (was **\<old name>**). It is now your main. ("(was …)" only on a rename; "It is now your main." only when it became main) | APPROVED (owner, by exception, 2026-10-20) |

#### Remove character (on /me; formerly /character remove)

| Where | Text | Status |
|---|---|---|
| src/commands/character.ts:285 | Removed **\<character>**. Its skills are kept: **Add character** on `/me` with the name **\<character>** restores it. | DRAFT (changes approved copy) |
| src/commands/character.ts:286 | **\<character>** is now your main. | APPROVED (owner, by exception, 2026-10-20) |

#### The /me panel's character cards (formerly /craft me)

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:287 | Card title: \<character> (main) ("(main)" only on the main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:277 | Card first line: \<class> · level \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:284 | **\<tradeskill>** \<level> · \<date> · *stale* ("*stale*" only when old) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:288 | No skills yet: `/skills` or **Update skills**. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:147 | Known recipes: \<item> (\<tradeskill>), \<item> (\<tradeskill>) +\<number> more | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/me.ts:57 | -# *stale* = not updated in \<number> days. | APPROVED (owner, by exception, 2026-10-20) |

#### Forget a recipe (on /me; formerly /craft forget)

| Where | Text | Status |
|---|---|---|
| src/commands/recipes.ts:69 | **\<character>** no longer has **\<recipe>** marked known. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:68 | **\<character>** didn't have **\<recipe>** marked known, so nothing changed. | APPROVED (owner, by exception, 2026-10-20) |

### /skills (formerly /craft set and /craft update)

#### /skills skill: level: (formerly /craft set)

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:55 | **\<character>**: \<tradeskill> set to **\<level>** (was \<old level>). ("(was …)" only when it had a level) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:29 | Level must be a whole number from 0 to \<skill cap>. | APPROVED (owner, by exception, 2026-10-20) |

#### /skills with no options, or Update skills on /me (formerly /craft update)

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:122 | Pick up to 5 tradeskills for **\<character>**. A form then opens with a level box for each. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:121 | The tradeskill list hasn't loaded yet. Try again later. (also Notices on /me, src/commands/me.ts:388) | APPROVED (owner, by exception, 2026-10-20) |

(The skill menu and the levels form are under Buttons and menus.)

### /item (formerly /craft find, /craft know, /craft report, /item image)

(The card's stats and sources are /gear's item card, under Work order 13; its "Used in" list, its buttons and the "No item called" reply are under Work order 18.)

#### The card's recipes and crafters (formerly /craft find)

| Where | Text | Status |
|---|---|---|
| src/commands/find.ts:284 | No recipe found for **\<typed text>**. Pick an item from the list as you type. (now `/request`'s reply for an item with no recipe) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:278 | Showing \<number> of \<number> recipes. (also src/commands/item.ts:31) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:96 | Item card footer: Item data: Monsters and Memories Wiki, CC BY-SA 4.0 · data \<data version> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:89 | (data version when none) not loaded | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:69 | Item card field: Slot | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:70 | Item card field: AC | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:71 | Item card field: Damage — \<damage> / \<delay> delay · \<weapon skill> · \<handed> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:72 | Item card field: HP | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:73 | Item card field: Mana | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:75 | Item card field: Stats — \<stat> +\<n> · \<stat> +\<n> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:77 | Item card field: Resists — \<resist> +\<n> · … | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:78 | Item card fields: HP regen · Mana regen · Haste | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:80 | Item card field: Effect — \<effect> (\<trigger>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:81 | Item card field: Weight · Size — \<weight> wt · \<size> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:82 | Item card field: Class / Race — \<classes> / \<races> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:83 | Item card field: Flags | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:186 | Recipe card title: Recipe \<n> of \<total>: \<tradeskill> · \<trivial> ("Recipe n of total:" only when the item has several) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:111 | trivial unknown | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:112 | trivial \<number> (guild-corrected) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:113 | trivial \<number>? (the ? when the wiki marks it unconfirmed) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:117 | Ingredients unknown (\<number>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:118 | \<quantity> × \<ingredient> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:119 | plus \<number> unknown ingredient(s) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:171 | -# Ingredients (guild-corrected) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:172 | Makes \<number> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:173 | Station: \<station> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:143 | Crafter group: Reliable (\<tradeskill> \<trivial>+) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:144 | Crafter group: Still learning (\<tradeskill> \<low>–\<high>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:145 | Crafter group: Trivial unknown: everyone with \<tradeskill> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:146 | Crafter group: Has skill, needs reputation (\<faction>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:146 | Crafter group: Has skill, recipe not marked known | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:177 | Group heading count: \<group> · \<number> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:140 | Crafter line: **\<character>** \<skill level> 📜 (📜 only when they marked the recipe known) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:135 | +\<number> more | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:180 | Further below: \<number> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:181 | No one in the guild has recorded \<tradeskill> yet. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:158 | **Vendor recipe**: may need buying first · Note: \<officer's note>. (guild-corrected) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:160 | **Reputation recipe** (\<faction>): only characters who marked it known (📜) count as able · Note: \<officer's note>. (guild-corrected) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:162 | **Discovery recipe**: only characters who marked it known (📜) count as able · Note: \<officer's note>. (guild-corrected) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:150 | -# How this recipe is obtained is not recorded: check the crafter has it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:183 | -# 📜 marked this recipe known | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/share.ts:30 | (on a copy posted to the channel) -# Shared by @\<member> | APPROVED (owner, by exception, 2026-10-20) |

(The buttons under the card are under Buttons and menus.)

#### I know this recipe (on an /item card; formerly also /craft know)

| Where | Text | Status |
|---|---|---|
| src/commands/recipes.ts:47 | Marked **\<recipe>** as known for **\<character>**: `/item` shows the 📜 marker. **Forget a recipe** on `/me` undoes it. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:46 | **\<character>** already has **\<recipe>** marked known. | APPROVED (owner, by exception, 2026-10-20) |

#### Report a problem (on an /item card; formerly also /craft report)

| Where | Text | Status |
|---|---|---|
| src/recipes.ts:19 | Issue choice (recipe reports): Wrong trivial | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:20 | Issue choice: Wrong ingredients | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:21 | Issue choice: Wrong source (how it is obtained) | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:22 | Issue choice: Missing recipe | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:23 | Issue choice: Other | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:82 | Thanks: your report on **\<item>** (\<issue>) is saved. Your officers have it to review. (also Report a missing recipe) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:77 | Thanks: your report on **\<item>** (\<issue>) is saved for your officers. (no review channel, or the post failed) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:62 | Pick an issue from the list: Wrong trivial, Wrong ingredients, Wrong source (how it is obtained), Missing recipe, Other. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:64 | Details can be at most 300 characters. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:67 | You already have 5 reports waiting for an officer. Once one is marked fixed or dismissed you can file another. | APPROVED (owner, by exception, 2026-10-20) |

#### /item name: screenshot: (formerly /item image)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:147 | Thanks: your screenshot of **\<item>** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on `/item`. | DRAFT (changes approved copy) |
| src/commands/images.ts:58 | Screenshots need a vault channel first: a server admin runs `/guildcraft setup vault:` with a private channel for officers. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:90 | Attach the screenshot in the `screenshot:` box. Nothing was saved. | DRAFT (changes approved copy) |
| src/commands/images.ts:91 | That file is \<size> MB; the limit is 8 MB. A cropped screenshot of the item window is plenty. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:109 | Your screenshot of **\<item>** is still waiting for an officer. You can send another once it is approved or rejected. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:110 | You have 5 screenshots waiting for an officer. You can send more once some are reviewed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:113 | Sorry, I couldn't read that attachment from Discord. Please try again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:115 | That file is over the 8 MB limit. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:117 | That file is not a PNG, JPEG or WebP image. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:139 | Sorry, I couldn't post that screenshot to the vault. Nothing is waiting for review. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:138 | (added in the middle of the line above when Discord refuses for permissions) I may have lost a permission in the vault channel: an admin can run `/guildcraft setup vault:` again to check. | APPROVED (owner, by exception, 2026-10-20) |

### /officer (officers; formerly /recipe and /guildcraft remove-member)

#### /officer recipe-source (formerly /recipe source)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:132 | Set how a recipe is obtained (this server only) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:135 | `how` option: How it is obtained | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:12 | `how` choices: Vendor · Reputation · Discovery · Unknown | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:137 | `faction` option: Reputation recipes: the faction that sells it (type any name) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:138 | `note` option: Optional: vendor, standing needed, or a hint | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:185 | Saved for this server: **\<recipe>** is now **\<Vendor / Reputation / Discovery / Unknown>** (\<faction>) · \<note>. \<what it changes, below><br>-# Only this server sees this, and the nightly data update won't overwrite it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:181 | (what it changes, reputation) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, needs reputation (\<faction>)". | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:181 | (what it changes, discovery) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, recipe not marked known". | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:183 | (what it changes, vendor) `/item` groups crafters by skill as usual (Reliable, Still learning) and says it may need buying first. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:184 | (what it changes, unknown) `/item` groups crafters by skill as usual (Reliable, Still learning), with a note to check the crafter has the recipe. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:167 | `how` must be one of: vendor, reputation, discovery, unknown. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:170 | A reputation recipe needs `faction:`, the faction that sells it, so members know what to work toward. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:171 | Keep `faction` to 80 and `note` to 200 characters. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |

#### /officer recipe-fix (formerly /recipe override)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:144 | Correct a recipe's trivial or ingredients (this server only) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:147 | `trivial` option: The correct trivial | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:148 | `components` option: The full ingredient list, e.g. 2 Copper Bar, 1 Flux | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:149 | `reset` option: True: remove this server's correction | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:250 | Saved for this server: **\<recipe>** now shows trivial **\<number>** and ingredients \<quantity> × \<ingredient>, …, marked guild-corrected on `/item`. `reset:True` removes the correction.<br>-# Only this server sees this, and the nightly data update won't overwrite it. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:215 | Reset **\<recipe>**: its trivial and ingredients come from the wiki data again (they already did). ("(they already did)" only when there was nothing to reset) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:219 | Give `trivial:`, `components:` or both, or `reset:True` to remove this server's correction. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:220 | `trivial` must be a whole number from 0 to \<skill cap>. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:224 | I couldn't read `components`. Write them like `2 Copper Bar, 1 Flux`. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:232 | Nothing was changed. No item is named exactly: **\<name>**, **\<name>**. Check the spelling against `/item`. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:234 | Nothing was changed: an item is listed twice. Give each item once, with its total quantity. | APPROVED (owner, by exception, 2026-10-20) |

#### /officer remove-member (formerly /guildcraft remove-member)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:155 | Remove a member's characters and mark them as left (shows a preview first) | DRAFT (changes approved copy: "Officers: " dropped, now under /officer) |
| src/commands/definitions.ts:156 | `member` option (formerly `user`): The member to remove | DRAFT (changes approved copy) |
| src/commands/members.ts:27 | This will remove \<n> character(s): **\<character>** (\<class>, level \<level>), … | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:28 | **\<member name>** has no characters registered. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:32 | **\<member name>** is then marked as having left: hidden from `/item`, `/roster` and the roster board until they use GuildCraft again. | DRAFT (changes approved copy) |
| src/commands/members.ts:33 | Their skills are kept, and **Add character** on `/me` with the same name restores a character. Nothing is deleted. | DRAFT (changes approved copy) |
| src/commands/members.ts:24 | @\<member> has never used GuildCraft in this server, so there is nothing to remove. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:22 | Pick the member to remove. | APPROVED (owner, by exception, 2026-10-20) |

(Confirm and Cancel are under Buttons and menus.)

### /roster

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:164 | `/roster`: The guild's crafters, by tradeskill or by member | APPROVED (owner, by exception, 2026-10-20) |

#### /roster skill

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:171 | Everyone with a tradeskill, ranked by skill level | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:172 | `min_level` option: Only show skill levels at or above this | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:74 | Card title: \<tradeskill>: \<number> character(s) at \<min level>+ ("at …+" only with min_level) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:70 | **\<rank>.** **\<character>** \<skill level> · \<class> level \<level> · *stale* | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:75 | No one in the guild has recorded \<tradeskill> at \<min level>+ yet. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:76 | Footer: Page \<n> of \<pages> · stale = not updated in \<number> days | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:110 | min_level must be a whole number from 0 to \<skill cap>. | APPROVED (owner, by exception, 2026-10-20) |

#### /roster member

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:177 | One member's characters and skills | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:178 | `member` option: The member | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:161 | @\<member>: \<number> character(s) (showing \<number>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:160 | @\<member> has no characters on the roster. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:151 | Card title: \<character> (main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:19 | \<class> level \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:154 | **\<tradeskill>** \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:157 | No skills recorded. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:167 | Pick a member. | APPROVED (owner, by exception, 2026-10-20) |

#### /roster top

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:180 | The top 3 characters in each tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:192 | Card title: Top 3 in each tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:190 | **\<tradeskill>**: \<character> \<level> · \<character> \<level> · \<character> \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:193 | No one in the guild has recorded a tradeskill yet. | APPROVED (owner, by exception, 2026-10-20) |

#### /roster recipes

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:184 | Who knows the reputation and discovery recipes | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:185 | `skill` option: Optional: one tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:299 | Card title: Reputation and discovery recipes · \<tradeskill>: \<number> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:297 | **\<item>** · \<tradeskill> · \<Reputation / Discovery> (\<faction>): \<character>, \<character> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:286 | No one has marked a reputation or discovery recipe as known yet. Officers set how a recipe is obtained with `/officer recipe-source`; members then mark the ones they know with the **I know this recipe** button on `/item`. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:301 | Footer: Page \<n> of \<pages> | APPROVED (owner, by exception, 2026-10-20) |

### /guildcraft (admins)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:169 | `/guildcraft`: GuildCraft settings for this server (admins) | DRAFT (changes approved copy: "(admins)" added) |

#### /guildcraft setup

(The setup description, with the request channel, is under Order 16.)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:179 | `member_role` option: Members need this role to use GuildCraft (default: anyone) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:205 | `officer_role` option: Officers: edit entries, handle departures, reports, screenshots and recipe data | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:206 | `board` option: A forum channel for the roster board: one post per tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:207 | `review` option: A private text channel for officers: departure notices and member reports | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:208 | `vault` option: A private text channel for officers: item screenshots waiting for approval | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:158 | Current settings: (then the five lines below) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:191 | Saved. (then the five lines below) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:15 | Member role: @\<role> — or: Member role: none (anyone in the server can use GuildCraft) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:16 | Officer role: @\<role> (Administrator and Manage Server always count as officers) — or: Officer role: none (Administrator and Manage Server always count as officers) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:19 | Roster board: #\<channel> — or: Roster board: not set (`board:` picks a forum channel) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:21 | Review channel: #\<channel> — or: Review channel: not set (`review:` picks a private text channel for departure notices and reports) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:23 | Vault channel: #\<channel> — or: Vault channel: not set (`vault:` picks a private text channel for item screenshots) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:267 | Screenshots sent with `/item screenshot:` will wait in #\<channel> for an officer's **Approve** or **Reject**. Screenshots already in an earlier vault stay where they are. | DRAFT (changes approved copy) |
| src/commands/setup.ts:106 | **Note:** everyone in the server can see #\<channel>, so screenshots waiting for approval will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel, then add your officer role with View Channel on. The setting is saved either way. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:196 | **Note:** I couldn't check who can see #\<channel>. The vault should be a channel only officers can see. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:199 | Departure notices will go to #\<channel>: one per member who leaves the server, checked nightly, with **Remove characters** and **Keep** buttons for officers. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:103 | **Note:** everyone in the server can see #\<channel>, so departure notices (a member's name and characters) will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel, then add your officer role with View Channel on. The setting is saved either way. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:107 | **Note:** I couldn't check who can see #\<channel>. Departure notices should go to a channel only officers can see. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:211 | Building the board now: \<number> tradeskill post(s) plus a pinned index post. Most appear within a minute, all within 15 minutes. If nothing shows, reload Discord. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:212 | The board already has every tradeskill post; refreshing it now. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:214 | The old board's posts in #\<channel> are left as they are. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:113 | #\<channel> is not a forum channel. The roster board needs a forum channel: create one (Create Channel → Forum), then pick it here. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:118 | #\<channel> is not a text channel. Create a private text channel for officers, then pick it here. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:123 | #\<channel> is not a text channel. Create a private text channel for officers, then pick it here. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:131 | Sorry, Discord didn't send that channel's details. Run the command again and pick the channel from the list. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:140 | Sorry, I couldn't read my permissions in #\<channel>. Nothing was changed; please try again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:144 | Nothing was changed. In #\<channel> GuildCraft is missing: **\<permission>**, **\<permission>**.<br>Give MNM-Guildcraft these permissions in the channel's settings (Permissions), then run this again. | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:49 | Permission name: View Channel | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:50 | Permission name: Send Messages (in a forum: Create Posts) | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:51 | Permission name: Send Messages in Threads (Send Messages in Posts) | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:52 | Permission name: Embed Links | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:53 | Permission name: Attach Files | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:54 | Permission name: Read Message History | APPROVED (owner, by exception, 2026-10-20) |
| src/permissions.ts:55 | Permission name: Manage Threads (Manage Posts, to pin the index) | APPROVED (owner, by exception, 2026-10-20) |

#### /guildcraft status

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:211 | Data version, last data update, the roster board and departures | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:300 | ## GuildCraft status | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:302 | (dev only) **Copy:** dev | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:303 | **Data version:** `<version>` — or: **Data version:** no completed import yet | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:304 | **Last data update:** \<date and time> (\<time ago>) · \<number> warning(s) (or: warnings unreadable) · \<ok / failed / …> — after a failure: failed. If this repeats, tell Joegandomi. (dev: failed: \<error>) — or: **Last data update:** none yet | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:297 | **Latest nightly run:** \<date and time> (\<time ago>) · **\<status>** — with an error: **\<status>**. If this repeats, tell Joegandomi. (dev: **\<status>**: \<error>) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:289 | (dev only) **Last test update:** \<date and time> (\<time ago>) (no changes saved) · \<number> warning(s) (or: warnings unreadable) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:221 | (any time that has not happened) never | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:308 | **Roster board:** #\<channel> · \<n> of \<n> posts · last refresh \<date and time> (\<time ago>) · \<n> waiting to refresh | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:309 | **Roster board:** not set up (`/guildcraft setup board:`) | APPROVED (owner, by exception, 2026-10-20) |
| src/board/order.ts:36 | **Board order:** A→Z | APPROVED (owner, by exception, 2026-10-20) |
| src/board/order.ts:36 | **Board order:** out of order — run `/guildcraft rebuild-board` | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:311 | **Review channel:** #\<channel> — or: **Review channel:** not set (`/guildcraft setup review:`) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:312 | **Waiting for officers:** \<n> open report(s) · \<n> pending screenshot(s) in #\<channel> — or, with no vault: … (no vault channel: `/guildcraft setup vault:`) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:313 | **Departures:** \<n> member(s) marked as left · last nightly check \<date and time> (\<time ago>) · \<n> marked · note: \<note, below> | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:197 | (departures note) \<n> of \<n> members seemed to leave at once, so nobody was hidden (safety check). | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:225 | (departures note) no review channel set: notices wait until /guildcraft setup review: is set | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:242 | (departures note) More notices come tomorrow night (up to 10 a night). | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:248 | (departures note) the review channel refused a notice; the rest wait for the next run | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:254 | (departures note) More notices come tomorrow night (up to 10 a night). (more than 10 owed) | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:83 | (departures note) Couldn't read the full member list, so nobody was hidden. If this repeats, tell Joegandomi. (a page not read) | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:84 | (departures note) Discord refused the member list. Tell Joegandomi. | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:87 | (departures note) Couldn't read the full member list, so nobody was hidden. If this repeats, tell Joegandomi. (not a list) | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:91 | (departures note) Couldn't read the full member list, so nobody was hidden. If this repeats, tell Joegandomi. (the list did not advance) | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:92 | **Backup:** last \<date and time> · \<token> (dev only) · \<size> | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:88 | (backup, never good) never succeeded | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:81 | (dev only) (backup token) token expires \<date> | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:82 | (dev only) (backup token) token: no expiry (owner's note) — or: token expires unknown | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:89 | (backup) latest run \<date and time> **failed**. If this repeats, tell Joegandomi. (dev: **failed**: \<error>) | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:91 | (backup) **overdue**: no backup in over 36 hours | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:87 | **Backup:** none yet | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:65 | (dev only) **Usage against the free-tier limits** (whole Cloudflare account, per UTC day; target under 10%) · measured \<date and time> · **figures overdue** (not measured in 36 hours) ("figures overdue …" only when old) | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:74 | (dev only) - \<limit name>: \<amount> of \<limit> (\<percent>) on \<day> · 7-day peak \<amount> of \<limit> (\<percent>) (\<day>, \<n> day(s) measured) | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:69 | (dev only) - \<limit name>: not measured | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:63 | (dev only) **Usage against the free-tier limits:** none yet | APPROVED (owner, by exception, 2026-10-20) |
| src/limits.ts:17 | (dev only) Limit name: Commands and lookups | APPROVED (owner, by exception, 2026-10-20) |
| src/limits.ts:19 | (dev only) Limit name: Records read | APPROVED (owner, by exception, 2026-10-20) |
| src/limits.ts:21 | (dev only) Limit name: Records written | APPROVED (owner, by exception, 2026-10-20) |
| src/limits.ts:23 | (dev only) Limit name: Stored data | APPROVED (owner, by exception, 2026-10-20) |
| src/limits.ts:25 | (dev only) Limit name: Log entries | APPROVED (owner, by exception, 2026-10-20) |

#### /guildcraft rebuild-board

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:212 | Recreate the roster board posts in A→Z order (posts with replies are kept) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:332 | Rebuilding the roster board in #\<channel> in A→Z order: each tradeskill post is created again, then the old one is deleted. Posts with member replies are kept as they are. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:333 | Most of it happens within a minute, all of it within 15 minutes. `/guildcraft status` shows the board order. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:334 | For A→Z to show at the top, the forum's Default Sort Order must be Creation Time (Edit Channel). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/setup.ts:326 | There is no roster board yet. Set one up first with `/guildcraft setup board:`. | APPROVED (owner, by exception, 2026-10-20) |

## Buttons and menus

### Update skills (on the Add character and /skills replies, and on /me) and the /skills menu

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:138 | Button: Update skills — or, with several characters: Update \<character> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:103 | Menu placeholder: Tradeskills: pick up to 5 (with many tradeskills: Tradeskills A–M: pick up to 5, Tradeskills N–Z: pick up to 5, and "(1/2)" when a half is split; labels at lines 78–87) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:109 | Menu option note: Now \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:176 | Form title: Levels for \<character> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:180 | Form box (one per tradeskill, labelled with its name): 0 to \<skill cap> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:237 | Saved for **\<character>**: \<tradeskill> **\<level>** (was \<old level>), \<tradeskill> **\<level>**. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:240 | Nothing was saved. **\<tradeskill>**: "\<typed>" is not a whole number from 0 to \<skill cap>.<br>Run `/skills` again to retry. | DRAFT (changes approved copy) |
| src/commands/skills.ts:174 | That character is no longer available. Run `/skills` again. (the words before "Run" at line 174, "Run `/skills` again." at line 28) | DRAFT (changes approved copy) |
| src/commands/skills.ts:189 | Those tradeskills are no longer in the list. Run `/skills` again. | DRAFT (changes approved copy) |
| src/commands/skills.ts:235 | That form is out of date. Run `/skills` again. | DRAFT (changes approved copy) |

### Post to channel and links

| Where | Text | Status |
|---|---|---|
| src/commands/share.ts:11 | Button: Post to channel | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:50 | Link button: Wiki | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:51 | Link button: MnMdb | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:52 | Link button: MNM Realm | APPROVED (owner, by exception, 2026-10-20) |

### /item card buttons (and /craft find cards posted before order 18)

(Report a recipe problem, Report item data and Request a craft on /item are under Work order 18.)

| Where | Text | Status |
|---|---|---|
| src/commands/item.ts:33 | Button: I know this recipe (also src/commands/find.ts:298, old cards) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/item.ts:34 | Button: Report a problem (an item with no recipe; also src/commands/find.ts:298, old cards) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/item.ts:38 | Button: Stat image (also src/commands/find.ts:298, old cards) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:96 | (I know this recipe, several characters or recipes) Which character knows which recipe? (showing the first 25 of \<n>) | DRAFT (changes approved copy) |
| src/commands/recipes.ts:110 | Menu placeholder: Pick a character and recipe | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:114 | Menu option: \<character> (main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:115 | Menu option note: \<tradeskill> · trivial \<number> (or: trivial unknown) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:122 | That character is no longer available. Run `/item` again. | DRAFT (changes approved copy) |
| src/commands/recipes.ts:124 | That recipe is no longer in the data. Run `/item` again. | DRAFT (changes approved copy) |
| src/commands/reports.ts:97 | Report a problem form title: Report a problem (also Report a recipe problem and Report item data) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:101 | Form field: What is wrong? (the issue choices under Report a problem, above; item data: under Work order 13) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:107 | Form field: Details (optional) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:108 | Form field note: What should it be? Up to 300 characters. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:131 | That item is no longer in the data. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:203 | Stat image reply: a card titled \<item> with the screenshot, footer: Screenshot from a guild member, approved by an officer | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:201 | No screenshot of **\<item>** yet. Have one? Send it with `/item` and `screenshot:`: an officer approves it, then it shows here. | DRAFT (changes approved copy) |
| src/commands/images.ts:214 | Sorry, I couldn't fetch the screenshot from Discord just now. Please try again in a moment. | APPROVED (owner, by exception, 2026-10-20) |

### Paging and switching (/roster skill, /roster recipes)

| Where | Text | Status |
|---|---|---|
| src/commands/roster.ts:84 | Button: ◀ Previous (also src/commands/recipes.ts:311) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:85 | Button: Next ▶ (also src/commands/recipes.ts:312) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:95 | Menu placeholder: Switch tradeskill — or Switch tradeskill (A–M), Switch tradeskill (N–Z) | APPROVED (owner, by exception, 2026-10-20) |

### Report card buttons (review channel, officers)

| Where | Text | Status |
|---|---|---|
| src/commands/reports.ts:45 | Button: Mark fixed | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:45 | Button: Dismiss | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:152 | (the card, after a press) ✅ Marked fixed by @\<officer> · \<date and time> — or: ✖️ Dismissed by @\<officer> · \<date and time> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:149 | That report is no longer recorded. | APPROVED (owner, by exception, 2026-10-20) |

### Vault buttons (vault channel, officers)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:53 | Button: Approve | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:53 | Button: Reject | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:178 | (the vault post, after Approve) Screenshot of **\<item>** · approved by @\<officer> · \<date and time> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:185 | Rejected the screenshot of **\<item>** and deleted it from the vault. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:183 | Rejected, but I couldn't delete the vault message; please delete it by hand. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:174 | That screenshot was already \<approved / rejected>. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:173 | That screenshot is no longer recorded. | APPROVED (owner, by exception, 2026-10-20) |

### Remove-member preview (officers)

| Where | Text | Status |
|---|---|---|
| src/commands/members.ts:34 | Button: Confirm | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:34 | Button: Cancel | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:50 | Done: removed **\<member name>** and \<n> character(s): **\<character>** (\<class>, level \<level>), …. Their skills are kept: **Add character** on `/me` with the same name restores a character. (text at lines 40–41; "(no characters)" in place of the list when there are none) | DRAFT (changes approved copy) |
| src/commands/members.ts:46 | Cancelled. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:48 | @\<member> has never used GuildCraft in this server, so there was nothing to remove. | APPROVED (owner, by exception, 2026-10-20) |

### Departure notice buttons (review channel, officers)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:160 | Button: Remove characters | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:160 | Button: Keep | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:71 | (the notice, after Remove) @\<officer> removed **\<member name>** and \<n> character(s): …. Their skills are kept: **Add character** on `/me` with the same name restores a character. (text at lines 40–41) | DRAFT (changes approved copy) |
| src/commands/members.ts:64 | (the notice, after Keep) @\<officer> kept **\<member name>**'s characters. They stay hidden while \<member name> is away and show again once they're back and use GuildCraft. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:60 | **\<member name>** is back and active again, so nothing was changed. (Checked by @\<officer>.) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:58 | This member is no longer recorded. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:56 | Sorry, that button has expired. | APPROVED (owner, by exception, 2026-10-20) |

## Cards and posts

### Report card (review channel, from Report a problem, Report a recipe problem and Report a missing recipe)

| Where | Text | Status |
|---|---|---|
| src/commands/reports.ts:44 | Title: Report: \<item> (or, for a name the data lacks, the name typed in Report a missing recipe; or: Report: unknown item) | DRAFT (changes approved copy) |
| src/commands/reports.ts:40 | **Issue:** \<issue> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:40 | **From:** @\<member> · \<date and time> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:40 | **Details:** \<details> (only when given) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:49 | Footer: Report #\<number> · fix the data with /officer recipe-fix or /officer recipe-source, then mark it fixed | DRAFT (changes approved copy) |

### Departure notice (review channel, nightly)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:146 | Title: \<member name> left the server | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:143 | (name when unknown) A member | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:149 | **Characters**<br>**\<character>** (\<class>, level \<level>), one per line | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:144 | No characters registered. | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:165 | While they are away their characters are hidden from `/item`, `/roster` and the roster board. If they come back and use GuildCraft, they show again. | DRAFT (changes approved copy) |
| src/departures.ts:166 | **Remove characters** removes the characters (their skills are kept; **Add character** on `/me` with the same name restores one). **Keep** leaves them as they are. Officers only. | DRAFT (changes approved copy) |

### Usage warning (review channel of the dev copy only: the operator's test server)

| Where | Text | Status |
|---|---|---|
| src/usage.ts:106 | (dev only) Free-tier usage: **\<limit name>** was \<amount> of \<limit> (\<percent>) on \<day>, at or over GuildCraft's 10% target. Nothing stops until 100%; `/guildcraft status` shows every figure. | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:107 | (dev only) Free-tier usage: **\<limit name>** is back under the 10% target: \<amount> of \<limit> (\<percent>) on \<day>. | APPROVED (owner, by exception, 2026-10-20) |

### Vault screenshot post (vault channel, from /item screenshot:)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:128 | Screenshot of **\<item>** from @\<member> · waiting for an officer (with the image, and Approve and Reject) | APPROVED (owner, by exception, 2026-10-20) |

### Roster board (forum channel)

| Where | Text | Status |
|---|---|---|
| src/board/refresh.ts:178 | Post name: \<tradeskill> | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:52 | (order 22) First-message line, shown in the forum list's preview: \<tradeskill> · \<n> character(s) · top: \<character> \<level> | DRAFT |
| src/board/render.ts:53 | (order 22) First-message line, no one listed: \<tradeskill> · no one listed yet: /skills to get listed | DRAFT |
| src/board/render.ts:82 | \<n> character(s) (\<n> member(s)), ranked by skill level. (count at line 62) | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:78 | **\<rank>.** **\<character>** · \<member name> · \<skill level> · *stale* | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:83 | No one in the guild has recorded \<tradeskill> yet. Use `/skills` to get listed. | DRAFT (changes approved copy) |
| src/board/render.ts:84 | Footer: stale = not updated in \<number> days | APPROVED (owner, by exception, 2026-10-20) |

### Roster board index (pinned post)

| Where | Text | Status |
|---|---|---|
| src/board/render.ts:161 | Post name: Index: how to get listed | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:57 | (order 22) First-message line, shown in the forum list's preview: How to get listed · \<n> tradeskill(s) · /me to start | DRAFT |
| src/board/render.ts:156 | Title: Crafting roster: index | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:150 | #\<tradeskill post> · \<n> character(s) — or, before the post exists: \<tradeskill> *(post coming)* · \<n> character(s) | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:130 | **How to get listed** | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:132 | 1. `/me`, then **Add character**. | DRAFT (changes approved copy) |
| src/board/render.ts:133 | 2. `/skills` a tradeskill level, or `/skills` alone for several at once. | DRAFT (changes approved copy) |
| src/board/render.ts:134 | 3. Your tradeskill posts update within about a minute. | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:136 | **Also** | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:137-140 | The "Also" lines (order 18; replace the order 10, 13, 16 and 17b lines): under Work order 18 | DRAFT (changes approved copy) |
| src/board/render.ts:153 | Last refresh: \<date and time> (\<time ago>) | APPROVED (owner, by exception, 2026-10-20) |

## Help and welcome

### /help (formerly the /craft help reply)

`/help` is paged (order 18): each page lists its commands from their registered descriptions, as `` `/command` what it does ``. A command not built yet ends with *(coming soon)* (src/commands/help.ts:8); today that is only `/recipe add`. The pages, their lines and the title are under Work order 18.

| Where | Text | Status |
|---|---|---|
| src/commands/help.ts:10 | Questions or problems: send a Discord message to **Joegandomi**, who runs GuildCraft. (new in order 10; shown at the end of the Getting started page, line 45, and of the welcome) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:7 | Footer of every page: Item data: Monsters and Memories Wiki (CC BY-SA 4.0) | APPROVED (owner, by exception, 2026-10-20) |

### Welcome (shown once, privately, with a new member's first reply, and with /me when there are no characters yet)

| Where | Text | Status |
|---|---|---|
| src/commands/welcome.ts:7 | Title: Welcome to GuildCraft | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:9 | Three steps to get started: | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:10 | **1.** `/me`: press **Add character** to register your character. Your first one becomes your main. | DRAFT (changes approved copy) |
| src/commands/welcome.ts:11-12 | **2.** `/skills`: press Enter, pick up to 5 tradeskills, then type their levels. (`/skills skill: level:` sets one.)<br>Or press **Update skills** on your `/me`. | DRAFT (changes approved copy) |
| src/commands/welcome.ts:13 | **3.** `/item`: look up any item, and who in the guild can make it. | DRAFT (changes approved copy) |
| src/commands/welcome.ts:15 | *You see this message once. `/help` shows every command.* | DRAFT (changes approved copy) |
| src/commands/welcome.ts:16 | The contact line (src/commands/help.ts:10), naming Joegandomi | APPROVED (owner, by exception, 2026-10-20) |

## Errors shared by many commands

| Where | Text | Status |
|---|---|---|
| src/respond.ts:16 | Sorry, something went wrong on our side and GuildCraft could not answer. Please try again in a moment. If it keeps happening, tell Joegandomi. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:35 | Sorry, that command isn't available. Type `/help` to see every command. (also the old command names, no longer registered) | DRAFT (changes approved copy) |
| src/interactions.ts:36 | Sorry, GuildCraft works inside a server, not in direct messages. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:37 | Only server admins (Administrator or Manage Server) can change GuildCraft settings. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:38 | Sorry, that menu has expired. Run the command again. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:39 | GuildCraft in this server is for members with the @\<role> role. Ask an officer if you should have it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:13 | Only officers can do that. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:37 | Only officers can change another member's characters. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:38 | **\<name>** is already taken in this guild. Character names are unique (capital letters don't count). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:41 | You have no character named **\<name>**. — or, for an officer naming a member: @\<member> has no character named **\<name>**. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:45 | You have no characters yet. Add one with **Add character** on `/me`. — or: @\<member> has no characters yet. | DRAFT (changes approved copy) |
| src/commands/skills.ts:36 | I don't know a tradeskill called **\<typed text>**. Pick one from the list as you type. (also src/commands/recipes.ts:333, src/commands/roster.ts:108) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:78 | I don't know an item called **\<typed text>**. Pick one from the list as you type. (also src/commands/images.ts:100) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:24 | No recipe found for **\<typed text>**. Pick a recipe from the list as you type. (/officer recipe-source, /officer recipe-fix) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:28 | **\<item>** has \<n> recipes (\<tradeskill>, trivial \<number>; \<tradeskill>, trivial \<number>). Pick the one you mean from the list as you type. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:282 | That item no longer has a recipe. Run `/item` again. (also src/commands/recipes.ts:91, src/commands/requests.ts:161) | DRAFT (changes approved copy) |
| src/commands/roster.ts:121 | That tradeskill is no longer in the list. Run `/roster skill` again. (also lines 129 and 208) | APPROVED (owner, by exception, 2026-10-20) |

## Counts

| Group | Strings |
|---|---|
| Commands | 238 |
| Buttons and menus | 57 |
| Cards and posts | 29 |
| Help and welcome | 9 |
| Errors shared by many commands | 17 |
| **Total** | **350** |

Work order 11 (2026-10-20) approved all 411 lines then listed. After work order 18, 350 lines are listed above: 306 still approved, and 44 DRAFT because their words changed with the new command names (each is also in the Work order 18 table). The lines the bot no longer shows (the old command and option descriptions, the old `/craft help` reply, `/craft notify`'s replies and the like) were taken out.

## Work order 13: /gear find (DRAFT; now /gear)

Every line below is DRAFT until approved. \<label> is a filter as the member set it (for example "slot: CHEST"). Order 18 made `/gear find` the command `/gear` (its description is under Work order 18) and uses its item card for `/item`; the options below are `/gear`'s.

| Where | Text | Status |
|---|---|---|
| src/gear/options.ts:64 | `class` option: Your class, or Any (required) | DRAFT |
| src/gear/options.ts:65 | `slot` option: Only items for this slot | DRAFT |
| src/gear/options.ts:66 | `weapon_type` option: Only weapons of this type (the code the wiki uses) | DRAFT |
| src/gear/options.ts:67 | `min_ac` option: Only items with at least this much AC | DRAFT |
| src/gear/options.ts:68 | `min_ratio` option: Only weapons with at least this damage ÷ delay | DRAFT |
| src/gear/options.ts:72 | `stat1`, `stat2`, `stat3` options: Only items with all the stats you pick | DRAFT |
| src/gear/options.ts:75 | `source` option: Where it comes from, as the wiki records it | DRAFT |
| src/gear/options.ts:76 | `sort` option: Highest first (Name: A→Z). Default: Ratio for weapons, otherwise AC | DRAFT |
| src/commands/gear.ts:33 | Results title: Gear finder | DRAFT |
| src/commands/gear.ts:34 | Results footer: Page \<n> · sorted by \<sort> · Item data: Monsters and Memories Wiki, CC BY-SA 4.0 · data \<version> | DRAFT |
| src/commands/gear.ts:53 | -# Class is required: pick yours, or Any. | DRAFT |
| src/commands/gear.ts:54 | -# Ratio = damage ÷ delay (none when delay is 0 or missing). | DRAFT |
| src/commands/gear.ts:55 | -# Sources come from the community wiki; Unknown means the wiki has not recorded one. | DRAFT |
| src/commands/gear.ts:35 | No gear is loaded yet. The data arrives with the nightly import from the community wiki. | DRAFT |
| src/commands/gear.ts:36 | No items match all of those filters. | DRAFT |
| src/commands/gear.ts:37 | The filter that removed the most is **\<label>**: without it, \<number> item(s) match. Try relaxing it. | DRAFT |
| src/commands/gear.ts:38 | Even with any one filter removed, nothing matches. Try fewer filters. | DRAFT |
| src/commands/gear.ts:65 | Pick a class (or Any). | DRAFT |
| src/commands/gear.ts:41 | Classes: All | DRAFT |
| src/commands/gear.ts:42 | Classes: no class listed | DRAFT |
| src/commands/gear.ts:40 | ⚠ stats may be wrong (wiki) | DRAFT |
| src/commands/gear.ts:195 | Drop: \<mob> (L\<level>, \<zone>), … +\<n> more · zones: \<zone>, … +\<n> more | DRAFT |
| src/commands/gear.ts:204 | Crafted: \<tradeskill>, trivial \<number>, \<number> guild character(s) can make it | DRAFT |
| src/commands/gear.ts:49 | (trivial unknown) \<number> guild character(s) with \<tradeskill> (trivial unknown) | DRAFT |
| src/commands/gear.ts:50 | Vendor: price \<number> · \<vendors as recorded> (or: Vendor: price not recorded) | DRAFT |
| src/commands/gear.ts:225 | Quest | DRAFT |
| src/commands/gear.ts:227 | Unknown: source not recorded | DRAFT |
| src/commands/gear.ts:43 | Details menu placeholder: Details: pick an item | DRAFT |
| src/commands/gear.ts:44 | Button: Previous | DRAFT |
| src/commands/gear.ts:45 | Button: Next | DRAFT |
| src/commands/gear.ts:55 | That item is no longer in the data. Run `/gear` again. | DRAFT |
| src/commands/gear.ts:329 | Item card field: Drop: mobs | DRAFT |
| src/commands/gear.ts:330 | Item card field: Drop: zones | DRAFT |
| src/commands/gear.ts:334 | Item card field: Vendor (price \<number> · shady price \<number>, then the vendors as recorded) | DRAFT |
| src/commands/gear.ts:57 | Button: Report a problem (on the item card) | DRAFT |
| src/commands/gear.ts:58 | Button: Stat image (on the item card) | DRAFT |
| src/recipes.ts:27 | Item report issue: Wrong stats | DRAFT |
| src/recipes.ts:28 | Item report issue: Wrong source | DRAFT |
| src/recipes.ts:29 | Item report issue: Wrong class | DRAFT |
| src/commands/reports.ts:43 | Review card title: Item report: \<item> | DRAFT |
| src/commands/reports.ts:47 | Review card footer: Report #\<n> · item data comes from the community wiki: correct it there, then mark it fixed | DRAFT |

## Order 16: names and craft requests

Member lines (ITEM 1, no new words): `**1.** **Character** · @member (saved name) · level` on the board (src/board/render.ts:47), the same `· @member (saved name)` after each crafter on `/item` (formerly `/craft find`; src/commands/find.ts:143) and `/roster skill` (src/commands/roster.ts:72), after the name on `/roster top` and `/roster recipes`, and the `/roster member` header `@member (saved name): N characters`.

| Where | Text | Status |
|---|---|---|
| src/requests.ts:41 | An admin needs to run `/guildcraft setup requests:` first. | DRAFT (the order's own words) |
| src/commands/definitions.ts:110-116 | `/request` (formerly `/craft request`): Ask the opted-in crafters who can make an item, in a private thread · `item`: An item that has a recipe: pick from the list · `quantity`: How many (default 1) · `note`: Optional: anything the crafter should know (up to 300 characters) | DRAFT |
| src/commands/definitions.ts:177, 184 | `/guildcraft setup`: Set the roles, roster board, and review, vault and request channels (leave all out to see them) · `requests`: A text channel for craft requests: one private thread per request | DRAFT |
| src/commands/item.ts:37 | Button: Request a craft (on an /item card; also src/commands/find.ts:301, old cards) | DRAFT |
| src/commands/requests.ts:77-78, 90, 199 | `quantity` must be a whole number from 1 to 1000. · Keep the note to 300 characters. · A request holds up to 5 items. Send this one first, then start another. | DRAFT |
| src/commands/requests.ts:124-125 | No opted-in crafter can make it yet, and no one else in the guild can either (by `/item`'s Reliable list). · No opted-in crafter can make it yet. These crafters can, but haven't turned on request notices, so ask them directly: \<members> (the first changed in order 18) | DRAFT |
| src/commands/requests.ts:135-142 | **Your craft request** (not sent yet) · for #\<channel> / \<n>. **\<item>** ×\<qty> · \<n> opted-in crafter(s) can make it: \<members> / **Note:** \<note> / -# **Send request** opens a private thread in #\<channel> with you and the crafters, who are pinged there. Up to 5 items: **Add item**, or run `/request` again. (the last changed in order 18) | DRAFT |
| src/commands/requests.ts:115-117 | Buttons: Send request · Add item · Discard | DRAFT |
| src/commands/requests.ts:171-181 | Form: Add an item · Item: The exact item name. Or run /request again: it picks from a list and adds to this request. · Quantity (the Item note changed in order 18) | DRAFT |
| src/commands/requests.ts:198 | No recipe found for **\<typed>**. … In the form the name must match exactly; `/request item:` picks from the list and adds to this request. (changed in order 18) | DRAFT |
| src/commands/requests.ts:71, 210 | That request was already sent or discarded. Run `/request` to start another. (changed in order 18) · Discarded. Nothing was sent. · That request was already sent or discarded. | DRAFT |
| src/commands/requests.ts:262-264 | Not sent: no opted-in crafter can make it yet, so no thread was opened. Your request is kept, unsent. / Left out: / @member (name): \<why> | DRAFT |
| src/commands/requests.ts:279-283, 320 | Left-out reasons: no longer in the server · can't see #\<channel> · over the 20-crafter limit for one request · Discord refused to add them (\<status>) | DRAFT |
| src/commands/requests.ts:269, 274, 276, 311 | Sorry, GuildCraft can't reach Discord right now. Nothing was sent; please try again. · Sorry, I couldn't check who can see #\<channel>. Nothing was sent; please try again. · You can't see #\<channel>, so you couldn't open your request's thread. Ask an admin for access to it. · Sorry, Discord refused to open the thread in #\<channel> (\<status>). Nothing was sent; your request is kept, unsent. An admin can check `/guildcraft setup requests:`. | DRAFT |
| src/commands/requests.ts:339-342 | Sent: #\<thread>. \<n> crafter(s) added and pinged there. / **\<item>** ×\<qty>: \<members> (or: no crafter added) / -# The thread's first message didn't go out; it is posted within 15 minutes. | DRAFT |
| src/requests.ts:204 | Thread name: [Open] / [Claimed] / [Done] / [Cancelled] \<item> ×\<qty> (+\<n> more) · \<main character> | DRAFT |
| src/requests.ts:225-229, 241-252 | First message: ## Craft request from @requester (name) (\<main>) / **\<n>. \<item>** ×\<qty> · Open / Claimed by @member / Done (@member) / Cancelled / Crafters: \<members> (or Crafters: \<n> and Crafters added: \<mentions>) / **Note:** … / **Closed:** every item is done or cancelled · cancelled · nothing was claimed in 14 days · no activity in 30 days. / -# A crafter presses **I'll craft this** to take an item (the requester is told), and **Done** when it's handed over. The requester can **Cancel**. | DRAFT |
| src/requests.ts:259 | Thread buttons: I'll craft this · Done · Cancel (with "\<n> · " before each when there are several items) | DRAFT |
| src/commands/requests.ts:374-394, 416 | Thread notices: @requester: @crafter will craft **\<item>** ×\<qty>. · @other: **\<item>** ×\<qty> is done (marked by @member). · @other: **\<item>** ×\<qty> was cancelled by @member. · (added when the last item closes) Every item is done or cancelled, so this thread is now closed. | DRAFT |
| src/requests.ts:453 | This request closed itself: nothing was claimed in 14 days. · This request closed itself after 30 days with no activity. | DRAFT |
| src/commands/requests.ts:355-412 | Private replies to thread buttons: This request is closed. · That item is no longer in this request. · You already took this item. / Someone already took this item. · You asked for this item, so you can't take it. · Only opted-in crafters whose characters can make **\<item>** ×\<qty> can take it. · You're down to craft **\<item>** ×\<qty>. @requester has been told. Press **Done** when it's handed over. · Only an item someone has taken can be marked done. · Only the crafter who took it, or the requester, can mark it done. · Marked **\<item>** ×\<qty> done. · That item is already closed. · Only the requester can cancel an item. Officers can cancel a whole request with `/officer requests`. (changed in order 18) · Cancelled **\<item>** ×\<qty>. · Sorry, that button has expired. · Someone changed that item first. Look at the thread for its status. | DRAFT |
| src/commands/requests.ts:407-493 | Open requests and Cancel (on /me's panel and Cancel a request, and /officer requests; formerly `/craft requests`; the headings are under Work order 18): **#\<id>** #\<thread> · \<item> ×\<qty> · \<status> · from @requester · \<time> · Select: Cancel a request · That request is already closed. · Only the requester or an officer can cancel a request. · @…: This request was cancelled by @member, so this thread is now closed. · Cancelled request #\<id> (#\<thread>). | DRAFT |
| src/commands/setup.ts:26 | Request channel: #\<channel> / not set (`requests:` picks a text channel for craft requests) | DRAFT |
| src/commands/setup.ts:149 | #\<channel> is not a text channel. Craft requests open private threads, which only text channels have: pick a text channel. | DRAFT |
| src/commands/setup.ts:209 | (after the missing permissions) GuildCraft installed before craft requests existed did not ask for Create Private Threads: grant it on this channel, or re-invite GuildCraft with the current install link (ask Joegandomi). | DRAFT |
| src/commands/setup.ts:262 | Craft requests will open private threads in #\<channel>: one per request, holding the requester and the crafters who turned on **Notices** in `/me` and can make the item. Members need to see the channel to see their thread. (changed in order 18) | DRAFT |
| src/commands/setup.ts:181-186 | **Who else can read every request:** besides the requester and the crafters added, private threads in #\<channel> are visible to anyone with Manage Threads there or Administrator, and to the server owner. / Here that is: @role, @role(, and \<n> member(s) with their own Manage Threads permission in the channel). / No role holds either here. · **Note:** everyone in the server has Manage Threads in #\<channel>, so everyone can read every request. To keep requests private: Edit Channel → Permissions → @everyone → turn off Manage Threads. · **Note:** I couldn't check who can read private threads in #\<channel>. Anyone with Manage Threads there, or Administrator, can read every request. | DRAFT |
| src/permissions.ts:57 | Permission name: Create Private Threads | DRAFT |
| docs/LAUNCH-GUIDE.md | Install link (permissions=360777370624), the Create Private Threads row, "Servers that added GuildCraft before craft requests", "Who can read craft requests" | DRAFT |

## Work order 17: /zone (DRAFT)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:105 | `/zone` option `name`: The zone: pick from the list | DRAFT |
| src/gear/options.ts:78 | `/gear` option `zone` (formerly on `/gear find`): Only items the wiki lists for this zone | DRAFT |
| src/zone/card.ts:14 | **Levels:** \<level text> / not recorded | DRAFT |
| src/zone/card.ts:15-17 | Field: Map · No map yet · [Open in MnM Atlas](\<atlas>) | DRAFT |
| src/zone/card.ts:17, 22-23 | Buttons: Open in MnM Atlas · Gear here · More creatures | DRAFT |
| src/zone/card.ts:24-28 | Fields: Adjacent zones · Creatures (\<n>) · Notable spots · line: \<creature> (L\<level>) · [find on map](\<atlas ?find>) · +\<n> more | DRAFT |
| src/zone/card.ts:29 | Map credit (MnM Atlas pictures, off until ATLAS_ZONE_IMAGES is on): Map: MnM Atlas (mnmatlas.com) and its original map authors | DRAFT |
| src/zone/card.ts:30-31 | Map credit (a licensed map; none today): Map: \<author> · via \<source> · [\<licence>](\<licence link>) · [file page](\<wiki file page>) | DRAFT |
| src/zone/card.ts:32 | Footer: Sources: Monsters and Memories Wiki on Miraheze (CC BY-SA 4.0) · MnM Atlas · mnm-tools · Mo Betta | DRAFT |
| src/zone/card.ts:37-41 | Pages: Creatures in \<zone> · Page \<n> of \<m> · by level, lowest first · Previous · Next | DRAFT |
| src/zone/suggest.ts:9-12 | (`/zone`, and `/gear zone:`) No zones are loaded yet. They arrive with the nightly import. · No zone is called **\<typed>**. · Did you mean: **\<zone>**, …? · The zones: \<zone>, …. | DRAFT |
| src/commands/zone.ts:37 | That zone is no longer in the data. Run `/zone` again. | DRAFT |
| src/commands/zone.ts:41 | No classes are loaded yet. Try `/gear` once the nightly import has run. (changed in order 18) | DRAFT |
| docs/LAUNCH-GUIDE.md | "Zones (`/zone`, order 17)" and "Turning on MnM Atlas's zone pictures (operator)" | DRAFT |
| README.md | Credits: mnm-tools maps.json; Mo Betta (zones.json, npcs.json, from the wiki under CC BY-SA); MnM Atlas and its original map authors | DRAFT |

## Work order 17b: zone card fixes (DRAFT)

Replaces the order 17 rows above for the drops list, More drops, the Wiki page label and the Gear here menu.

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:102 | `/zone`: A zone: map, level range, creatures, and links to the wikis and MnM Atlas (also the `/zone` line on `/help`'s Finding things page) | DRAFT |
| src/board/render.ts:104 | Board index: `/zone` a zone's levels, creatures, wiki and map links (now on one line with `/gear`: see Work order 18) | DRAFT |
| src/zone/card.ts:16, 229 | Field: Map · No map yet (no atlas link when the zone has no atlas map) | DRAFT |
| src/zone/card.ts:18-21 | Link buttons: Wiki · MnM Wiki · Stories of MnM · Zone connections (and Open in MnM Atlas, unchanged) | DRAFT |
| src/zone/card.ts:30-32 | Field: Not recorded yet · No \<level range, description> or \<creatures> recorded for this zone yet. [MnM Atlas](\<atlas>) may have more. (the last sentence only when the zone has an atlas map) | DRAFT |
| src/zone/card.ts:37, 39 | Page: Creatures in \<zone> · by level, lowest first | DRAFT |
| src/commands/zone.ts:38 | (More drops on a card posted before this order) Zone cards no longer list drops. Press **Gear here** on the card to find the zone's gear for your class. | DRAFT |
| src/commands/zone.ts:39-40 | Gear here: Gear from **\<zone>**: pick your class (or Any). You can change the sort on the results. · Your class, or Any | DRAFT |
| src/commands/zone.ts:42 | Gear here on a zone with no gear: The wiki lists no gear from **\<zone>** yet. | DRAFT |
| src/commands/gear.ts:50-52 | (one zone's results: Gear here, or `/gear zone:`) **Gear from \<zone>** · sort menu: Sort · Sort: \<sort> | DRAFT |
| docs/LAUNCH-GUIDE.md | "Zones (`/zone`, order 17)" rewritten; "MnM Atlas's zone pictures (operator)" records the permission | DRAFT |
| README.md | Credits: MnM Atlas's permission (2026-10-21); zone links to monstersandmemories.wiki and Stories of MnM | DRAFT |

## Work order 18: the simpler commands (DRAFT)

Every line below is DRAFT until approved: the new commands' and options' descriptions, `/help`'s pages, the `/me` panel, `/item`'s card additions, `/officer requests`, and every line whose words changed because a command was renamed. A description whose words are the same as an approved one says so; it is listed because it now sits under a new command. \<page> is a `/help` page's label; \<cmd> a command as `/name sub`.

| file:line | text | status |
|---|---|---|
| src/commands/definitions.ts:36 | `/me`: Your characters, skills, recipes, notices and requests, with buttons to change them | DRAFT |
| src/commands/definitions.ts:39 | `/me` option `character`: Optional: show one character | DRAFT |
| src/commands/definitions.ts:43 | `/skills`: Set one tradeskill level, or leave the options out to update up to 5 at once | DRAFT |
| src/commands/definitions.ts:47 | `/skills` option `skill`: With level: the tradeskill to set. Leave both out to pick up to 5 | DRAFT |
| src/commands/definitions.ts:48 | `/skills` option `level`: With skill: its level | DRAFT |
| src/commands/definitions.ts:27, 49 | `/skills` option `character`: Optional; defaults to your main (same words as approved) | DRAFT |
| src/commands/definitions.ts:54 | `/item`: Any item: stats, where it comes from, its recipe and crafters, and recipes that use it | DRAFT |
| src/commands/definitions.ts:58 | `/item` option `name`: The item: pick from the list (craftable ones are marked) | DRAFT |
| src/commands/definitions.ts:59 | `/item` option `screenshot`: Optional: a screenshot of the item window, for an officer to approve | DRAFT |
| src/commands/definitions.ts:65 | `/gear`: Gear for your class, by slot, weapon type, AC, ratio, stats, source and zone (its options: src/gear/options.ts:64-78, under Work orders 13 and 17) | DRAFT |
| src/commands/definitions.ts:74 | `/roster`: The guild's crafters, by tradeskill or by member (same words as approved) | DRAFT |
| src/commands/definitions.ts:81-82 | `/roster skill`: Everyone with a tradeskill, ranked by skill level · `skill`: Tradeskill · `min_level`: Only show skill levels at or above this (same words as approved) | DRAFT |
| src/commands/definitions.ts:87-88 | `/roster member`: One member's characters and skills · `member`: The member (same words as approved) | DRAFT |
| src/commands/definitions.ts:90 | `/roster top`: The top 3 characters in each tradeskill (same words as approved) | DRAFT |
| src/commands/definitions.ts:94-95 | `/roster recipes`: Who knows the reputation and discovery recipes · `skill`: Optional: one tradeskill (same words as approved) | DRAFT |
| src/commands/definitions.ts:102, 105 | `/zone`: A zone: map, level range, creatures, and links to the wikis and MnM Atlas · `name`: The zone: pick from the list (same words as order 17b) | DRAFT |
| src/commands/definitions.ts:110 | `/request`: Ask the opted-in crafters who can make an item, in a private thread (same words as `/craft request`) | DRAFT |
| src/commands/definitions.ts:114-116 | `/request` options: `item`: An item that has a recipe: pick from the list · `quantity`: How many (default 1) · `note`: Optional: anything the crafter should know (up to 300 characters) (same words as `/craft request`) | DRAFT |
| src/commands/definitions.ts:119 | `/help`: A guide to every command, a page at a time | DRAFT |
| src/commands/definitions.ts:122 | `/officer`: Officers: recipe data, members and craft requests | DRAFT |
| src/commands/definitions.ts:132 | `/officer recipe-source`: Set how a recipe is obtained (this server only) (same words as `/recipe source`) | DRAFT |
| src/commands/definitions.ts:30, 135, 137-138 | `/officer recipe-source` options: `item`: The item: pick its recipe from the list (each shows its tradeskill and trivial) · `how`: How it is obtained (choices Vendor · Reputation · Discovery · Unknown, src/recipes.ts:12) · `faction`: Reputation recipes: the faction that sells it (type any name) · `note`: Optional: vendor, standing needed, or a hint (same words as `/recipe source`) | DRAFT |
| src/commands/definitions.ts:144 | `/officer recipe-fix`: Correct a recipe's trivial or ingredients (this server only) (same words as `/recipe override`) | DRAFT |
| src/commands/definitions.ts:30, 147-149 | `/officer recipe-fix` options: `item` (as above) · `trivial`: The correct trivial · `components`: The full ingredient list, e.g. 2 Copper Bar, 1 Flux · `reset`: True: remove this server's correction (same words as `/recipe override`) | DRAFT |
| src/commands/definitions.ts:155 | `/officer remove-member`: Remove a member's characters and mark them as left (shows a preview first) | DRAFT |
| src/commands/definitions.ts:156 | `/officer remove-member` option `member`: The member to remove | DRAFT |
| src/commands/definitions.ts:161 | `/officer edit-member`: Open a member's /me panel to change their characters and skills | DRAFT |
| src/commands/definitions.ts:162 | `/officer edit-member` option `member`: The member | DRAFT |
| src/commands/definitions.ts:164 | `/officer requests`: Every open craft request in this server, with Cancel | DRAFT |
| src/commands/definitions.ts:169 | `/guildcraft`: GuildCraft settings for this server (admins) | DRAFT |
| src/commands/definitions.ts:177 | `/guildcraft setup`: Set the roles, roster board, and review, vault and request channels (leave all out to see them) (same words as order 16) | DRAFT |
| src/commands/definitions.ts:179-184 | `/guildcraft setup` options `member_role`, `officer_role`, `board`, `review`, `vault`, `requests` (same words as approved and order 16) | DRAFT |
| src/commands/definitions.ts:187 | `/guildcraft status`: Data version, last data update, the roster board and departures (same words as approved) | DRAFT |
| src/commands/definitions.ts:188 | `/guildcraft rebuild-board`: Recreate the roster board posts in A→Z order (posts with replies are kept) (same words as approved) | DRAFT |
| src/commands/help.ts:92 | Help title: GuildCraft help · \<page> (\<n> of 6) | DRAFT |
| src/commands/help.ts:82 | Each command line on a page: `` `<cmd>` `` \<its description above> | DRAFT |
| src/commands/help.ts:90 | Page buttons: Getting started · Finding things · Your profile · Requests · Officers · Admins (the open page's button is highlighted and disabled) | DRAFT |
| src/commands/help.ts:38 | Page label: Getting started (lists `/help`) | DRAFT |
| src/commands/help.ts:40 | **1.** `/me`: press **Add character** to register your character. Your first one becomes your main. | DRAFT |
| src/commands/help.ts:41 | **2.** `/skills`: press Enter, pick up to 5 tradeskills, then type their levels. (`/skills skill: level:` sets one.) | DRAFT |
| src/commands/help.ts:42 | **3.** `/item`: any item: its stats, where it comes from, its recipe and who in the guild can make it. | DRAFT |
| src/commands/help.ts:43 | Replies are private to you unless you press **Post to channel**. | DRAFT |
| src/commands/help.ts:45 | (after the commands) the contact line, src/commands/help.ts:10 | DRAFT (approved words, new place) |
| src/commands/help.ts:49 | Page label: Finding things (lists `/item`, `/gear`, `/roster skill`, `/roster member`, `/roster top`, `/roster recipes`, `/zone`) | DRAFT |
| src/commands/help.ts:51 | On an `/item` card: **I know this recipe**, **Report a problem**, **Request a craft**, **Stat image**. Attach `screenshot:` to send an item window for the officers to approve. | DRAFT |
| src/commands/help.ts:55 | Page label: Your profile (lists `/me`, `/skills`) | DRAFT |
| src/commands/help.ts:57 | `/me` has buttons to add, edit or remove a character, update skills, turn on request notices, forget a recipe and cancel a request. | DRAFT |
| src/commands/help.ts:61 | Page label: Requests (lists `/request`) | DRAFT |
| src/commands/help.ts:64 | Crafters who turned on **Notices** in `/me` for the tradeskill are added to a private thread and pinged there. Press **Request a craft** on an `/item` card to start one too. | DRAFT |
| src/commands/help.ts:65 | Your open requests are in `/me`, with **Cancel a request**. | DRAFT |
| src/commands/help.ts:70 | Page label: Officers (lists the five `/officer` subcommands and the coming-soon line) | DRAFT |
| src/commands/help.ts:32, 8 | (Officers page) `/recipe add` record a recipe the data is missing (officer-approved) *(coming soon)* | DRAFT (approved words, new page) |
| src/commands/help.ts:72 | Server admins grant `/officer` to the officer role once: Server Settings → Integrations → the app → `/officer`. | DRAFT |
| src/commands/help.ts:74 | Page label: Admins (lists the three `/guildcraft` subcommands) | DRAFT |
| src/commands/help.ts:7 | Footer of every page: Item data: Monsters and Memories Wiki (CC BY-SA 4.0) | DRAFT (approved words, now the embed footer) |
| src/commands/welcome.ts:10 | **1.** `/me`: press **Add character** to register your character. Your first one becomes your main. | DRAFT |
| src/commands/welcome.ts:11 | **2.** `/skills`: press Enter, pick up to 5 tradeskills, then type their levels. (`/skills skill: level:` sets one.) | DRAFT |
| src/commands/welcome.ts:12 | Or press **Update skills** on your `/me`. | DRAFT |
| src/commands/welcome.ts:13 | **3.** `/item`: look up any item, and who in the guild can make it. | DRAFT |
| src/commands/welcome.ts:15 | *You see this message once. `/help` shows every command.* | DRAFT |
| src/board/render.ts:50 | No one in the guild has recorded \<tradeskill> yet. Use `/skills` to get listed. | DRAFT |
| src/board/render.ts:98 | 1. `/me`, then **Add character**. | DRAFT |
| src/board/render.ts:99 | 2. `/skills` a tradeskill level, or `/skills` alone for several at once. | DRAFT |
| src/board/render.ts:103 | `/item` any item: its stats, sources, recipe and who can make it · `/roster recipes` who knows the hard-to-get ones | DRAFT |
| src/board/render.ts:104 | `/gear` gear for your class, by slot, stats and source · `/zone` a zone's levels, creatures, wiki and map links | DRAFT |
| src/board/render.ts:105 | `/request` ask the crafters who can make an item · **Notices** on `/me` add you to requests you can craft | DRAFT |
| src/board/render.ts:106 | `/help` every command | DRAFT |
| src/commands/autocomplete.ts:56 | `/item name:` pick list: \<item> (craftable) ("(craftable)" only on an item with a recipe) | DRAFT |
| src/commands/item.ts:28 | No item called **\<typed text>**. Pick one from the list as you type. If it's a craftable item the data is missing, report it below. (\<typed text> is "(nothing)" when blank, line 137) | DRAFT |
| src/commands/item.ts:29 | Button: Report a missing recipe | DRAFT |
| src/commands/item.ts:30 | Card title: Used in \<n> recipe(s) | DRAFT |
| src/commands/item.ts:62 | Used in line: **\<item>** · \<tradeskill> · trivial \<number> (or: trivial unknown); then +\<n> more | DRAFT |
| src/commands/item.ts:31 | Showing \<n> of \<n> recipes. (same words as approved) | DRAFT |
| src/commands/item.ts:32 | That item is no longer in the data. Run `/item` again. | DRAFT |
| src/commands/item.ts:33 | Button: I know this recipe (same words as approved) | DRAFT |
| src/commands/item.ts:34 | Button (an item with no recipe): Report a problem (same words as approved) | DRAFT |
| src/commands/item.ts:35 | Button (a craftable item): Report a recipe problem | DRAFT |
| src/commands/item.ts:36 | Button (a craftable item): Report item data | DRAFT |
| src/commands/item.ts:37 | Button: Request a craft (same words as order 16) | DRAFT |
| src/commands/item.ts:38 | Button: Stat image (same words as approved) | DRAFT |
| src/commands/reports.ts:159 | Form title: Report a missing recipe | DRAFT |
| src/commands/reports.ts:163 | Form field: Item name (filled in with the name typed) | DRAFT |
| src/commands/reports.ts:168 | Form field: Details (optional) | DRAFT |
| src/commands/reports.ts:169 | Form field note: Its tradeskill, ingredients or trivial, if you know them. Up to 190 characters. | DRAFT |
| src/commands/reports.ts:181 | Give the item name. Nothing was saved. | DRAFT |
| src/commands/reports.ts:184 | (the report's details, for a name the data lacks) Item: \<name>, then the member's words | DRAFT |
| src/commands/reports.ts:44 | Review card title: Report: \<item> (or the name from "Item: \<name>" in the details, or: Report: unknown item); Item report: … for item reports | DRAFT |
| src/commands/reports.ts:49 | Review card footer: Report #\<number> · fix the data with /officer recipe-fix or /officer recipe-source, then mark it fixed | DRAFT |
| src/commands/me.ts:53 | You have no characters yet. Press **Add character** to register your first one: it becomes your main. (with the welcome embed) | DRAFT |
| src/commands/me.ts:54 | @\<member> has no characters yet. They add them with `/me`. | DRAFT |
| src/commands/me.ts:55 | **Acting for @\<member> (\<saved name>).** Changes you make here are recorded as yours. | DRAFT |
| src/commands/me.ts:56 | Showing \<n> of \<n> characters. | DRAFT (changes approved copy: was "Showing 10 of") |
| src/commands/me.ts:57 | -# *stale* = not updated in \<number> days. (same words as approved) | DRAFT |
| src/commands/me.ts:58 | **Your open craft requests:** (same words as order 16) | DRAFT |
| src/commands/me.ts:59 | **Their open craft requests:** | DRAFT |
| src/commands/me.ts:60 | **Open craft requests:** none (`/request` starts one) | DRAFT |
| src/commands/me.ts:61 | Button: Add character | DRAFT |
| src/commands/me.ts:62 | Button: Edit character | DRAFT |
| src/commands/me.ts:63 | Button: Remove character | DRAFT |
| src/commands/me.ts:64 | Button: Update skills (same words as approved) | DRAFT |
| src/commands/me.ts:65 | Button: Notices | DRAFT |
| src/commands/me.ts:66 | Button: Forget a recipe | DRAFT |
| src/commands/me.ts:67 | Button: Cancel a request | DRAFT |
| src/commands/me.ts:68 | Only the member can do that, from their own `/me`. | DRAFT |
| src/commands/me.ts:69 | That character is no longer available. Run `/me` again. | DRAFT |
| src/commands/me.ts:70 | Which character do you want to edit? | DRAFT |
| src/commands/me.ts:71 | Which character do you want to remove? Its skills are kept, and adding it again restores it. | DRAFT |
| src/commands/me.ts:72 | Which character are you updating? | DRAFT |
| src/commands/me.ts:73 | Menu placeholder: Pick a character | DRAFT |
| src/commands/me.ts:74, 123 | Menu option: \<character> (removed) (an officer's Edit character only) — or: \<character> (main) | DRAFT |
| src/commands/me.ts:75 | Nothing changed. | DRAFT |
| src/commands/me.ts:76 | Form title: Add a character | DRAFT |
| src/commands/me.ts:77 | Form title: Edit \<character> | DRAFT |
| src/commands/me.ts:78 | Form field: Name | DRAFT |
| src/commands/me.ts:79 | Form field: Class | DRAFT |
| src/commands/me.ts:80 | Form field note: Optional. A class code from the game (e.g. CLR), or type your own | DRAFT |
| src/commands/me.ts:81 | Form field: Level | DRAFT |
| src/commands/me.ts:82 | Form field note (Add): Optional: 1 to 100 | DRAFT |
| src/commands/me.ts:83 | Form field note (Edit): 1 to 100. Blank keeps the current level | DRAFT |
| src/commands/me.ts:84 | Form field note (Edit): To change your main, pick Yes on the character that should be it | DRAFT |
| src/commands/me.ts:85 | Form field: Make this your main? | DRAFT |
| src/commands/me.ts:86 | Choice: Yes, my main character | DRAFT |
| src/commands/me.ts:87 | Choice: No | DRAFT |
| src/commands/me.ts:88 | Pick the tradeskills you want craft request notices for. Unpick one to stop its notices. (then the notices line, src/commands/requests.ts:49-50) | DRAFT |
| src/commands/me.ts:89 | Menu placeholder: \<Tradeskills / Tradeskills A–M / Tradeskills N–Z>: request notices | DRAFT |
| src/commands/me.ts:90 | No recipes are marked known yet. Press **I know this recipe** on an `/item` card to mark one. | DRAFT |
| src/commands/me.ts:91 | Pick a recipe to unmark (\<from>–\<to> of \<total> marked known): | DRAFT |
| src/commands/me.ts:92 | Menu placeholder: A recipe marked known | DRAFT |
| src/commands/me.ts:450 | Menu option: \<item> · \<tradeskill>, note: \<character> | DRAFT |
| src/commands/me.ts:454-455 | Buttons: ◀ Previous · Next ▶ (same words as approved) | DRAFT |
| src/commands/me.ts:93 | No open craft requests. | DRAFT |
| src/commands/me.ts:94 | Pick a request to cancel. Everyone in its thread is told. | DRAFT |
| src/commands/me.ts:195 | (/officer edit-member) Pick the member. | DRAFT |
| src/commands/me.ts:386, 489 | (Notices, Cancel a request, no request channel) An admin needs to run `/guildcraft setup requests:` first. (same words as order 16) | DRAFT |
| src/commands/me.ts:388 | (Notices) The tradeskill list hasn't loaded yet. Try again later. (same words as approved) | DRAFT |
| src/commands/me.ts:395 | That list has changed. Press **Notices** on `/me` again. | DRAFT |
| src/commands/skills.ts:136 | Give the `skill` that level is for, or leave both out to update up to 5 skills at once. | DRAFT |
| src/commands/skills.ts:137 | Give a `level` for **\<skill>**, or leave both out to update up to 5 skills at once. | DRAFT |
| src/commands/skills.ts:28 | (after a stale menu or form) \<what is stale> Run `/skills` again. | DRAFT |
| src/commands/skills.ts:174 | That character is no longer available. Run `/skills` again. | DRAFT |
| src/commands/skills.ts:189 | Those tradeskills are no longer in the list. Run `/skills` again. | DRAFT |
| src/commands/skills.ts:235 | That form is out of date. Run `/skills` again. | DRAFT |
| src/commands/skills.ts:240 | Nothing was saved. **\<tradeskill>**: "\<typed>" is not a whole number from 0 to \<skill cap>.<br>Run `/skills` again to retry. | DRAFT |
| src/commands/skills.ts:288 | No skills yet: `/skills` or **Update skills**. | DRAFT |
| src/commands/requests.ts:49 | **Craft request notices:** \<tradeskills> (**Notices** on `/me` changes them) | DRAFT |
| src/commands/requests.ts:50 | **Craft request notices:** off (**Notices** on `/me` turns them on for a tradeskill) | DRAFT |
| src/commands/requests.ts:71 | That request was already sent or discarded. Run `/request` to start another. | DRAFT |
| src/commands/requests.ts:72 | You already have 5 open requests. Mark one done or cancel one (**Cancel a request** on `/me`) before asking for more. | DRAFT |
| src/commands/requests.ts:124 | No opted-in crafter can make it yet, and no one else in the guild can either (by `/item`'s Reliable list). | DRAFT |
| src/commands/requests.ts:142 | -# **Send request** opens a private thread in #\<channel> with you and the crafters, who are pinged there. Up to 5 items: **Add item**, or run `/request` again. | DRAFT |
| src/commands/requests.ts:176 | Form field note: The exact item name. Or run /request again: it picks from a list and adds to this request. | DRAFT |
| src/commands/requests.ts:198 | No recipe found for **\<typed>**. Pick an item from the list as you type. In the form the name must match exactly; `/request item:` picks from the list and adds to this request. | DRAFT |
| src/commands/requests.ts:360 | Only the requester can cancel an item. Officers can cancel a whole request with `/officer requests`. | DRAFT |
| src/commands/requests.ts:435 | No open craft requests in this server. (same words as order 16) | DRAFT |
| src/commands/requests.ts:436 | **Open craft requests** \<from>–\<to> of \<total>, oldest first: | DRAFT |
| src/commands/requests.ts:452-453 | Buttons: ◀ Previous · Next ▶ (/officer requests, 10 a page) | DRAFT |
| src/commands/requests.ts:421 | Menu placeholder: Cancel a request (same words as order 16) | DRAFT |
| src/commands/find.ts:282 | That item no longer has a recipe. Run `/item` again. (also src/commands/recipes.ts:91, src/commands/requests.ts:161) | DRAFT |
| src/commands/recipes.ts:47 | Marked **\<recipe>** as known for **\<character>**: `/item` shows the 📜 marker. **Forget a recipe** on `/me` undoes it. | DRAFT |
| src/commands/recipes.ts:96 | Which character knows which recipe? (showing the first 25 of \<n>) | DRAFT |
| src/commands/recipes.ts:122 | That character is no longer available. Run `/item` again. | DRAFT |
| src/commands/recipes.ts:124 | That recipe is no longer in the data. Run `/item` again. | DRAFT |
| src/commands/recipes.ts:183 | `/item` groups crafters by skill as usual (Reliable, Still learning) and says it may need buying first. | DRAFT |
| src/commands/recipes.ts:184 | `/item` groups crafters by skill as usual (Reliable, Still learning), with a note to check the crafter has the recipe. | DRAFT |
| src/commands/recipes.ts:232 | Nothing was changed. No item is named exactly: **\<name>**, **\<name>**. Check the spelling against `/item`. | DRAFT |
| src/commands/recipes.ts:250 | Saved for this server: **\<recipe>** now shows trivial **\<number>** and ingredients \<quantity> × \<ingredient>, …, marked guild-corrected on `/item`. `reset:True` removes the correction.<br>-# Only this server sees this, and the nightly data update won't overwrite it. | DRAFT |
| src/commands/recipes.ts:286 | No one has marked a reputation or discovery recipe as known yet. Officers set how a recipe is obtained with `/officer recipe-source`; members then mark the ones they know with the **I know this recipe** button on `/item`. | DRAFT |
| src/commands/character.ts:45 | You have no characters yet. Add one with **Add character** on `/me`. | DRAFT |
| src/commands/character.ts:50 | (added for officers) It belongs to @\<member>: `/officer edit-member` on them, then **Edit character** on the removed one, with a new name. | DRAFT |
| src/commands/character.ts:213 | Nothing changed. | DRAFT |
| src/commands/character.ts:225 | There is a removed character of yours named **\<name>**. **Add character** on `/me` with that name restores it; or pick another name. | DRAFT |
| src/commands/character.ts:285 | Removed **\<character>**. Its skills are kept: **Add character** on `/me` with the name **\<character>** restores it. | DRAFT |
| src/commands/members.ts:32 | **\<member name>** is then marked as having left: hidden from `/item`, `/roster` and the roster board until they use GuildCraft again. | DRAFT |
| src/commands/members.ts:33 | Their skills are kept, and **Add character** on `/me` with the same name restores a character. Nothing is deleted. | DRAFT |
| src/commands/members.ts:41 | (after Done: / @\<officer> removed …) Their skills are kept: **Add character** on `/me` with the same name restores a character. | DRAFT |
| src/departures.ts:165 | While they are away their characters are hidden from `/item`, `/roster` and the roster board. If they come back and use GuildCraft, they show again. | DRAFT |
| src/departures.ts:166 | **Remove characters** removes the characters (their skills are kept; **Add character** on `/me` with the same name restores one). **Keep** leaves them as they are. Officers only. | DRAFT |
| src/commands/images.ts:90 | Attach the screenshot in the `screenshot:` box. Nothing was saved. | DRAFT |
| src/commands/images.ts:147 | Thanks: your screenshot of **\<item>** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on `/item`. | DRAFT |
| src/commands/images.ts:201 | No screenshot of **\<item>** yet. Have one? Send it with `/item` and `screenshot:`: an officer approves it, then it shows here. | DRAFT |
| src/commands/setup.ts:262 | Craft requests will open private threads in #\<channel>: one per request, holding the requester and the crafters who turned on **Notices** in `/me` and can make the item. Members need to see the channel to see their thread. | DRAFT |
| src/commands/setup.ts:267 | Screenshots sent with `/item screenshot:` will wait in #\<channel> for an officer's **Approve** or **Reject**. Screenshots already in an earlier vault stay where they are. | DRAFT |
| src/commands/zone.ts:41 | No classes are loaded yet. Try `/gear` once the nightly import has run. | DRAFT |
| src/commands/gear.ts:55 | That item is no longer in the data. Run `/gear` again. | DRAFT |
| src/interactions.ts:35 | Sorry, that command isn't available. Type `/help` to see every command. | DRAFT |
| docs/LAUNCH-GUIDE.md:30-32 | "The commands (order 18)": Members: `/me` (your characters, skills, notices and requests, with buttons to change them), `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`. Officers: `/officer` (recipe-source, recipe-fix, remove-member, edit-member, requests). Admins: `/guildcraft` (setup, status, rebuild-board). `/help` shows them all, in pages. | DRAFT |
| docs/LAUNCH-GUIDE.md:45-60 | "Grant `/officer` to your officer role once (order 18)": why it is needed, the four steps (Server Settings → Integrations → Manage → `/officer` → add the officer role), the source, the re-check on every call and press, and "Keep the grant" (replaces "Letting officers use `/guildcraft remove-member`" and "Letting officers use `/recipe source` and `/recipe override`") | DRAFT |
| docs/LAUNCH-GUIDE.md:36, 64, 71 | `/craft request` → `/request`; `/item image` → `/item screenshot:`; `/gear find` → `/gear` (in "Servers that added GuildCraft before craft requests", the vault section and "Zones") | DRAFT |

## Work order 19: zone map, channel setup, planner link (DRAFT)

The zone map's title, "Map: MnM Atlas (mnmatlas.com) and its original map authors" (src/zone/card.ts:33), is unchanged; only its place moved (first).

| Where | Text | Status |
|---|---|---|
| src/commands/setup.ts:219 | (button) Create GuildCraft channels | DRAFT |
| src/commands/channels.ts:23, 36-39 | (names) GuildCraft (category) · GC-Crafting Roster · GC-Officer Review · GC-Item Vault · GC-Craft Requests | DRAFT |
| src/commands/channels.ts:93 | GuildCraft is already creating channels for this server. Wait a minute, then press the button again. | DRAFT |
| src/commands/channels.ts:94 | Sorry, GuildCraft can't reach Discord right now. Nothing was changed; please try again. | DRAFT |
| src/commands/channels.ts:95 | Sorry, I couldn't read this server's channels and roles from Discord. Nothing was changed; please try again. | DRAFT |
| src/commands/channels.ts:96-97 | Nothing was created. GuildCraft is missing **\<permissions>** in this server.<br>Grant them to GuildCraft's role (Server Settings → Roles), or re-invite GuildCraft with the current install link (ask Joegandomi): servers that added GuildCraft before this button did not grant **Manage Channels** or **Manage Permissions**. Picking your own channels with `/guildcraft setup`'s options still works. | DRAFT |
| src/commands/channels.ts:98 | Created #\<channel> (forum / private text channel / text channel). | DRAFT |
| src/commands/channels.ts:99 | Kept #\<channel> (…): it already exists. | DRAFT |
| src/commands/channels.ts:100 | Could not create **\<name>** (Discord answered \<status>). Press the button again to retry; nothing is duplicated. | DRAFT |
| src/commands/channels.ts:101-102 | **GC-Crafting Roster** (the roster board) was not created: forum channels need **Community**. Turn it on (Server Settings → Enable Community), then press the button again. | DRAFT |
| src/commands/channels.ts:103 | No officer role is set, so the new review and vault channels are visible only to members with Administrator (and GuildCraft). Run `/guildcraft setup officer_role:`, then press **Create GuildCraft channels** on its reply to add the role to them. | DRAFT |
| src/commands/channels.ts:104 | Added the officer role to #\<channel>. | DRAFT |
| src/commands/channels.ts:105 | Could not add the officer role to #\<channel>: add it in the channel's settings (Permissions). | DRAFT |
| src/commands/channels.ts:106 | Set #\<channel>'s default sort order to Creation Time, so the board reads A→Z. | DRAFT |
| src/commands/channels.ts:107 | Every GuildCraft channel already exists and is saved. Nothing was changed. | DRAFT |
| src/commands/channels.ts:108 | Could not create the **GuildCraft** category (Discord answered \<status>). Nothing else was created; press the button again to retry. | DRAFT |
| src/commands/gear.ts:69 | (link button) Character planner (Stories of MnM) | DRAFT |
| docs/LAUNCH-GUIDE.md:10, 25-26, 32, 34-36 | The install link (permissions=361045806096), the Manage Channels and Manage Permissions rows, "Or let GuildCraft create its channels", "Servers that added GuildCraft before Create GuildCraft channels" | DRAFT |
| docs/SELF-HOSTING.md:111, 114, 126-127 | The install link and number (361045806096), the Manage Channels and Manage Permissions rows | DRAFT |

## Work order 23: zone buttons (DRAFT)

No new sentence: each button's label is a zone's name from the data. What the member sees is new, so it is listed for approval.

| Where | Text | Status |
|---|---|---|
| src/zone/buttons.ts:65 | (buttons under `/gear` results, the `/item` card, `/gear`'s item card and their posted copies) \<zone name>, one per zone the text shows, cut to 80 characters; a press opens that zone's card privately, as `/zone` shows it | DRAFT |
| src/commands/zone.ts:37 | (a zone button for a zone no longer in the data) That zone is no longer in the data. Run `/zone` again. (order 17's line, now also reached from a zone button) | DRAFT |

## Work order 24, PR A: the factions board (DRAFT)

"Reputation Gained" and "Reputation Lost" are the wiki infobox's own labels, kept as they are. Creature, zone, level and location text is the wiki's.

| Where | Text | Status |
|---|---|---|
| src/board/factions.ts:48 | (a faction post's preview line) \<Faction> · \<N> creatures: reputation gained from \<g>, lost from \<l> | DRAFT |
| src/board/factions.ts:23-24, 37 | (a faction post) **Reputation Gained** · \<n> creatures, then each zone underlined and its creatures as "• \<creature> (level \<level>, \<location>)", leaving out whichever is unknown; then **Reputation Lost** the same way | DRAFT |
| src/board/factions.ts:25 | (a section with no creature) No creature's wiki page lists it here. | DRAFT |
| src/board/factions.ts:26 | (every faction post's footer) As listed on each creature's wiki page (Monsters and Memories Wiki, CC BY-SA 4.0). Amounts aren't recorded. | DRAFT |
| src/board/kinds.ts:60 | (the index post's title) Index: how to read this board | DRAFT |
| src/board/factions.ts:116 | (the index's preview line) Factions · \<N> posts, A→Z · from each creature's wiki page | DRAFT |
| src/board/factions.ts:27-31 | (the index) **Factions: index** · One post per faction, A→Z below. Each lists the creatures whose wiki page names the faction under **Reputation Gained** or **Reputation Lost**, by zone. · the footer line above · then "#\<post> · \<n> creatures" per faction | DRAFT |
| src/board/factions.ts:32 | (index, while the board fills) \<n> more posts coming: the board fills in over the next few hours. | DRAFT |
| src/commands/definitions.ts:187 | (`/guildcraft setup` option) factions: A forum channel for the factions board: one post per faction | DRAFT |
| src/commands/definitions.ts:196 | (`/guildcraft rebuild-board` option) which: The board to rebuild (default: tradeskills) · Tradeskills · Factions | DRAFT |
| src/commands/setup.ts:29-30 | Factions board: #\<channel> / not set (`factions:` picks a forum channel) | DRAFT |
| src/commands/setup.ts:145 | #\<channel> is not a forum channel. The factions board needs a forum channel: create one (Create Channel → Forum), then pick it here. | DRAFT |
| src/commands/setup.ts:305-306 | Building the factions board now: \<n> faction posts plus a pinned index post. The factions board fills in over the next few hours. If nothing shows, reload Discord. / The factions board already has every faction post; refreshing it now. | DRAFT |
| src/commands/setup.ts:287 | The old factions board's posts in #\<channel> are left as they are. | DRAFT |
| src/commands/setup.ts:479-480 | (status) **Factions board:** #\<channel> · \<x> of \<y> posts · last refresh \<time> · \<n> waiting to refresh · A→Z / out of order — run `/guildcraft rebuild-board which:Factions` · or: not set up (`/guildcraft setup factions:`) | DRAFT |
| src/commands/setup.ts:499 | There is no factions board yet. Set one up first with `/guildcraft setup factions:`. | DRAFT |
| src/commands/setup.ts:505-507 | Rebuilding the factions board in #\<channel> in A→Z order: each faction post is created again, then the old one is deleted. Posts with member replies are kept as they are. · About 25 posts are created every 15 minutes, so a full rebuild takes a few hours. `/guildcraft status` shows the board order. · For A→Z to show at the top, the forum's Default Sort Order must be Creation Time (Edit Channel). | DRAFT |

## Work order 24, PR B: emoji, channel layout, "tradeskills board" (DRAFT)

| Where | Text | Status |
|---|---|---|
| src/commands/channels.ts:45-48 | (names) GC-Tradeskills · GC-Factions · GC-Craft Requests · GC-Officer Review (category: GuildCraft) | DRAFT |
| src/commands/channels.ts:45-48, 111-112 | Created / Kept #\<channel>: the tradeskills board: one post per tradeskill, listing who can craft it. · …: the factions board: one post per faction, listing the creatures whose wiki page names it. · …: craft requests: one private thread per request. · …: officers only: member reports, departures, and screenshots to approve. | DRAFT |
| src/commands/channels.ts:114 | **\<name>** was not created: forum channels need **Community**. Turn it on (Server Settings → Enable Community), then press the button again. | DRAFT |
| src/commands/channels.ts:115 | No officer role is set, so the new officer review channel is visible only to members with Administrator (and GuildCraft). Run `/guildcraft setup officer_role:`, then press **Create GuildCraft channels** on its reply to add the role to it. | DRAFT |
| src/emoji.ts:21 | Set #\<channel>'s default reaction to the GuildCraft emoji. | DRAFT |
| src/emoji.ts:22 | Added the **guildcraft** emoji to this server: it is the default reaction on GuildCraft's forums. | DRAFT |
| src/emoji.ts:26 | The forums keep their default reaction: GuildCraft can't add its emoji here without **Create Expressions**. Grant it to GuildCraft's role (Server Settings → Roles), or re-invite GuildCraft with the current install link (ask Joegandomi), then press the button again. | DRAFT |
| src/emoji.ts:28 | The forums keep their default reaction: this server has no free emoji slot for the GuildCraft emoji. Free one (Server Settings → Emoji), then press the button again. | DRAFT |
| src/emoji.ts:29 | The forums keep their default reaction: Discord refused the GuildCraft emoji (\<status>). Press the button again to retry. | DRAFT |
| assets/emoji/guildcraft.png | (the server emoji **guildcraft**) the owner's bot icon, 128x128 | DRAFT |
| src/commands/definitions.ts:178, 183, 191, 195 | (setup) Set the roles, the tradeskills and factions forums, and review, vault and request channels · (board:) The tradeskills forum: one post per tradeskill, listing who can craft it · (status) Data version, last data update, the tradeskills and factions boards, and departures · (rebuild-board) Recreate a board's posts in A→Z order (posts with replies are kept) | DRAFT |
| src/commands/setup.ts:21, 139, 477-478, 514, 520; src/commands/members.ts:32; src/departures.ts:165 | "roster board" → "tradeskills board" (Tradeskills board: …; The tradeskills board needs a forum channel…; **Tradeskills board:** …; There is no tradeskills board yet…; Rebuilding the tradeskills board in…; hidden from `/item`, `/roster` and the tradeskills board) | DRAFT |
| src/board/render.ts:156 | (the tradeskills index embed title) Tradeskills: index (was "Crafting roster: index") | DRAFT |
| docs/LAUNCH-GUIDE.md:10, 25-27, 33-37 | The install link (permissions=9157138828304), the Create Expressions row, the new layout, "Servers that added GuildCraft before the factions board" | DRAFT |
| docs/SELF-HOSTING.md:111, 114, 126-128 | The install link and number (9157138828304), the Create Expressions row | DRAFT |
