# GuildCraft copy list

This is every piece of text GuildCraft shows to members, officers and admins in Discord. Every line is approved for launch (the owner, by exception, 2026-10-20: work order 11). New text added later is listed here as DRAFT until it is approved.
Parts in angle brackets, such as \<item name> or \<character>, are filled in by the bot each time. @\<member> is a mention of a member, #\<channel> a link to a channel, @\<role> a role, \<date and time> a Discord timestamp shown in the reader's own time zone.
A count written "character(s)" shows as "1 character" or "3 characters".
"(dev only)" marks a line only the operator's dev copy shows (the test server); production, and so every guild, never shows it.

Where: the file and line the text started on in `src/` when the list was drawn up (order 10); later lines may have moved, so find a string by its text. "-#" at the start of a line is Discord's small grey text.

## Commands

### Options several commands share

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:27 | `member` option: Officers only: act on another member's character | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:29 | `class` option: Class: pick from the list, or type your own | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:30 | `level` option (characters): Character level | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:31 | `main` option: Make this your main character | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:32 | `character` option: Optional; defaults to your main | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:33 | `skill` option: Tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:35 | `recipe` option: A recipe: pick from the list (each shows its tradeskill and trivial) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:36 | `item` option (/craft report, /item image): An item: pick from the list | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:38 | `item` option (/recipe source, /recipe override): The item: pick its recipe from the list (each shows its tradeskill and trivial) | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:74 | A recipe in pick lists and replies: \<item> · \<tradeskill> · trivial \<number> (or: \<item> · \<tradeskill> · trivial unknown) | APPROVED (owner, by exception, 2026-10-20) |

### /character

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:44 | `/character`: Register and manage your characters | APPROVED (owner, by exception, 2026-10-20) |

#### /character add

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:51 | Register a character | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:52 | `name` option: Character name | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:188 | Added **\<character>** (\<class>, level \<level>). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:150 | (added after "Added …", first character) It is your main (your first character). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:150 | (added after "Added …", with `main:True`) It is now your main. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:166 | Restored **\<character>** (\<class>, level \<level>), which you removed earlier, with its \<number> saved skill(s). It is your main. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:92 | A character name can't be empty. (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:93 | A character name can be at most 32 characters. (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:94 | A character name can't contain line breaks or control characters. (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:109 | Level must be a whole number from 1 to 100. (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:104 | Class **\<class>** isn't in the class list taken from the wiki data, so it's saved as typed. (The game is in Early Access; the list may be incomplete.) (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:49 | **\<name>** belongs to a removed character, so it can't be reused yet. An officer can rename the removed character to free the name. (also /character edit) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:50 | (added for officers) It belongs to @\<member>: use `/character edit` with `member:` set to them and a `new_name`. | APPROVED (owner, by exception, 2026-10-20) |

#### /character edit

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:57 | Rename a character, or change its class, level or main flag | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:59 | `name` option: The character to change | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:60 | `new_name` option: A new name | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:207 | Nothing to change: give a `new_name`, `class`, `level` or `main`. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:219 | There is a removed character of yours named **\<name>**. `/character add name:<name>` restores it; or pick another name. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:236 | **\<character>** is removed; it can't be made a main until it is restored. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:237 | **\<character>** is your main. To change that, set `main` on another character. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:258 | Updated **\<character>** (\<class>, level \<level>) (was **\<old name>**). It is now your main. ("(was …)" only on a rename; "It is now your main." only when it became main) | APPROVED (owner, by exception, 2026-10-20) |

#### /character remove

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:70 | Remove a character and hide its skills | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:72 | `name` option: The character to remove | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:279 | Removed **\<character>**. Its skills are kept: `/character add name:<character>` restores it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:280 | **\<character>** is now your main. | APPROVED (owner, by exception, 2026-10-20) |

### /craft

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:80 | `/craft`: Guild crafting: find crafters and track tradeskills | APPROVED (owner, by exception, 2026-10-20) |

#### /craft set

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:87 | Set one tradeskill level | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:88 | `level` option: Skill level | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:53 | **\<character>**: \<tradeskill> set to **\<level>** (was \<old level>). ("(was …)" only when it had a level) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:27 | Level must be a whole number from 0 to \<skill cap>. | APPROVED (owner, by exception, 2026-10-20) |

#### /craft update

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:90 | Update up to 5 skills: press Enter, pick skills, then type levels | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:120 | Pick up to 5 tradeskills for **\<character>**. A form then opens with a level box for each. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:119 | The tradeskill list hasn't loaded yet. Try again later. | APPROVED (owner, by exception, 2026-10-20) |

(The skill menu and the levels form are under Buttons and menus.)

#### /craft me

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:91 | Your characters, skills and last updates (private) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:278 | Card title: \<character> (main) ("(main)" only on the main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:268 | Card first line: \<class> · level \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:275 | **\<tradeskill>** \<level> · \<date> · *stale* ("*stale*" only when old) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:279 | No skills yet: `/craft set` or `/craft update`. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:154 | Known recipes: \<item> (\<tradeskill>), \<item> (\<tradeskill>) +\<number> more | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:283 | Showing 10 of \<number> characters. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:284 | -# *stale* = not updated in \<number> days. | APPROVED (owner, by exception, 2026-10-20) |

#### /craft find

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:95 | Who in the guild can make an item: recipe, stats and crafters | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:96 | `item` option: An item that has a recipe: pick from the list | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:275 | No recipe found for **\<typed text>**. Pick an item from the list as you type. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:272 | Showing \<number> of \<number> recipes. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:94 | Item card footer: Item data: Monsters and Memories Wiki, CC BY-SA 4.0 · data \<data version> | APPROVED (owner, by exception, 2026-10-20) |
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

(The buttons under the reply are under Buttons and menus.)

#### /craft know

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:98 | Mark a recipe as known by your character | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:47 | Marked **\<recipe>** as known for **\<character>**: `/craft find` shows the 📜 marker. `/craft forget` undoes it. (also the I know this recipe button) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:46 | **\<character>** already has **\<recipe>** marked known. (also the I know this recipe button) | APPROVED (owner, by exception, 2026-10-20) |

#### /craft forget

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:99 | Unmark a recipe your character marked known | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:76 | **\<character>** no longer has **\<recipe>** marked known. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:75 | **\<character>** didn't have **\<recipe>** marked known, so nothing changed. | APPROVED (owner, by exception, 2026-10-20) |

#### /craft report

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:103 | Report a wrong trivial, ingredient or source, or a missing recipe, to the officers | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:106 | `issue` option: What is wrong | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:19 | Issue choice: Wrong trivial | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:20 | Issue choice: Wrong ingredients | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:21 | Issue choice: Wrong source (how it is obtained) | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:22 | Issue choice: Missing recipe | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:23 | Issue choice: Other | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:107 | `details` option: Optional: what it should be (up to 300 characters) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:63 | Thanks: your report on **\<item>** (\<issue>) is saved. Your officers have it to review. (also the Report a problem form) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:64 | Thanks: your report on **\<item>** (\<issue>) is saved for your officers. (no review channel, or the post failed) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:49 | Pick an issue from the list: Wrong trivial, Wrong ingredients, Wrong source (how it is obtained), Missing recipe, Other. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:51 | Details can be at most 300 characters. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:54 | You already have 5 reports waiting for an officer. Once one is marked fixed or dismissed you can file another. | APPROVED (owner, by exception, 2026-10-20) |

#### /craft help

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:110 | A one-screen guide to every command | APPROVED (owner, by exception, 2026-10-20) |

(The reply is under Help and welcome.)

### /item image

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:115 | `/item`: Item screenshots | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:122 | Send a screenshot of an item window; an officer approves it before it shows | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:123 | `image` option: PNG, JPEG or WebP, up to 8 MB | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:147 | Thanks: your screenshot of **\<item>** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on `/craft find`. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:59 | Screenshots need a vault channel first: a server admin runs `/guildcraft setup vault:` with a private channel for officers. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:90 | Attach the screenshot in the `image:` box. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:91 | That file is \<size> MB; the limit is 8 MB. A cropped screenshot of the item window is plenty. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:109 | Your screenshot of **\<item>** is still waiting for an officer. You can send another once it is approved or rejected. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:110 | You have 5 screenshots waiting for an officer. You can send more once some are reviewed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:113 | Sorry, I couldn't read that attachment from Discord. Please try again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:115 | That file is over the 8 MB limit. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:117 | That file is not a PNG, JPEG or WebP image. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:139 | Sorry, I couldn't post that screenshot to the vault. Nothing is waiting for review. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:138 | (added in the middle of the line above when Discord refuses for permissions) I may have lost a permission in the vault channel: an admin can run `/guildcraft setup vault:` again to check. | APPROVED (owner, by exception, 2026-10-20) |

### /recipe (officers)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:129 | `/recipe`: Officers: correct recipes for this server | APPROVED (owner, by exception, 2026-10-20) |

#### /recipe source

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:140 | Set how a recipe is obtained (this server only) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:143 | `how` option: How it is obtained | APPROVED (owner, by exception, 2026-10-20) |
| src/recipes.ts:12 | `how` choices: Vendor · Reputation · Discovery · Unknown | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:145 | `faction` option: Reputation recipes: the faction that sells it (type any name) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:146 | `note` option: Optional: vendor, standing needed, or a hint | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:192 | Saved for this server: **\<recipe>** is now **\<Vendor / Reputation / Discovery / Unknown>** (\<faction>) · \<note>. \<what it changes, below><br>-# Only this server sees this, and the nightly data update won't overwrite it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:188 | (what it changes, reputation) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, needs reputation (\<faction>)". | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:188 | (what it changes, discovery) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, recipe not marked known". | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:190 | (what it changes, vendor) `/craft find` groups crafters by skill as usual (Reliable, Still learning) and says it may need buying first. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:191 | (what it changes, unknown) `/craft find` groups crafters by skill as usual (Reliable, Still learning), with a note to check the crafter has the recipe. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:174 | `how` must be one of: vendor, reputation, discovery, unknown. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:177 | A reputation recipe needs `faction:`, the faction that sells it, so members know what to work toward. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:178 | Keep `faction` to 80 and `note` to 200 characters. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |

#### /recipe override

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:152 | Correct a recipe's trivial or ingredients (this server only) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:155 | `trivial` option: The correct trivial | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:156 | `components` option: The full ingredient list, e.g. 2 Copper Bar, 1 Flux | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:157 | `reset` option: True: remove this server's correction | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:255 | Saved for this server: **\<recipe>** now shows trivial **\<number>** and ingredients \<quantity> × \<ingredient>, …, marked guild-corrected on `/craft find`. `reset:True` removes the correction.<br>-# Only this server sees this, and the nightly data update won't overwrite it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:220 | Reset **\<recipe>**: its trivial and ingredients come from the wiki data again (they already did). ("(they already did)" only when there was nothing to reset) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:224 | Give `trivial:`, `components:` or both, or `reset:True` to remove this server's correction. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:225 | `trivial` must be a whole number from 0 to \<skill cap>. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:229 | I couldn't read `components`. Write them like `2 Copper Bar, 1 Flux`. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:237 | Nothing was changed. No item is named exactly: **\<name>**, **\<name>**. Check the spelling against `/craft find`. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:239 | Nothing was changed: an item is listed twice. Give each item once, with its total quantity. | APPROVED (owner, by exception, 2026-10-20) |

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
| src/commands/recipes.ts:291 | No one has marked a reputation or discovery recipe as known yet. Officers set how a recipe is obtained with `/recipe source`; members then mark the ones they know with `/craft know` or the **I know this recipe** button on `/craft find`. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:301 | Footer: Page \<n> of \<pages> | APPROVED (owner, by exception, 2026-10-20) |

### /guildcraft (admins)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:191 | `/guildcraft`: GuildCraft settings for this server | APPROVED (owner, by exception, 2026-10-20) |

#### /guildcraft setup

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:202 | Set the roles, roster board, and review and vault channels (leave all out to see them) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:204 | `member_role` option: Members need this role to use GuildCraft (default: anyone) | APPROVED (owner, by exception, 2026-10-20) |
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
| src/commands/setup.ts:193 | Screenshots from `/item image` will wait in #\<channel> for an officer's **Approve** or **Reject**. Screenshots already in an earlier vault stay where they are. | APPROVED (owner, by exception, 2026-10-20) |
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

#### /guildcraft remove-member

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:216 | Officers: remove a member's characters and mark them as left (shows a preview first) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/definitions.ts:217 | `user` option: The member to remove | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:26 | This will remove \<n> character(s): **\<character>** (\<class>, level \<level>), … | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:27 | **\<member name>** has no characters registered. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:31 | **\<member name>** is then marked as having left: hidden from `/craft find`, `/roster` and the roster board until they use GuildCraft again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:32 | Their skills are kept, and `/character add` with the same name restores a character. Nothing is deleted. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:23 | @\<member> has never used GuildCraft in this server, so there is nothing to remove. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:21 | Pick the member to remove. | APPROVED (owner, by exception, 2026-10-20) |

(Confirm and Cancel are under Buttons and menus.)

## Buttons and menus

### Update skills (on /character add, /craft set, /craft me) and the /craft update menu

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:138 | Button: Update skills — or, with several characters: Update \<character> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:103 | Menu placeholder: Tradeskills: pick up to 5 (with many tradeskills: Tradeskills A–M: pick up to 5, Tradeskills N–Z: pick up to 5, and "(1/2)" when a half is split; labels at lines 78–87) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:109 | Menu option note: Now \<level> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:176 | Form title: Levels for \<character> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:180 | Form box (one per tradeskill, labelled with its name): 0 to \<skill cap> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:237 | Saved for **\<character>**: \<tradeskill> **\<level>** (was \<old level>), \<tradeskill> **\<level>**. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:221 | Nothing was saved. **\<tradeskill>**: "\<typed>" is not a whole number from 0 to \<skill cap>.<br>Run `/craft update` again to retry. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:155 | That character is no longer available. Run `/craft update` again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:170 | Those tradeskills are no longer in the list. Run `/craft update` again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:216 | That form is out of date. Run `/craft update` again. | APPROVED (owner, by exception, 2026-10-20) |

### Post to channel and links

| Where | Text | Status |
|---|---|---|
| src/commands/share.ts:11 | Button: Post to channel | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:50 | Link button: Wiki | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:51 | Link button: MnMdb | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:52 | Link button: MNM Realm | APPROVED (owner, by exception, 2026-10-20) |

### /craft find buttons

| Where | Text | Status |
|---|---|---|
| src/commands/find.ts:298 | Button: I know this recipe | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:298 | Button: Report a problem | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:298 | Button: Stat image | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:103 | (I know this recipe, several characters or recipes) Which character knows which recipe? (showing 25 of \<n>: use `/craft know` for the rest) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:110 | Menu placeholder: Pick a character and recipe | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:114 | Menu option: \<character> (main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:115 | Menu option note: \<tradeskill> · trivial \<number> (or: trivial unknown) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:129 | That character is no longer available. Run `/craft find` again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:131 | That recipe is no longer in the data. Run `/craft find` again. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:91 | Report a problem form title: Report a problem | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:95 | Form field: What is wrong? (choices as in /craft report) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:107 | Form field: Details (optional) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:108 | Form field note: What should it be? Up to 300 characters. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:131 | That item is no longer in the data. Nothing was saved. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:203 | Stat image reply: a card titled \<item> with the screenshot, footer: Screenshot from a guild member, approved by an officer | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/images.ts:201 | No screenshot of **\<item>** yet. Have one? Send it with `/item image`: an officer approves it, then it shows here. | APPROVED (owner, by exception, 2026-10-20) |
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
| src/commands/members.ts:49 | Done: removed **\<member name>** and \<n> character(s): **\<character>** (\<class>, level \<level>), …. Their skills are kept: `/character add` with the same name restores a character. (text at lines 39–40; "(no characters)" in place of the list when there are none) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:46 | Cancelled. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:48 | @\<member> has never used GuildCraft in this server, so there was nothing to remove. | APPROVED (owner, by exception, 2026-10-20) |

### Departure notice buttons (review channel, officers)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:160 | Button: Remove characters | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:160 | Button: Keep | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:70 | (the notice, after Remove) @\<officer> removed **\<member name>** and \<n> character(s): …. Their skills are kept: `/character add` with the same name restores a character. (text at lines 39–40) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:64 | (the notice, after Keep) @\<officer> kept **\<member name>**'s characters. They stay hidden while \<member name> is away and show again once they're back and use GuildCraft. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:60 | **\<member name>** is back and active again, so nothing was changed. (Checked by @\<officer>.) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:58 | This member is no longer recorded. Nothing was changed. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:56 | Sorry, that button has expired. | APPROVED (owner, by exception, 2026-10-20) |

## Cards and posts

### Report card (review channel, from /craft report and Report a problem)

| Where | Text | Status |
|---|---|---|
| src/commands/reports.ts:39 | Title: Report: \<item> (or: Report: unknown item) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:40 | **Issue:** \<issue> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:40 | **From:** @\<member> · \<date and time> | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:40 | **Details:** \<details> (only when given) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:41 | Footer: Report #\<number> · fix the data with /recipe override or /recipe source, then mark it fixed | APPROVED (owner, by exception, 2026-10-20) |

### Departure notice (review channel, nightly)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:146 | Title: \<member name> left the server | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:143 | (name when unknown) A member | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:149 | **Characters**<br>**\<character>** (\<class>, level \<level>), one per line | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:144 | No characters registered. | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:151 | While they are away their characters are hidden from `/craft find`, `/roster` and the roster board. If they come back and use GuildCraft, they show again. | APPROVED (owner, by exception, 2026-10-20) |
| src/departures.ts:152 | **Remove characters** removes the characters (their skills are kept; `/character add` with the same name restores one). **Keep** leaves them as they are. Officers only. | APPROVED (owner, by exception, 2026-10-20) |

### Usage warning (review channel of the dev copy only: the operator's test server)

| Where | Text | Status |
|---|---|---|
| src/usage.ts:106 | (dev only) Free-tier usage: **\<limit name>** was \<amount> of \<limit> (\<percent>) on \<day>, at or over GuildCraft's 10% target. Nothing stops until 100%; `/guildcraft status` shows every figure. | APPROVED (owner, by exception, 2026-10-20) |
| src/usage.ts:107 | (dev only) Free-tier usage: **\<limit name>** is back under the 10% target: \<amount> of \<limit> (\<percent>) on \<day>. | APPROVED (owner, by exception, 2026-10-20) |

### Vault screenshot post (vault channel, from /item image)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:128 | Screenshot of **\<item>** from @\<member> · waiting for an officer (with the image, and Approve and Reject) | APPROVED (owner, by exception, 2026-10-20) |

### Roster board (forum channel)

| Where | Text | Status |
|---|---|---|
| src/board/refresh.ts:172 | Post name: \<tradeskill> | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:49 | \<n> character(s) (\<n> member(s)), ranked by skill level. (count at line 31) | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:45 | **\<rank>.** **\<character>** · \<member name> · \<skill level> · *stale* | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:50 | No one in the guild has recorded \<tradeskill> yet. Use `/craft set` to get listed. | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:51 | Footer: stale = not updated in \<number> days | APPROVED (owner, by exception, 2026-10-20) |

### Roster board index (pinned post)

| Where | Text | Status |
|---|---|---|
| src/board/render.ts:123 | Post name: Index: how to get listed | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:118 | Title: Crafting roster: index | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:113 | #\<tradeskill post> · \<n> character(s) — or, before the post exists: \<tradeskill> *(post coming)* · \<n> character(s) | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:96 | **How to get listed** | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:97 | 1. `/character add` your character. | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:98 | 2. `/craft set` a tradeskill level, or `/craft update` for several at once. | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:99 | 3. Your tradeskill posts update within about a minute. | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:102 | **Also** | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:103 | `/craft find` who can make an item · `/craft know` mark a recipe you know · `/roster recipes` who knows the hard-to-get ones | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:104 | `/craft report` report wrong data · `/item image` send an item screenshot · `/craft help` every command | APPROVED (owner, by exception, 2026-10-20) |
| src/board/render.ts:116 | Last refresh: \<date and time> (\<time ago>) | APPROVED (owner, by exception, 2026-10-20) |

## Help and welcome

### /craft help reply

Each command line shows as `` `/command` what it does ``. A line whose command is not built yet ends with *(coming soon)* (src/commands/help.ts:7); today that is only `/recipe add`.

| Where | Text | Status |
|---|---|---|
| src/commands/help.ts:46 | ## GuildCraft — every command | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:15 | **Your characters** | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:16 | `/character add` register a character (name, class, level, main) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:17 | `/character edit` rename it or change class, level or main | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:18 | `/character remove` remove a character (its skills are kept if you add it back) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:19 | **Your skills and recipes** | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:20 | `/craft set` set one tradeskill level | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:21 | `/craft update` press Enter, pick up to 5 tradeskills, then type their levels | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:22 | `/craft me` your skills, levels and last update (private) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:23 | `/craft know` · `/craft forget` mark a recipe as known (or press **I know this recipe** on `/craft find`), or undo it | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:24 | **Find a crafter** | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:25 | `/craft find` who can make an item, with its recipe and stats | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:26 | `/roster skill` everyone with a tradeskill, ranked | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:27 | `/roster member` one member's characters and skills | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:28 | `/roster top` the top 3 in each tradeskill | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:29 | `/roster recipes` who knows the hard-to-get reputation and discovery recipes | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:30 | **Items and data** | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:31 | `/item image` send a screenshot of an item window; it shows under **Stat image** once an officer approves it | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:32 | `/craft report` report a wrong trivial, ingredient or source, or a missing recipe (or press **Report a problem**) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:33 | `/recipe add` record a recipe the data is missing (officer-approved) *(coming soon)* | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:34 | **Officers and admins** | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:35 | `/guildcraft setup` set the member and officer roles, the roster board forum, and the review and vault channels | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:36 | `/guildcraft status` data version, last data update, the board, the channels and the backup | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:37 | `/recipe source` · `/recipe override` set how a recipe is obtained; correct its trivial or ingredients (this server only) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:38 | `/guildcraft remove-member` remove a departed member | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:39 | `/guildcraft rebuild-board` recreate the roster board posts in A→Z order | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:40 | `/craft help` this guide | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:9 | Questions or problems: send a Discord message to **Joegandomi**, who runs GuildCraft. (new in order 10; shown at the end of help, line 51, and of the welcome) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/help.ts:52 | -# Item data: Monsters and Memories Wiki (CC BY-SA 4.0) | APPROVED (owner, by exception, 2026-10-20) |

### Welcome (shown once, privately, with a new member's first reply)

| Where | Text | Status |
|---|---|---|
| src/commands/welcome.ts:8 | Title: Welcome to GuildCraft | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:10 | Three steps to get started: | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:11 | **1.** `/character add`: register your character. Your first one becomes your main. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:12 | **2.** `/craft update`: press Enter, pick up to 5 tradeskills, then type their levels. (`/craft set` sets one skill.)<br>Or press the **Update skills** button under your `/craft me`, `/craft set` or `/character add` reply. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:13 | **3.** `/craft find`: look up who in the guild can make an item. (ends with " *(coming soon: not available yet)*" only if /craft find were not built; it is built) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:15 | *You see this message once. `/craft help` lists every command.* | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/welcome.ts:16 | The contact line (src/commands/help.ts:9), naming Joegandomi | APPROVED (owner, by exception, 2026-10-20) |

## Errors shared by many commands

| Where | Text | Status |
|---|---|---|
| src/respond.ts:16 | Sorry, something went wrong on our side and GuildCraft could not answer. Please try again in a moment. If it keeps happening, tell Joegandomi. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:23 | Sorry, that command isn't available yet. Type `/craft help` to see what's coming. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:24 | Sorry, GuildCraft works inside a server, not in direct messages. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:25 | Only server admins (Administrator or Manage Server) can change GuildCraft settings. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:26 | Sorry, that menu has expired. Run the command again. | APPROVED (owner, by exception, 2026-10-20) |
| src/interactions.ts:27 | GuildCraft in this server is for members with the @\<role> role. Ask an officer if you should have it. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/members.ts:13 | Only officers can do that. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:37 | Only officers can change another member's characters. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:38 | **\<name>** is already taken in this guild. Character names are unique (capital letters don't count). | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:41 | You have no character named **\<name>**. — or, for an officer naming a member: @\<member> has no character named **\<name>**. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/character.ts:45 | You have no characters yet. Add one with `/character add`. — or: @\<member> has no characters yet. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/skills.ts:36 | I don't know a tradeskill called **\<typed text>**. Pick one from the list as you type. (also src/commands/recipes.ts:333, src/commands/roster.ts:108) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/reports.ts:78 | I don't know an item called **\<typed text>**. Pick one from the list as you type. (also src/commands/images.ts:100) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:24 | No recipe found for **\<typed text>**. Pick a recipe from the list as you type. (/craft know, /craft forget, /recipe) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/recipes.ts:28 | **\<item>** has \<n> recipes (\<tradeskill>, trivial \<number>; \<tradeskill>, trivial \<number>). Pick the one you mean from the list as you type. | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/find.ts:303 | That item no longer has a recipe. Run `/craft find` again. (also src/commands/recipes.ts:98) | APPROVED (owner, by exception, 2026-10-20) |
| src/commands/roster.ts:121 | That tradeskill is no longer in the list. Run `/roster skill` again. (also lines 129 and 208) | APPROVED (owner, by exception, 2026-10-20) |

## Counts

| Group | Strings |
|---|---|
| Commands | 271 |
| Buttons and menus | 57 |
| Cards and posts | 30 |
| Help and welcome | 36 |
| Errors shared by many commands | 17 |
| **Total** | **411** |

All 411 are approved (work order 11, 2026-10-20).

## Work order 13: /gear find (DRAFT)

Every line below is DRAFT until approved. \<label> is a filter as the member set it (for example "slot: CHEST").

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:131 | `/gear`: Find gear upgrades in the community wiki data | DRAFT |
| src/commands/definitions.ts:138 | `/gear find`: Gear for your class, by slot, weapon type, AC, ratio, stats and source | DRAFT |
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
| src/commands/gear.ts:46 | That item is no longer in the data. Run `/gear find` again. | DRAFT |
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
| src/commands/help.ts:31 | `/craft help`: `/gear find` find gear for your class by slot, weapon type, AC, ratio, stats and source | DRAFT |
| src/board/render.ts:103 | Board index: `/gear find` gear for your class, by slot, stats and source | DRAFT |
