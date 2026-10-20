# GuildCraft copy list

This is every piece of text GuildCraft shows to members, officers and admins in Discord, so Joegandomi can approve it before launch.
To approve a line, change its Status from **DRAFT** to **APPROVED**. To change one, write the wording you want in the Status cell (or next to the row). Anything left as DRAFT counts as not approved.
Parts in angle brackets, such as \<item name> or \<character>, are filled in by the bot each time. @\<member> is a mention of a member, #\<channel> a link to a channel, @\<role> a role, \<date and time> a Discord timestamp shown in the reader's own time zone.
"Seen in check, not yet approved" marks text Joegandomi saw working in the check of order 9 on 2026-10-20; it still needs an APPROVED.

Where: the file and line the text starts on in `src/`, as of this list. "-#" at the start of a line is Discord's small grey text.

## Commands

### Options several commands share

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:27 | `member` option: Officers only: act on another member's character | DRAFT |
| src/commands/definitions.ts:29 | `class` option: Class: pick from the list, or type your own | DRAFT |
| src/commands/definitions.ts:30 | `level` option (characters): Character level | DRAFT |
| src/commands/definitions.ts:31 | `main` option: Make this your main character | DRAFT |
| src/commands/definitions.ts:32 | `character` option: Optional; defaults to your main | DRAFT |
| src/commands/definitions.ts:33 | `skill` option: Tradeskill | DRAFT |
| src/commands/definitions.ts:35 | `recipe` option: A recipe: pick from the list (each shows its tradeskill and trivial) | DRAFT |
| src/commands/definitions.ts:36 | `item` option (/craft report, /item image): An item: pick from the list | DRAFT |
| src/commands/definitions.ts:38 | `item` option (/recipe source, /recipe override): The item: pick its recipe from the list (each shows its tradeskill and trivial) | DRAFT |
| src/recipes.ts:74 | A recipe in pick lists and replies: \<item> · \<tradeskill> · trivial \<number> (or: \<item> · \<tradeskill> · trivial unknown) | DRAFT |

### /character

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:44 | `/character`: Register and manage your characters | DRAFT |

#### /character add

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:51 | Register a character | DRAFT |
| src/commands/definitions.ts:52 | `name` option: Character name | DRAFT |
| src/commands/character.ts:188 | Added **\<character>** (\<class>, level \<level>). | DRAFT |
| src/commands/character.ts:150 | (added after "Added …", first character) It is your main (your first character). | DRAFT |
| src/commands/character.ts:150 | (added after "Added …", with `main:True`) It is now your main. | DRAFT |
| src/commands/character.ts:166 | Restored **\<character>** (\<class>, level \<level>), which you removed earlier, with its \<number> saved skill(s). It is your main. | DRAFT |
| src/commands/character.ts:92 | A character name can't be empty. (also /character edit) | DRAFT |
| src/commands/character.ts:93 | A character name can be at most 32 characters. (also /character edit) | DRAFT |
| src/commands/character.ts:94 | A character name can't contain line breaks or control characters. (also /character edit) | DRAFT |
| src/commands/character.ts:109 | Level must be a whole number from 1 to 100. (also /character edit) | DRAFT |
| src/commands/character.ts:104 | Class **\<class>** isn't in the class list taken from the wiki data, so it's saved as typed. (The game is in Early Access; the list may be incomplete.) (also /character edit) | DRAFT |
| src/commands/character.ts:49 | **\<name>** belongs to a removed character, so it can't be reused yet. An officer can rename the removed character to free the name. (also /character edit) | DRAFT |
| src/commands/character.ts:50 | (added for officers) It belongs to @\<member>: use `/character edit` with `member:` set to them and a `new_name`. | DRAFT |

#### /character edit

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:57 | Rename a character, or change its class, level or main flag | DRAFT |
| src/commands/definitions.ts:59 | `name` option: The character to change | DRAFT |
| src/commands/definitions.ts:60 | `new_name` option: A new name | DRAFT |
| src/commands/character.ts:207 | Nothing to change: give a `new_name`, `class`, `level` or `main`. | DRAFT |
| src/commands/character.ts:219 | There is a removed character named **\<name>** on this account. `/character add name:<name>` restores it; or pick another name. | DRAFT |
| src/commands/character.ts:236 | **\<character>** is removed; it can't be made a main until it is restored. | DRAFT |
| src/commands/character.ts:237 | **\<character>** is the main. To change that, set `main` on another character. | DRAFT |
| src/commands/character.ts:258 | Updated **\<character>** (\<class>, level \<level>) (was **\<old name>**). It is now the main. ("(was …)" only on a rename, line 256; "It is now the main." only when it became main, line 257) | DRAFT |

#### /character remove

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:70 | Remove a character and hide its skills | DRAFT |
| src/commands/definitions.ts:72 | `name` option: The character to remove | DRAFT |
| src/commands/character.ts:279 | Removed **\<character>**. Its skills are kept: `/character add name:<character>` restores it. | DRAFT |
| src/commands/character.ts:280 | **\<character>** is now the main. | DRAFT |

### /craft

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:80 | `/craft`: Guild crafting: find crafters and track tradeskills | DRAFT |

#### /craft set

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:87 | Set one tradeskill level | DRAFT |
| src/commands/definitions.ts:88 | `level` option: Skill level | DRAFT |
| src/commands/skills.ts:53 | **\<character>**: \<tradeskill> set to **\<level>** (was \<old level>). ("(was …)" only when it had a level) | DRAFT |
| src/commands/skills.ts:27 | Level must be a whole number from 0 to \<skill cap>. | DRAFT |

#### /craft update

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:90 | Update up to 5 skills: press Enter, pick skills, then type levels | DRAFT |
| src/commands/skills.ts:120 | Pick up to 5 tradeskills for **\<character>**. A form then opens with a level box for each. | DRAFT |
| src/commands/skills.ts:119 | The tradeskill list is empty: the recipe data has not been imported yet. | DRAFT |

(The skill menu and the levels form are under Buttons and menus.)

#### /craft me

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:91 | Your characters, skills and last updates (private) | DRAFT |
| src/commands/skills.ts:278 | Card title: \<character> (main) ("(main)" only on the main) | DRAFT |
| src/commands/skills.ts:268 | Card first line: \<class> · level \<level> | DRAFT |
| src/commands/skills.ts:275 | **\<tradeskill>** \<level> · \<date> · *stale* ("*stale*" only when old) | DRAFT |
| src/commands/skills.ts:279 | No skills yet: `/craft set` or `/craft update`. | DRAFT |
| src/commands/recipes.ts:154 | Known recipes: \<item> (\<tradeskill>), \<item> (\<tradeskill>) +\<number> more | DRAFT |
| src/commands/skills.ts:283 | Showing 10 of \<number> characters. | DRAFT |
| src/commands/skills.ts:284 | -# *stale* = not updated in \<number> days. | DRAFT |

#### /craft find

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:95 | Who in the guild can make an item: recipe, stats and crafters | DRAFT |
| src/commands/definitions.ts:96 | `item` option: An item that has a recipe: pick from the list | DRAFT |
| src/commands/find.ts:275 | No recipe found for **\<typed text>**. Pick an item from the list as you type. | DRAFT |
| src/commands/find.ts:272 | Showing \<number> of \<number> recipes. | DRAFT |
| src/commands/find.ts:94 | Item card footer: Item data: Monsters and Memories Wiki, CC BY-SA 4.0 · data \<data version> | DRAFT |
| src/commands/find.ts:89 | (data version when none) not imported | DRAFT |
| src/commands/find.ts:69 | Item card field: Slot | DRAFT |
| src/commands/find.ts:70 | Item card field: AC | DRAFT |
| src/commands/find.ts:71 | Item card field: Damage — \<damage> / \<delay> delay · \<weapon skill> · \<handed> | DRAFT |
| src/commands/find.ts:72 | Item card field: HP | DRAFT |
| src/commands/find.ts:73 | Item card field: Mana | DRAFT |
| src/commands/find.ts:75 | Item card field: Stats — \<stat> +\<n> · \<stat> +\<n> | DRAFT |
| src/commands/find.ts:77 | Item card field: Resists — \<resist> +\<n> · … | DRAFT |
| src/commands/find.ts:78 | Item card fields: HP regen · Mana regen · Haste | DRAFT |
| src/commands/find.ts:80 | Item card field: Effect — \<effect> (\<trigger>) | DRAFT |
| src/commands/find.ts:81 | Item card field: Weight · Size — \<weight> wt · \<size> | DRAFT |
| src/commands/find.ts:82 | Item card field: Class / Race — \<classes> / \<races> | DRAFT |
| src/commands/find.ts:83 | Item card field: Flags | DRAFT |
| src/commands/find.ts:186 | Recipe card title: Recipe \<n> of \<total>: \<tradeskill> · \<trivial> ("Recipe n of total:" only when the item has several) | DRAFT |
| src/commands/find.ts:111 | trivial unknown | DRAFT |
| src/commands/find.ts:112 | trivial \<number> (guild-corrected) | DRAFT |
| src/commands/find.ts:113 | trivial \<number>? (the ? when the wiki marks it unconfirmed) | DRAFT |
| src/commands/find.ts:117 | Ingredients unknown (\<number>) | DRAFT |
| src/commands/find.ts:118 | \<quantity> × \<component> | DRAFT |
| src/commands/find.ts:119 | plus \<number> unknown ingredient(s) | DRAFT |
| src/commands/find.ts:171 | -# Ingredients (guild-corrected) | DRAFT |
| src/commands/find.ts:172 | Makes \<number> | DRAFT |
| src/commands/find.ts:173 | Station: \<station> | DRAFT |
| src/commands/find.ts:143 | Crafter group: Reliable (\<tradeskill> \<trivial>+) | DRAFT |
| src/commands/find.ts:144 | Crafter group: Still learning (\<tradeskill> \<low>–\<high>) | DRAFT |
| src/commands/find.ts:145 | Crafter group: Trivial unknown: everyone with \<tradeskill> | DRAFT |
| src/commands/find.ts:146 | Crafter group: Has skill, needs reputation (\<faction>) | DRAFT |
| src/commands/find.ts:146 | Crafter group: Has skill, recipe not marked known | DRAFT |
| src/commands/find.ts:177 | Group heading count: \<group> · \<number> | DRAFT |
| src/commands/find.ts:140 | Crafter line: **\<character>** \<skill level> 📜 (📜 only when they marked the recipe known) | DRAFT |
| src/commands/find.ts:135 | +\<number> more | DRAFT |
| src/commands/find.ts:180 | Further below: \<number> | DRAFT |
| src/commands/find.ts:181 | No one in the guild has recorded \<tradeskill> yet. | DRAFT |
| src/commands/find.ts:158 | **Vendor recipe**: may need buying first: \<officer's note>. (guild-corrected) | DRAFT |
| src/commands/find.ts:160 | **Reputation recipe** (\<faction>): only characters who marked it known (📜) count as able: \<officer's note>. (guild-corrected) | DRAFT |
| src/commands/find.ts:162 | **Discovery recipe**: only characters who marked it known (📜) count as able: \<officer's note>. (guild-corrected) | DRAFT |
| src/commands/find.ts:150 | -# How this recipe is obtained is not recorded: check the crafter has it. | DRAFT |
| src/commands/find.ts:183 | -# 📜 marked this recipe known | DRAFT |
| src/commands/share.ts:30 | (on a copy posted to the channel) -# Shared by @\<member> | DRAFT |

(The buttons under the reply are under Buttons and menus.)

#### /craft know

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:98 | Mark a recipe as known by your character | DRAFT |
| src/commands/recipes.ts:47 | Marked **\<recipe>** as known for **\<character>**. `/craft find` now shows \<character> with the known-recipe marker; `/craft forget` undoes it. (also the I know this recipe button) | seen in check, not yet approved |
| src/commands/recipes.ts:46 | **\<character>** already has **\<recipe>** marked known. (also the I know this recipe button) | seen in check, not yet approved |

#### /craft forget

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:99 | Unmark a recipe your character marked known | DRAFT |
| src/commands/recipes.ts:76 | **\<character>** no longer has **\<recipe>** marked known. | DRAFT |
| src/commands/recipes.ts:75 | **\<character>** didn't have **\<recipe>** marked known, so nothing changed. | DRAFT |

#### /craft report

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:103 | Report a wrong trivial, component or source, or a missing recipe, to the officers | DRAFT |
| src/commands/definitions.ts:106 | `issue` option: What is wrong | DRAFT |
| src/recipes.ts:19 | Issue choice: Wrong trivial | DRAFT |
| src/recipes.ts:20 | Issue choice: Wrong components | DRAFT |
| src/recipes.ts:21 | Issue choice: Wrong source (how it is obtained) | DRAFT |
| src/recipes.ts:22 | Issue choice: Missing recipe | DRAFT |
| src/recipes.ts:23 | Issue choice: Other | DRAFT |
| src/commands/definitions.ts:107 | `details` option: Optional: what it should be (up to 300 characters) | DRAFT |
| src/commands/reports.ts:63 | Thanks: your report on **\<item>** (\<issue>) is saved. Officers have been sent it to review. (ending at line 69; also the Report a problem form) | DRAFT |
| src/commands/reports.ts:64 | Thanks: your report on **\<item>** (\<issue>) is saved. Officers will see it in `/guildcraft status`. (no review channel, or the post failed: lines 64 and 69) | DRAFT |
| src/commands/reports.ts:49 | Pick an issue from the list: Wrong trivial, Wrong components, Wrong source (how it is obtained), Missing recipe, Other. | DRAFT |
| src/commands/reports.ts:51 | Details can be at most 300 characters. Nothing was saved. | DRAFT |
| src/commands/reports.ts:54 | You already have 5 reports waiting for an officer. Once one is marked fixed or dismissed you can file another. | DRAFT |

#### /craft help

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:110 | A one-screen guide to every command | DRAFT |

(The reply is under Help and welcome.)

### /item image

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:115 | `/item`: Item screenshots | DRAFT |
| src/commands/definitions.ts:122 | Send a screenshot of an item window; an officer approves it before it shows | DRAFT |
| src/commands/definitions.ts:123 | `image` option: PNG, JPEG or WebP, up to 8 MB | DRAFT |
| src/commands/images.ts:147 | Thanks: your screenshot of **\<item>** is waiting for an officer to approve it. Once approved, it shows under **Stat image** on `/craft find`. | seen in check, not yet approved |
| src/commands/images.ts:59 | Screenshots need a vault channel first: a server admin runs `/guildcraft setup vault:` with a private channel for officers. Nothing was saved. | DRAFT |
| src/commands/images.ts:90 | Attach the screenshot in the `image:` box. Nothing was saved. | DRAFT |
| src/commands/images.ts:91 | That file is \<size> MB; the limit is 8 MB. A cropped screenshot of the item window is plenty. | DRAFT |
| src/commands/images.ts:109 | Your screenshot of **\<item>** is still waiting for an officer. You can send another once it is approved or rejected. | DRAFT |
| src/commands/images.ts:110 | You have 5 screenshots waiting for an officer. You can send more once some are reviewed. | DRAFT |
| src/commands/images.ts:113 | Sorry, I couldn't read that attachment from Discord. Please try again. | DRAFT |
| src/commands/images.ts:115 | That file is over the 8 MB limit. | DRAFT |
| src/commands/images.ts:117 | That file is not a PNG, JPEG or WebP image. Nothing was saved. | DRAFT |
| src/commands/images.ts:139 | Sorry, I couldn't post that screenshot to the vault. Nothing is waiting for review. | DRAFT |
| src/commands/images.ts:138 | (added in the middle of the line above when Discord refuses for permissions) I may have lost a permission in the vault channel: an admin can run `/guildcraft setup vault:` again to check. | DRAFT |

### /recipe (officers)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:129 | `/recipe`: Officers: correct recipes for this server | DRAFT |

#### /recipe source

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:140 | Set how a recipe is obtained (this server only) | DRAFT |
| src/commands/definitions.ts:143 | `how` option: How it is obtained | DRAFT |
| src/recipes.ts:12 | `how` choices: Vendor · Reputation · Discovery · Unknown | DRAFT |
| src/commands/definitions.ts:145 | `faction` option: Reputation recipes: the faction that sells it (type any name) | DRAFT |
| src/commands/definitions.ts:146 | `note` option: Optional: vendor, standing needed, or a hint | DRAFT |
| src/commands/recipes.ts:192 | Saved for this server: **\<recipe>** is now **\<Vendor / Reputation / Discovery / Unknown>** (\<faction>) · \<note>. \<what it changes, below><br>-# Other servers and the nightly import are not affected. | DRAFT |
| src/commands/recipes.ts:188 | (what it changes, reputation) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, needs reputation (\<faction>)". | DRAFT |
| src/commands/recipes.ts:188 | (what it changes, discovery) Only characters who marked it known now count as able to make it; others with \<tradeskill> show as "has skill, recipe not marked known". | DRAFT |
| src/commands/recipes.ts:190 | (what it changes, vendor) `/craft find` uses the skill tiers and says it may need buying first. | DRAFT |
| src/commands/recipes.ts:191 | (what it changes, unknown) `/craft find` uses the skill tiers, with a note to check the crafter has the recipe. | DRAFT |
| src/commands/recipes.ts:174 | `how` must be one of: vendor, reputation, discovery, unknown. | DRAFT |
| src/commands/recipes.ts:177 | A reputation recipe needs `faction:`, the faction that sells it, so members know what to work toward. Nothing was changed. | DRAFT |
| src/commands/recipes.ts:178 | Keep `faction` to 80 and `note` to 200 characters. Nothing was changed. | DRAFT |

#### /recipe override

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:152 | Correct a recipe's trivial or components (this server only) | DRAFT |
| src/commands/definitions.ts:155 | `trivial` option: The correct trivial | DRAFT |
| src/commands/definitions.ts:156 | `components` option: The full list, e.g. 2 Copper Bar, 1 Flux | DRAFT |
| src/commands/definitions.ts:157 | `reset` option: True: remove this server's correction | DRAFT |
| src/commands/recipes.ts:255 | Saved for this server: **\<recipe>** now shows trivial **\<number>** and components \<quantity> × \<component>, …, marked guild-corrected on `/craft find`. `reset:True` removes the correction.<br>-# Other servers and the nightly import are not affected. | DRAFT |
| src/commands/recipes.ts:220 | Reset **\<recipe>**: its trivial and components come from the imported data again (they already did). ("(they already did)" only when there was nothing to reset) | DRAFT |
| src/commands/recipes.ts:224 | Give `trivial:`, `components:` or both, or `reset:True` to remove this server's correction. | DRAFT |
| src/commands/recipes.ts:225 | `trivial` must be a whole number from 0 to \<skill cap>. Nothing was changed. | DRAFT |
| src/commands/recipes.ts:229 | I couldn't read `components`. Write them like `2 Copper Bar, 1 Flux`. Nothing was changed. | DRAFT |
| src/commands/recipes.ts:237 | Nothing was changed. No item is named exactly: **\<name>**, **\<name>**. Check the spelling against `/craft find`. | DRAFT |
| src/commands/recipes.ts:239 | Nothing was changed: an item is listed twice. Give each item once, with its total quantity. | DRAFT |

### /roster

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:164 | `/roster`: The guild's crafters, by tradeskill or by member | DRAFT |

#### /roster skill

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:171 | Everyone with a tradeskill, ranked by skill level | DRAFT |
| src/commands/definitions.ts:172 | `min_level` option: Only show skill levels at or above this | DRAFT |
| src/commands/roster.ts:74 | Card title: \<tradeskill>: \<number> character(s) at \<min level>+ ("at …+" only with min_level) | DRAFT |
| src/commands/roster.ts:70 | **\<rank>.** **\<character>** \<skill level> · \<class> lvl \<level> · *stale* | DRAFT |
| src/commands/roster.ts:75 | No one in the guild has recorded \<tradeskill> at \<min level>+ yet. | DRAFT |
| src/commands/roster.ts:76 | Footer: Page \<n> of \<pages> · stale = not updated in \<number> days | DRAFT |
| src/commands/roster.ts:110 | min_level must be a whole number from 0 to \<skill cap>. | DRAFT |

#### /roster member

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:177 | One member's characters and skills | DRAFT |
| src/commands/definitions.ts:178 | `member` option: The member | DRAFT |
| src/commands/roster.ts:161 | @\<member>: \<number> character(s) (showing \<number>) | DRAFT |
| src/commands/roster.ts:160 | @\<member> has no characters on the roster. | DRAFT |
| src/commands/roster.ts:151 | Card title: \<character> (main) | DRAFT |
| src/commands/roster.ts:19 | \<class> lvl \<level> | DRAFT |
| src/commands/roster.ts:154 | **\<tradeskill>** \<level> | DRAFT |
| src/commands/roster.ts:157 | No skills recorded. | DRAFT |
| src/commands/roster.ts:167 | Pick a member. | DRAFT |

#### /roster top

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:180 | The top 3 characters in each tradeskill | DRAFT |
| src/commands/roster.ts:192 | Card title: Top 3 in each tradeskill | DRAFT |
| src/commands/roster.ts:190 | **\<tradeskill>**: \<character> \<level> · \<character> \<level> · \<character> \<level> | DRAFT |
| src/commands/roster.ts:193 | No one in the guild has recorded a tradeskill yet. | DRAFT |

#### /roster recipes

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:184 | Who knows the reputation and discovery recipes | DRAFT |
| src/commands/definitions.ts:185 | `skill` option: Optional: one tradeskill | DRAFT |
| src/commands/recipes.ts:299 | Card title: Reputation and discovery recipes · \<tradeskill>: \<number> | DRAFT |
| src/commands/recipes.ts:297 | **\<item>** · \<tradeskill> · \<Reputation / Discovery> (\<faction>): \<character>, \<character> | DRAFT |
| src/commands/recipes.ts:291 | No one has marked a reputation or discovery recipe as known yet. Officers set how a recipe is obtained with `/recipe source`; members then mark the ones they know with `/craft know` or the **I know this recipe** button on `/craft find`. | DRAFT |
| src/commands/recipes.ts:301 | Footer: Page \<n> of \<pages> | DRAFT |

### /guildcraft (admins)

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:191 | `/guildcraft`: GuildCraft settings for this server | DRAFT |

#### /guildcraft setup

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:202 | Set the roles and the roster board (leave all out to see the current settings) | DRAFT |
| src/commands/definitions.ts:204 | `member_role` option: Members need this role to use GuildCraft (default: anyone) | DRAFT |
| src/commands/definitions.ts:205 | `officer_role` option: Officers can edit any member's entries | DRAFT |
| src/commands/definitions.ts:206 | `board` option: A forum channel for the roster board: one post per tradeskill | DRAFT |
| src/commands/definitions.ts:207 | `review` option: A private text channel for officers: departure notices and member reports | DRAFT |
| src/commands/definitions.ts:208 | `vault` option: A private text channel for officers: item screenshots waiting for approval | DRAFT |
| src/commands/setup.ts:158 | Current settings: (then the five lines below) | DRAFT |
| src/commands/setup.ts:191 | Saved. (then the five lines below) | DRAFT |
| src/commands/setup.ts:15 | Member role: @\<role> — or: Member role: none (anyone in the server can use GuildCraft) | DRAFT |
| src/commands/setup.ts:16 | Officer role: @\<role> (Administrator and Manage Server always count as officers) — or: Officer role: none (Administrator and Manage Server always count as officers) | DRAFT |
| src/commands/setup.ts:19 | Roster board: #\<channel> — or: Roster board: not set (`board:` picks a forum channel) | DRAFT |
| src/commands/setup.ts:21 | Review channel: #\<channel> — or: Review channel: not set (`review:` picks a private text channel for departure notices and reports) | DRAFT |
| src/commands/setup.ts:23 | Vault channel: #\<channel> — or: Vault channel: not set (`vault:` picks a private text channel for item screenshots) | DRAFT |
| src/commands/setup.ts:193 | Screenshots from `/item image` will wait in #\<channel> for an officer's Approve or Reject. Screenshots already in an earlier vault stay where they are. | DRAFT |
| src/commands/setup.ts:106 | **Note:** everyone in the server can see #\<channel>, so screenshots waiting for approval will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel. The setting is saved either way. | DRAFT |
| src/commands/setup.ts:196 | **Note:** I couldn't check who can see #\<channel>. The vault should be a channel only officers can see. | DRAFT |
| src/commands/setup.ts:199 | Departure notices will go to #\<channel>: one per member who leaves the server, checked nightly, with Remove and Keep buttons for officers. | DRAFT |
| src/commands/setup.ts:103 | **Note:** everyone in the server can see #\<channel>, so departure notices (a member's name and characters) and usage warnings will show to all members. To keep them to officers: Edit Channel → Permissions → @everyone → turn off View Channel, then add your officer role with View Channel on. The setting is saved either way. | DRAFT |
| src/commands/setup.ts:107 | **Note:** I couldn't check who can see #\<channel>. Departure notices should go to a channel only officers can see. | DRAFT |
| src/commands/setup.ts:211 | Building the board now: \<number> tradeskill post(s) plus a pinned index post. Most appear within a minute, all within 15 minutes. | DRAFT |
| src/commands/setup.ts:212 | The board already has every tradeskill post; refreshing it now. | DRAFT |
| src/commands/setup.ts:214 | The old board's posts in #\<channel> are left as they are. | DRAFT |
| src/commands/setup.ts:113 | #\<channel> is not a forum channel. The roster board needs a forum channel: create one (Create Channel → Forum), then pick it here. | DRAFT |
| src/commands/setup.ts:118 | #\<channel> is not a text channel. The review channel needs a text channel (a private one, for officers), then pick it here. | DRAFT |
| src/commands/setup.ts:123 | #\<channel> is not a text channel. The vault needs a private text channel for officers, then pick it here. | DRAFT |
| src/commands/setup.ts:131 | Sorry, Discord didn't send that channel's details. Run the command again and pick the channel from the list. | DRAFT |
| src/commands/setup.ts:140 | Sorry, I couldn't read my permissions in #\<channel>. Nothing was changed; please try again. | DRAFT |
| src/commands/setup.ts:144 | Nothing was changed. In #\<channel> GuildCraft is missing: **\<permission>**, **\<permission>**.<br>Give the GuildCraft role these in the channel's settings (Permissions), then run this again. | DRAFT |
| src/permissions.ts:49 | Permission name: View Channel | DRAFT |
| src/permissions.ts:50 | Permission name: Send Messages (in a forum: Create Posts) | DRAFT |
| src/permissions.ts:51 | Permission name: Send Messages in Threads (Send Messages in Posts) | DRAFT |
| src/permissions.ts:52 | Permission name: Embed Links | DRAFT |
| src/permissions.ts:53 | Permission name: Attach Files | DRAFT |
| src/permissions.ts:54 | Permission name: Read Message History | DRAFT |
| src/permissions.ts:55 | Permission name: Manage Threads (Manage Posts, to pin the index) | DRAFT |

#### /guildcraft status

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:211 | Data version, last import, the roster board and departures | DRAFT |
| src/commands/setup.ts:300 | ## GuildCraft status | DRAFT |
| src/commands/setup.ts:302 | **Copy:** production — or dev, or not set | DRAFT |
| src/commands/setup.ts:303 | **Data version:** `<version>` — or: **Data version:** no completed import yet | DRAFT |
| src/commands/setup.ts:304 | **Last import:** \<date and time> (\<time ago>) · \<ok / failed / …> (\<error>) · \<number> warning(s) — or "warnings unreadable" — or: **Last import:** none yet | DRAFT |
| src/commands/setup.ts:297 | **Latest nightly run:** \<date and time> (\<time ago>) · **\<status>**: \<error> | DRAFT |
| src/commands/setup.ts:289 | **Last dry run:** \<date and time> (\<time ago>) · wrote nothing · \<number> warning(s) (or: warnings unreadable) | DRAFT |
| src/commands/setup.ts:221 | (any time that has not happened) never | DRAFT |
| src/commands/setup.ts:308 | **Roster board:** #\<channel> · \<n> of \<n> posts · last refresh \<date and time> (\<time ago>) · \<n> waiting to refresh | DRAFT |
| src/commands/setup.ts:309 | **Roster board:** not set up (`/guildcraft setup board:`) | DRAFT |
| src/board/order.ts:36 | **Board order:** A→Z | DRAFT |
| src/board/order.ts:36 | **Board order:** out of order — run `/guildcraft rebuild-board` | DRAFT |
| src/commands/setup.ts:311 | **Review channel:** #\<channel> — or: **Review channel:** not set (`/guildcraft setup review:`) | DRAFT |
| src/commands/setup.ts:312 | **Waiting for officers:** \<n> open report(s) · \<n> pending screenshot(s) in #\<channel> — or, with no vault: … (no vault channel: `/guildcraft setup vault:`) | DRAFT |
| src/commands/setup.ts:313 | **Departures:** \<n> member(s) marked as left · last nightly check \<date and time> (\<time ago>) · \<n> marked · note: \<note, below> | DRAFT |
| src/departures.ts:197 | (departures note) ceiling: \<n> of \<n> active members would be marked (limit 25, or 30% once 3+); nobody marked | DRAFT |
| src/departures.ts:225 | (departures note) no review channel set: notices wait until /guildcraft setup review: is set | DRAFT |
| src/departures.ts:242 | (departures note) call budget: remaining notices carry to the next run | DRAFT |
| src/departures.ts:248 | (departures note) the review channel refused a notice; the rest wait for the next run | DRAFT |
| src/departures.ts:254 | (departures note) \<n> notice(s) over the nightly 10 carry to the next run | DRAFT |
| src/departures.ts:83 | (departures note) member list page \<n> not read (\<reason>) | DRAFT |
| src/departures.ts:84 | (departures note) member list refused: HTTP \<code> code \<code> — check the Server Members Intent (Discord Developer Portal → Applications → MNM-Guildcraft → Bot → Privileged Gateway Intents → turn on Server Members Intent → Save Changes) (the Developer Portal steps are line 47) | DRAFT |
| src/departures.ts:87 | (departures note) member list page \<n>: not a list | DRAFT |
| src/departures.ts:91 | (departures note) member list page \<n>: cursor did not advance | DRAFT |
| src/usage.ts:92 | **Backup:** last \<date and time> · \<token> · \<size> | DRAFT |
| src/usage.ts:88 | (backup, never good) never succeeded | DRAFT |
| src/usage.ts:81 | (backup token) token expires \<date> | DRAFT |
| src/usage.ts:82 | (backup token) token: no expiry (owner's note) — or: token expires unknown | DRAFT |
| src/usage.ts:89 | (backup) latest run \<date and time> **failed**: \<error> | DRAFT |
| src/usage.ts:91 | (backup) **stale**: no successful backup for over 36 hours | DRAFT |
| src/usage.ts:87 | **Backup:** none yet (the nightly backup job writes this line) | DRAFT |
| src/usage.ts:65 | **Usage against the free-tier limits** (whole Cloudflare account, per UTC day; target under 10%) · measured \<date and time> · **stale**: the nightly usage job has not run for over 36 hours ("stale …" only when old) | DRAFT |
| src/usage.ts:74 | - \<limit name>: \<amount> of \<limit> (\<percent>) on \<day> · 7-day peak \<amount> of \<limit> (\<percent>) (\<day>, \<n> day(s) measured) | DRAFT |
| src/usage.ts:69 | - \<limit name>: not measured | DRAFT |
| src/usage.ts:63 | **Usage against the free-tier limits:** no figures yet (the nightly usage job writes them) | DRAFT |
| src/limits.ts:17 | Limit name: Worker requests | DRAFT |
| src/limits.ts:19 | Limit name: D1 rows read | DRAFT |
| src/limits.ts:21 | Limit name: D1 rows written | DRAFT |
| src/limits.ts:23 | Limit name: D1 storage | DRAFT |
| src/limits.ts:25 | Limit name: Workers Logs events | DRAFT |

#### /guildcraft rebuild-board

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:212 | Recreate the roster board posts in A→Z order (posts with replies are kept) | DRAFT |
| src/commands/setup.ts:332 | Rebuilding the roster board in #\<channel> in A→Z order: each tradeskill post is created again, then the old one is deleted. Posts with member replies are kept as they are. | DRAFT |
| src/commands/setup.ts:333 | Most of it happens within a minute, all of it within 15 minutes. `/guildcraft status` shows the board order. | DRAFT |
| src/commands/setup.ts:334 | For A→Z to show at the top, the forum’s Default Sort Order must be Creation Time (Edit Channel). | DRAFT |
| src/commands/setup.ts:326 | There is no roster board yet. Set one up first with `/guildcraft setup board:`. | DRAFT |

#### /guildcraft remove-member

| Where | Text | Status |
|---|---|---|
| src/commands/definitions.ts:216 | Officers: remove a member's characters and mark them as left (shows a preview first) | DRAFT |
| src/commands/definitions.ts:217 | `user` option: The member to remove | DRAFT |
| src/commands/members.ts:26 | This will remove \<n> character(s): **\<character>** (\<class>, level \<level>), … | DRAFT |
| src/commands/members.ts:27 | **\<member name>** has no characters registered. | DRAFT |
| src/commands/members.ts:31 | **\<member name>** is then marked as having left: hidden from `/craft find`, `/roster` and the roster board until they use GuildCraft again. | DRAFT |
| src/commands/members.ts:32 | Their skills are kept, and `/character add` with the same name restores a character. Nothing is deleted. | DRAFT |
| src/commands/members.ts:23 | @\<member> has never used GuildCraft in this server, so there is nothing to remove. | DRAFT |
| src/commands/members.ts:21 | Pick the member to remove. | DRAFT |

(Confirm and Cancel are under Buttons and menus.)

## Buttons and menus

### Update skills (on /character add, /craft set, /craft me) and the /craft update menu

| Where | Text | Status |
|---|---|---|
| src/commands/skills.ts:138 | Button: Update skills — or, with several characters: Update \<character> | DRAFT |
| src/commands/skills.ts:103 | Menu placeholder: Tradeskills: pick up to 5 (with many tradeskills: Tradeskills A–M: pick up to 5, Tradeskills N–Z: pick up to 5, and "(1/2)" when a half is split; labels at lines 78–87) | DRAFT |
| src/commands/skills.ts:109 | Menu option note: Now \<level> | DRAFT |
| src/commands/skills.ts:176 | Form title: Levels for \<character> | DRAFT |
| src/commands/skills.ts:180 | Form box (one per tradeskill, labelled with its name): 0 to \<skill cap> | DRAFT |
| src/commands/skills.ts:237 | Saved for **\<character>**: \<tradeskill> **\<level>** (was \<old level>), \<tradeskill> **\<level>**. | DRAFT |
| src/commands/skills.ts:221 | Nothing was saved. **\<tradeskill>**: "\<typed>" is not a whole number from 0 to \<skill cap>.<br>Run `/craft update` again to retry. | DRAFT |
| src/commands/skills.ts:155 | That character is no longer available. Run `/craft update` again. | DRAFT |
| src/commands/skills.ts:170 | Those tradeskills are no longer in the list. Run `/craft update` again. | DRAFT |
| src/commands/skills.ts:216 | That form is out of date. Run `/craft update` again. | DRAFT |

### Post to channel and links

| Where | Text | Status |
|---|---|---|
| src/commands/share.ts:11 | Button: Post to channel | DRAFT |
| src/commands/find.ts:50 | Link button: Wiki | DRAFT |
| src/commands/find.ts:51 | Link button: MnMdb | DRAFT |
| src/commands/find.ts:52 | Link button: MNM Realm | DRAFT |

### /craft find buttons

| Where | Text | Status |
|---|---|---|
| src/commands/find.ts:298 | Button: I know this recipe | DRAFT |
| src/commands/find.ts:298 | Button: Report a problem | DRAFT |
| src/commands/find.ts:298 | Button: Stat image | DRAFT |
| src/commands/recipes.ts:103 | (I know this recipe, several characters or recipes) Which character knows which recipe? (showing 25 of \<n>: use `/craft know` for the rest) | DRAFT |
| src/commands/recipes.ts:110 | Menu placeholder: Pick a character and recipe | DRAFT |
| src/commands/recipes.ts:114 | Menu option: \<character> (main) | DRAFT |
| src/commands/recipes.ts:115 | Menu option note: \<tradeskill> · trivial \<number> (or: trivial unknown) | DRAFT |
| src/commands/recipes.ts:129 | That character is no longer available. Run `/craft find` again. | DRAFT |
| src/commands/recipes.ts:131 | That recipe is no longer in the data. Run `/craft find` again. | DRAFT |
| src/commands/reports.ts:91 | Report a problem form title: Report a problem | DRAFT |
| src/commands/reports.ts:95 | Form field: What is wrong? (choices as in /craft report) | DRAFT |
| src/commands/reports.ts:107 | Form field: Details (optional) | DRAFT |
| src/commands/reports.ts:108 | Form field note: What should it be? Up to 300 characters. | DRAFT |
| src/commands/reports.ts:131 | That item is no longer in the data. Nothing was saved. | DRAFT |
| src/commands/images.ts:203 | Stat image reply: a card titled \<item> with the screenshot, footer: Screenshot from a guild member, approved by an officer | seen in check, not yet approved |
| src/commands/images.ts:201 | No screenshot of **\<item>** yet. Have one? Send it with `/item image`: an officer approves it, then it shows here. | DRAFT |
| src/commands/images.ts:214 | Sorry, I couldn't fetch the screenshot from Discord just now. Please try again in a moment. | DRAFT |

### Paging and switching (/roster skill, /roster recipes)

| Where | Text | Status |
|---|---|---|
| src/commands/roster.ts:84 | Button: ◀ Previous (also src/commands/recipes.ts:311) | DRAFT |
| src/commands/roster.ts:85 | Button: Next ▶ (also src/commands/recipes.ts:312) | DRAFT |
| src/commands/roster.ts:95 | Menu placeholder: Switch tradeskill — or Switch tradeskill (A–M), Switch tradeskill (N–Z) | DRAFT |

### Report card buttons (review channel, officers)

| Where | Text | Status |
|---|---|---|
| src/commands/reports.ts:45 | Button: Mark fixed | seen in check, not yet approved |
| src/commands/reports.ts:45 | Button: Dismiss | seen in check, not yet approved |
| src/commands/reports.ts:152 | (the card, after a press) ✅ Marked fixed by @\<officer> · \<date and time> — or: ✖️ Dismissed by @\<officer> · \<date and time> | DRAFT |
| src/commands/reports.ts:149 | That report is no longer recorded. | DRAFT |

### Vault buttons (vault channel, officers)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:53 | Button: Approve | seen in check, not yet approved |
| src/commands/images.ts:53 | Button: Reject | seen in check, not yet approved |
| src/commands/images.ts:178 | (the vault post, after Approve) Screenshot of **\<item>** · approved by @\<officer> · \<date and time> | seen in check, not yet approved |
| src/commands/images.ts:185 | Rejected the screenshot of **\<item>** and deleted it from the vault. | seen in check, not yet approved |
| src/commands/images.ts:183 | Rejected, but I couldn't delete the vault message (HTTP \<code>); you can delete it by hand. | DRAFT |
| src/commands/images.ts:174 | That screenshot was already \<approved / rejected>. | DRAFT |
| src/commands/images.ts:173 | That screenshot is no longer recorded. | DRAFT |

### Remove-member preview (officers)

| Where | Text | Status |
|---|---|---|
| src/commands/members.ts:34 | Button: Confirm | DRAFT |
| src/commands/members.ts:34 | Button: Cancel | DRAFT |
| src/commands/members.ts:49 | Done: removed **\<member name>** and \<n> character(s): **\<character>** (\<class>, level \<level>), …. Their skills are kept: `/character add` with the same name restores a character. (text at lines 39–40; "(no characters)" in place of the list when there are none) | DRAFT |
| src/commands/members.ts:46 | Cancelled. Nothing was changed. | DRAFT |
| src/commands/members.ts:48 | @\<member> has never used GuildCraft in this server, so there was nothing to remove. | DRAFT |

### Departure notice buttons (review channel, officers)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:160 | Button: Remove characters | DRAFT |
| src/departures.ts:160 | Button: Keep | DRAFT |
| src/commands/members.ts:70 | (the notice, after Remove) @\<officer> removed **\<member name>** and \<n> character(s): …. Their skills are kept: `/character add` with the same name restores a character. (text at lines 39–40) | DRAFT |
| src/commands/members.ts:64 | (the notice, after Keep) @\<officer> kept **\<member name>**'s characters. They stay hidden while \<member name> is away and show again when they come back. | DRAFT |
| src/commands/members.ts:60 | **\<member name>** is back and active again, so nothing was changed. (Checked by @\<officer>.) | DRAFT |
| src/commands/members.ts:58 | This member is no longer recorded. Nothing was changed. | DRAFT |
| src/commands/members.ts:56 | Sorry, that button has expired. | DRAFT |

## Cards and posts

### Report card (review channel, from /craft report and Report a problem)

| Where | Text | Status |
|---|---|---|
| src/commands/reports.ts:39 | Title: Report: \<item> (or: Report: unknown item) | seen in check, not yet approved |
| src/commands/reports.ts:40 | **Issue:** \<issue> | seen in check, not yet approved |
| src/commands/reports.ts:40 | **From:** @\<member> · \<date and time> | seen in check, not yet approved |
| src/commands/reports.ts:40 | **Details:** \<details> (only when given) | seen in check, not yet approved |
| src/commands/reports.ts:41 | Footer: Report #\<number> · fix the data with /recipe override or /recipe source, then mark it fixed | seen in check, not yet approved |

### Departure notice (review channel, nightly)

| Where | Text | Status |
|---|---|---|
| src/departures.ts:146 | Title: \<member name> left the server | DRAFT |
| src/departures.ts:143 | (name when unknown) A member | DRAFT |
| src/departures.ts:149 | **Characters**<br>**\<character>** (\<class>, level \<level>), one per line | DRAFT |
| src/departures.ts:144 | No characters registered. | DRAFT |
| src/departures.ts:151 | While they are away their characters are hidden from `/craft find`, `/roster` and the roster board. If they come back and use GuildCraft, they show again. | DRAFT |
| src/departures.ts:152 | **Remove** removes the characters (their skills are kept; `/character add` with the same name restores one). **Keep** leaves them as they are. Officers only. | DRAFT |

### Usage warning (review channel)

| Where | Text | Status |
|---|---|---|
| src/usage.ts:106 | Free-tier usage: **\<limit name>** was \<amount> of \<limit> (\<percent>) on \<day>, at or over GuildCraft's 10% target. Nothing stops until 100%; `/guildcraft status` shows every figure. | DRAFT |
| src/usage.ts:107 | Free-tier usage: **\<limit name>** is back under the 10% target: \<amount> of \<limit> (\<percent>) on \<day>. | DRAFT |

### Vault screenshot post (vault channel, from /item image)

| Where | Text | Status |
|---|---|---|
| src/commands/images.ts:128 | Screenshot of **\<item>** from @\<member> · waiting for an officer (with the image, and Approve and Reject) | seen in check, not yet approved |

### Roster board (forum channel)

| Where | Text | Status |
|---|---|---|
| src/board/refresh.ts:172 | Post name: \<tradeskill> | DRAFT |
| src/board/render.ts:49 | \<n> character(s) (\<n> member(s)), ranked by skill level. (count at line 31) | DRAFT |
| src/board/render.ts:45 | **\<rank>.** **\<character>** · \<member name> · \<skill level> · *stale* | DRAFT |
| src/board/render.ts:50 | No one in the guild has recorded \<tradeskill> yet. Use `/craft set` to get listed. | DRAFT |
| src/board/render.ts:51 | Footer: stale = not updated in \<number> days | DRAFT |

### Roster board index (pinned post)

| Where | Text | Status |
|---|---|---|
| src/board/render.ts:123 | Post name: Index: how to get listed | DRAFT |
| src/board/render.ts:118 | Title: Crafting roster: index | DRAFT |
| src/board/render.ts:113 | #\<tradeskill post> · \<n> character(s) — or, before the post exists: \<tradeskill> *(post coming)* · \<n> character(s) | DRAFT |
| src/board/render.ts:96 | **How to get listed** | DRAFT |
| src/board/render.ts:97 | 1. `/character add` your character. | DRAFT |
| src/board/render.ts:98 | 2. `/craft set` a tradeskill level, or `/craft update` for several at once. | DRAFT |
| src/board/render.ts:99 | 3. Your tradeskill posts update within about a minute. | DRAFT |
| src/board/render.ts:102 | **Also** | DRAFT |
| src/board/render.ts:103 | `/craft find` who can make an item · `/craft know` mark a recipe you know · `/roster recipes` who knows the rare ones | DRAFT |
| src/board/render.ts:104 | `/craft report` report wrong data · `/item image` send an item screenshot · `/craft help` every command | DRAFT |
| src/board/render.ts:116 | Last refresh: \<date and time> (\<time ago>) | DRAFT |

## Help and welcome

### /craft help reply

Each command line shows as `` `/command` what it does ``. A line whose command is not built yet ends with *(coming soon)* (src/commands/help.ts:7); today that is only `/recipe add`.

| Where | Text | Status |
|---|---|---|
| src/commands/help.ts:46 | ## GuildCraft — every command | DRAFT |
| src/commands/help.ts:15 | **Your characters** | DRAFT |
| src/commands/help.ts:16 | `/character add` register a character (name, class, level, main) | DRAFT |
| src/commands/help.ts:17 | `/character edit` rename it or change class, level or main | DRAFT |
| src/commands/help.ts:18 | `/character remove` remove a character (its skills are kept if you add it back) | DRAFT |
| src/commands/help.ts:19 | **Your skills and recipes** | DRAFT |
| src/commands/help.ts:20 | `/craft set` set one tradeskill level | DRAFT |
| src/commands/help.ts:21 | `/craft update` press Enter, pick up to 5 tradeskills, then type their levels | DRAFT |
| src/commands/help.ts:22 | `/craft me` your skills, levels and last update (private) | DRAFT |
| src/commands/help.ts:23 | `/craft know` · `/craft forget` mark a recipe as known (or press **I know this recipe** on `/craft find`), or undo it | DRAFT |
| src/commands/help.ts:24 | **Find a crafter** | DRAFT |
| src/commands/help.ts:25 | `/craft find` who can make an item, with its recipe and stats | DRAFT |
| src/commands/help.ts:26 | `/roster skill` everyone with a tradeskill, ranked | DRAFT |
| src/commands/help.ts:27 | `/roster member` one member's characters and skills | DRAFT |
| src/commands/help.ts:28 | `/roster top` the top 3 in each tradeskill | DRAFT |
| src/commands/help.ts:29 | `/roster recipes` who knows the rare reputation and discovery recipes | DRAFT |
| src/commands/help.ts:30 | **Items and data** | DRAFT |
| src/commands/help.ts:31 | `/item image` send a screenshot of an item window; it shows under **Stat image** once an officer approves it | DRAFT |
| src/commands/help.ts:32 | `/craft report` report a wrong trivial, component or source, or a missing recipe (or press **Report a problem**) | DRAFT |
| src/commands/help.ts:33 | `/recipe add` record a recipe the data is missing (officer-approved) *(coming soon)* | DRAFT |
| src/commands/help.ts:34 | **Officers and admins** | DRAFT |
| src/commands/help.ts:35 | `/guildcraft setup` set the member and officer roles, the roster board forum, and the review and vault channels | DRAFT |
| src/commands/help.ts:36 | `/guildcraft status` data version, last import, the roster board, departures, the backup and free-tier usage | DRAFT |
| src/commands/help.ts:37 | `/recipe source` · `/recipe override` set how a recipe is obtained; correct its trivial or components (this server only) | DRAFT |
| src/commands/help.ts:38 | `/guildcraft remove-member` remove a departed member | DRAFT |
| src/commands/help.ts:39 | `/guildcraft rebuild-board` recreate the roster board posts in A→Z order | DRAFT |
| src/commands/help.ts:40 | `/craft help` this guide | DRAFT |
| src/commands/help.ts:9 | Questions or problems: send a Discord message to **Joegandomi**, who runs GuildCraft. (new in order 10; shown at the end of help, line 51, and of the welcome) | DRAFT |
| src/commands/help.ts:52 | -# draft — more commands arrive over the next builds · Item data: Monsters and Memories Wiki (CC BY-SA 4.0) (the "draft — …" part is line 6) | DRAFT |

### Welcome (shown once, privately, with a new member's first reply)

| Where | Text | Status |
|---|---|---|
| src/commands/welcome.ts:8 | Title: Welcome to GuildCraft | DRAFT |
| src/commands/welcome.ts:10 | Three steps to get on the guild roster: | DRAFT |
| src/commands/welcome.ts:11 | **1.** `/character add`: register your character. Your first one becomes your main. | DRAFT |
| src/commands/welcome.ts:12 | **2.** `/craft update`: press Enter, pick up to 5 tradeskills, then type their levels. Or press the **Update skills** button under your `/craft me`, `/craft set` or `/character add` reply. (`/craft set` sets one skill.) | DRAFT |
| src/commands/welcome.ts:13 | **3.** `/craft find`: look up who in the guild can make an item. (ends with " *(coming soon: not available yet)*" only if /craft find were not built; it is built) | DRAFT |
| src/commands/welcome.ts:15 | *You see this message once. `/craft help` lists every command. (draft)* | DRAFT |
| src/commands/welcome.ts:16 | The contact line (src/commands/help.ts:9), naming Joegandomi | DRAFT |

## Errors shared by many commands

| Where | Text | Status |
|---|---|---|
| src/respond.ts:16 | Sorry, something went wrong on our side and GuildCraft could not answer. Please try again in a moment. | DRAFT |
| src/interactions.ts:23 | Sorry, that command isn't available yet. Type `/craft help` to see what's coming. | DRAFT |
| src/interactions.ts:24 | Sorry, GuildCraft works inside a server, not in direct messages. | DRAFT |
| src/interactions.ts:25 | Only server admins (Administrator or Manage Server) can change GuildCraft settings. | DRAFT |
| src/interactions.ts:26 | Sorry, that menu has expired. Run the command again. | DRAFT |
| src/interactions.ts:27 | GuildCraft in this server is for members with the @\<role> role. Ask an officer if you should have it. | DRAFT |
| src/commands/members.ts:13 | Only officers can do that. | DRAFT |
| src/commands/character.ts:37 | Only officers can change another member's characters. | DRAFT |
| src/commands/character.ts:38 | **\<name>** is already taken in this guild. Character names are unique, whatever their capitals. | DRAFT |
| src/commands/character.ts:41 | You have no character named **\<name>**. — or, for an officer naming a member: @\<member> has no character named **\<name>**. | DRAFT |
| src/commands/character.ts:45 | You have no characters yet. Add one with `/character add`. — or: @\<member> has no characters yet. | DRAFT |
| src/commands/skills.ts:36 | I don't know a tradeskill called **\<typed text>**. Pick one from the list as you type. (also src/commands/recipes.ts:333, src/commands/roster.ts:108) | DRAFT |
| src/commands/reports.ts:78 | I don't know an item called **\<typed text>**. Pick one from the list as you type. (also src/commands/images.ts:100) | DRAFT |
| src/commands/recipes.ts:24 | No recipe found for **\<typed text>**. Pick a recipe from the list as you type. (/craft know, /craft forget, /recipe) | DRAFT |
| src/commands/recipes.ts:28 | **\<item>** has \<n> recipes (\<tradeskill>, trivial \<number>; \<tradeskill>, trivial \<number>). Pick the one you mean from the list as you type. | DRAFT |
| src/commands/find.ts:303 | That item no longer has a recipe. Run `/craft find` again. (also src/commands/recipes.ts:98) | DRAFT |
| src/commands/roster.ts:121 | That tradeskill is no longer in the list. Run `/roster skill` again. (also lines 129 and 208) | DRAFT |

## Counts

| Group | Strings |
|---|---|
| Commands | 271 |
| Buttons and menus | 57 |
| Cards and posts | 30 |
| Help and welcome | 36 |
| Errors shared by many commands | 17 |
| **Total** | **411** |

Of these, 16 are "seen in check, not yet approved"; the rest are DRAFT.
