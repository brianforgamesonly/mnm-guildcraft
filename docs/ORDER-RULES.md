# Order rules (mnm-guildcraft)

**Ported 2026-10-19 from the owner's Sunshine State Auctions rules. Rules that applied only to that project were left out.**

These rules bind alongside [STANDING-report-contract.md](STANDING-report-contract.md). Every order cites this file at a SHA and adds only new rules. A rule an order adds is committed here in the same pull request, under a heading that names the order.

## Rules

⚠ If neither of us can say what is going on and what we are trying to do, we do nothing. Never ask permission for agreed work ("Why should I have to say go?" — the owner).

Treat the clock as authoritative over any date an order states.

### Evidence and numbers

- Fix causes, never symptoms. Every report ends ROOT or BANDAGE. ROOT means the class of defect is now impossible because of a derived guard: one whose population comes from the live schema, the data or the code, never from a hand-maintained list.
- Every factual claim comes from a tool call in the same turn, or the sentence says "unverified". Adjectives are claims too ("external", "upstream", "flaky", "impossible").
- Numbers carry their predicate: X of Y, measured how, and when. Establish Y before X becomes a headline. An aggregate across runs is not a statement about any one run.
- Cite code as `file:line` at a SHA, using plain paths and never editor URLs. A claim about code is read on `origin/main` after `git fetch`.
- Prose is not state. Run the predicate; do not just read it. Read a parameter's meaning from the function itself, never from its name.
- Name the operand and check it before building on it. A mechanism an order proposes holds "unless the rows show otherwise". Verify before building, and if you refuse on evidence, say so.
- A literal search that fails is not proof of absence. Before accepting an empty result, state what you assumed about the thing you were looking for: its type, its format, and where it lives.
- "Residual", "acceptable remainder", "unclosable", "external", "blocked" and "impossible" are never accepted dispositions without primary evidence. In the owner's earlier project, all nine such claims that were examined turned out to be wrong.
- A control whose result is implausible is presumed broken.
- Three traps produce a convincing false zero in an AFTER measurement: measuring before the write landed, measuring the wrong population, and measuring a cache.
- Verify on the artefact the member sees, meaning the Discord reply or post, not only on the query behind it.

### Data

- Dry-run before any change to live data (the production D1 database or live Discord posts): print the affected rows, and keep a rollback.
- Never add a column for a value the table already holds.
- One decision has one decider, and every surface reads it. The "who can make this" tiering lives in one place.
- Imported data is never invented. A value the source does not hold is stored as unknown (NULL), never guessed.
- Rows that disappear upstream are deactivated, never deleted. Members' own data is never deleted automatically.
- A list of things the game has (tradeskills, items, recipes) is derived from data, never typed by hand.

### Runs and schedules

- An order never waits on a scheduled run. Verification invokes the job (workflow_dispatch or a direct call).
- Nothing is dispatched whose result cannot be read back.
- A new schedule, or a new workflow that runs on push or pull_request, is named in the report with its expected usage.

### Spend

- The target is $0 per month. Any step that would need a payment method, a paid plan or a credit card stops and goes to the owner, with the number attached.
- Every report carries its bill: GitHub Actions minutes, plus Cloudflare usage against each free-tier limit where it was measured.
- By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge.

### Credentials and accounts

- The owner creates and pastes every credential themselves. Neither session handles secret values.
- Never print a secret or a file holding one. Not `cat` of an env file, `echo $TOKEN`, `printenv`, or logging a config object. That includes "just the prefix". To check a secret, compare its length or shape, or check whether it is set.
- Credentials live outside every checkout. This project keeps them in GitHub Actions secrets. The local machine needs none for normal work.
- This project's GitHub, Cloudflare and Discord identities are the owner's gaming accounts. They never mix with the owner's other projects' accounts or credentials. A command that would act as the wrong account stops.
- If a secret reaches a transcript, it is compromised. Say so plainly so the owner can rotate it.

### Commands and permissions

- Run every command through the Bash tool, never PowerShell. One command per call, unchained. No `VAR=x cmd`. No bare `git stash`.
- Python and TypeScript are written with the file tools. Heredocs carry only SQL or shell.
- Code runs from a fresh worktree on `origin/main` under `.claude/worktrees/`, never from the root checkout, which is the owner's. Never write loose files into `C:\Users\bmatt\Projects\` itself.
- A helper agent carries the order's rules, and the session answers for what the helper does.
- Quote a refusal verbatim. A second refusal of the same command stops that track and names the exact command. Permission denials are diagnosed, never shifted to the owner.
- An item that belongs to the session (a route to choose, a diagnosis to make) is never handed to the owner. Only spend, credentials, copy and product decisions are the owner's.
- Grep before opening a file, and read by line range (token discipline).

### Product

- Member-facing copy (help text, welcome messages, announcements) is drafted by the session and approved by the owner before launch.
- The PRD (`docs/PRD.md`) is the specification. A departure from it is named in the report, with the reason.
- Attribution: item data replies credit the Monsters and Memories Wiki (CC BY-SA 4.0), and the README credits mnm-tools (MIT).
- When the owner asks to understand something, lead with a plain-words explanation before the numbers.

## Added by work order 2 (characters, skills and first use)

- A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.

## Added by work order 3 (find, roster, faster, clearer)

- Measure before fixing a performance complaint. Every interaction logs one structured timing line (src/telemetry.ts), and Workers Logs stays within the free 200,000 events a day.
- An autocomplete costs at most one D1 statement per keystroke and never writes. Game-data autocomplete (tradeskills, classes, items) is public game data and is not role-gated. A cache of import-only lists refreshes within one request after a completed import.
- Search and roster replies are private by default, with Post to channel. The default is the single setting `SEARCH_REPLIES_PRIVATE` (src/commands/share.ts) while the owner's question A6 stands.
- `.claude/hooks/check-bash.mjs` blocks the forbidden Bash forms (chaining, `VAR=x cmd`, writing code files by shell, in-place sed/perl edits, `node -e`/`python -c` file writes). It is a BANDAGE, and these rules still bind where it cannot see. A hook added to `.claude/settings.json` takes effect from the next session that starts in the root checkout.

## Added by work order 4 (roster timeout and speed)

- Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so (the owner, 2026-10-19: Corroded and Rusty items are not the same).

## Added by work order 5 (board, status, warm)

- The session never creates channels or posts on the owner's server. Live board posts start from the owner's own `/guildcraft setup board:`; before that, board code is verified in workerd against a mocked Discord API, and the dry run is a read-only render from live D1 (`.github/workflows/board.yml`, action `render`), with `delete` as the rollback.
- A Worker invocation that does board work (after a command, or a cron run) stops at about 40 external calls (D1 and Discord together), below the Free plan's 50 subrequests; work beyond that stays dirty for the next sweep (`src/board/api.ts` BOARD_CALL_CAP).
- This repository is public, so Actions logs are public: a log that would show guild data (display names, character names) prints pseudonyms instead.

## Added by work order 6 (alphabetical board and first keystroke)

- The bot never deletes a post or message that a member wrote, or that has member replies, without the owner's explicit approval for that action.

## Added by work order 7 (logs, hook, lag, departures)

- An order that permits something an earlier order or rule forbade says so explicitly, naming the earlier rule. Without that, the earlier rule stands, and the session stops on the conflict.
- Order 7's one explicit override of order 5's "The session never creates channels or posts on the owner's server": the bot's departure notices, posted in the review channel the owner sets with `/guildcraft setup review:`. Everything else in that rule stands.
- Workers Logs is not a complete record (order 7, ITEM 1.1: 3 of 39 invocations missing on 2026-10-19/20, against Cloudflare's own invocation analytics). A logs-based conclusion states the completeness check's result for its window (`.github/workflows/timings.yml`).
- `.claude/hooks/check-bash.mjs` cannot see a leading `cd <the current directory> &&`: Claude Code rewrites it into the call's working directory before the hook runs (order 7, ITEM 1.2). The rule against chaining still binds there.

## Order 8

- Every alarm states who is notified, how often, and what counts as its state. It re-notifies only when the state changes, at most once a day. (The nightly jobs' alarms are stated in each workflow's header; the mechanism is `scripts/ci/alarm.ts`, and the usage warning is under order 11.)
- (Order 8's override for usage warnings in the review channel is replaced by order 11's override 1, below.)
- Order 8's three permitted remote writes, an explicit exception to the rule against writing to the remote database: `backup_status` (`.github/workflows/backup.yml`) and `usage_daily` (`.github/workflows/usage.yml`), each dry-run first by dispatch. The usage-alert state is not a third table: it is derived from `usage_daily` and the limits (no column for a value already held), and the posted lines are recorded as `usage.alert` audit rows by the Worker, like departure notices.
- Workers Logs drops are expected: a missing log event whose invocation Cloudflare's analytics counts as a success is a platform drop, counted, never a failure (`scripts/bench/logs-check.mjs` `explainGaps`).

## Order 9

- Every member-facing string added in an order is listed in the FINAL REPORT with file:line, marked DRAFT, until the owner approves it. No guild-facing string uses the owner's real name; the operator is 'Joegandomi'.
- Order 9's explicit override of order 5's "The session never creates channels or posts on the owner's server", extending orders 7 and 8: the Worker's report cards in the review channel and screenshot re-posts (with Approve/Reject) in the vault channel the owner sets, each in response to a member's or officer's command or button, and the edits and deletions of those same bot messages when an officer acts. The session itself posts nothing live and creates no channels. Everything else in that rule stands.
- Order 9's override of order 8's "a refused import writes nothing": a refused import writes a `data_import` row with status `refused` and its reason, so the import alarm can compare one refusal with the next. The statuses are held once, in `src/import-status.ts`; every reader picks rows by a positive rule from it.
- A button on a posted (public) message answers the presser with a new private message (type 4, private), never UPDATE_MESSAGE (type 7): one member's press never changes a public post. Only officer cards and vault messages are edited in place.

## Order 10

- Order 10's explicit override of the rule against remote writes beyond the named ones (orders 5–9): one production D1 database and one production Worker in the same Cloudflare account, with the production Worker's secrets set from Actions secrets; the production database's migrations and every write the existing jobs and the Worker make to it (imports, cron sweeps, departures, `backup_status`, `usage_daily`); per-guild exports to `guild-exports/` in the private backup repository; the production app's interactions endpoint URL and icon (PATCH `/applications/@me`); global command registration for the production app. No posts on any server, and no change to the Dev app. Order 5's "no posts on the owner's server" rule and its extensions (orders 7–9) stand, for both apps.
- Order 10's override 2: test data stays in dev. Production starts with reference data only, from its own import; no guild data is copied across.
- Order 10's override 3 of order 8's backup target: the nightly backup covers production (primary) and dev, as separate files with their own manifests and restore tests, in the same private repository.
- Guild-facing documents (`docs/SELF-HOSTING.md`, `docs/COPY.md`, `docs/LAUNCH-GUIDE.md`) never use the owner's real name; the operator is "Joegandomi", and the code is "the GuildCraft repository (ask Joegandomi for the link)".

## Order 11

- Operator-only information (copy markers, token and job internals, platform usage) appears only in the dev copy, or in the operator's email. Never in a guild's channels or a production reply. (The one decider is `isDevCopy` in `src/env.ts`: any `GUILDCRAFT_COPY` but `dev`, unset included, is production.)
- Order 11's override 1, replacing order 8's usage warnings in the review channel: the production Worker posts no usage warning in any guild's channel. The usage job carries it to the operator instead: its production run fails once when a metric's state changes upward (yesterday at or over 10% of its Free limit, the day before under), so GitHub mails the owner; staying over passes, and dropping back under is reported in the job summary and passes. Its state is derived from `usage_daily`'s earlier days (never from `usage.alert` rows), separate from the job's stale/GraphQL alarm, and judged at most once a day per metric (`scripts/usage/level-alarm.ts`). The dev run never fails on it. The dev copy may keep posting usage warnings in the test server's review channel (`src/usage.ts`), the operator's own server.

## Order 12

- Every FINAL lists each GitHub Actions run that failed during the order, with its id and reason; each one emails the owner. Don't dispatch a run you expect to fail. Test locally first, and dispatch only to confirm.
  Its scope: every run that failed between RECEIVED and FINAL, scheduled runs included. Each is marked "mine" or "scheduled"; a designed alarm (for example the usage job's level alarm) is marked "alarm, intended", with its reason.

## Order 13

- Order 13's explicit override 1 of the earlier orders' import scope (recipes, items, tradeskills and classes only): the import also keeps the source's mobs (table `mob`) and items' from, wikiZones, soldBy and categories (`item.origin_json`). The nodes section stays discarded.
- Order 13's explicit override 3 of "Never add a column for a value the table already holds": generated columns read from `item.stats_json` (`ac`, `dmg`, `delay`, `ratio`, `skill`, `handed`), and three derived columns rewritten on every import (`item.class_mask`, `item.slot_mask`, `item.source_mask`). `game_class.bit` is a named departure (a class's bit, assigned once, never reused).
- D1 Free allows 100,000 rows written a day, account-wide, index writes included. One import run writes at most `WRITE_CEILING` (40,000) rows, counted from D1's own rows_written as it goes (scripts/import/core.ts). It stops between whole statement groups, records status `partial`, and the next run resumes. The first import after a schema change is measured on a local database first (`npm run bench:import-writes`).
- Whenever the source holds a value that a /gear find choice list lacks, the import warns: a new slot, weapon type, stat or resist (src/gear/vocab.ts), or a change in the class list. Commands are then re-registered. The warning never fails the run.

## Order 14

- Order 14's explicit override 1 of the earlier orders' "GuildCraft never contacts the wiki": the reachability probe's two API requests (scripts/probe/wiki.ts) from this machine, a GitHub-hosted runner and Cloudflare's network, through the dispatch-only `.github/workflows/wiki-probe.yml`; and one temporary Worker, `guildcraft-wiki-probe` (scripts/probe/wrangler.jsonc: no bindings, routes or cron), deployed, called once and deleted in the same run. Nothing else contacts the wiki.
- Order 14's explicit override 2 of the rule against production changes beyond the named ones: deploying both copies for the `/craft help` copy fix only.
- A polite guest: at most 2 requests per path, a named User-Agent that does not name Brian, one retry after 10 s on a network error only, never on a 403 or 429. Never disguise the origin: no browser User-Agents, proxies, IP rotation or retry-until-it-works. A block is an answer.

## Order 15

- If the auto-mode check refuses a local `git fetch`, the base SHA is read from GitHub instead.
- A dispatch is made only to confirm a fix and only when it is expected to pass; a run expected to fail is never dispatched. Every failed run is listed in the report with its reason.
- The usage workflow is never dispatched to confirm its level alarm, not even as a dry run: a dry run writes nothing, so the next scheduled run judges the same days again.
- When a check fails on a real gap, the deliverable is the diagnosis and the fix of the gap, never a change to the check. A short read from Workers Logs is named per request (`scripts/bench/logs-check.mjs` `shortRequests`), never only totalled.

## Order 16

- Order 16's explicit override 1 of order 5's "The session never creates channels or posts on the owner's server" (as extended by orders 7–9): the Worker's posts in the request channel the owner sets with `/guildcraft setup requests:`, the private threads it creates there, adding members to them, and its own messages, edits and renames in them. It also extends order 9's "Only officer cards and vault messages are edited in place" to the bot's own messages in request threads. The session itself posts nothing live; tests use a mocked Discord.
- Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party.
- A mention that pings nobody is not carried in the message's `mentions` array, in content or in an embed, so a reader whose app has not loaded that member sees `<@id>` or "@invalid-user" (discord-api-docs issues #1479, #2126, Discord staff). The name saved at the member's last command is kept beside every such mention.

## Order 17

- Order 17's explicit override 1 of the import scope (orders 1 and 13: wiki.json only): the import also reads mnm-tools' `mnmdb/maps.json` (and links its map images), MnM Atlas's `data/maps.json` (map ids and titles only), and mo-betta-quests' `zones.json` and `npcs.json`, each pinned to the commit that last changed it, with that commit's date from GitHub (scripts/import/zones.ts `ZONE_FILES`). It warns, never fails, when a mnm-tools or Mo Betta file has not changed for 30 days; MnM Atlas's registry is exempt.
- Zone names match only after two normalisations, case and curly to straight apostrophes (`zoneKey`). Every other difference is a row in the derived mapping (`zone_name`, zone_key NULL) and a warning, never a guess. Mo Betta's NPC zone text is split only on ", " and " or ".
- Order 17's explicit override 2: a map image appears on a zone card only if its wiki file page states its licence and its author or source. The check's record is `scripts/import/map-licences.ts`; it is read from archived copies, because order 14's "Nothing else contacts the wiki" stands.
- Order 17's explicit override 3: MnM Atlas's whole-zone images (`assets/cards/<map id>.jpg`) are shown only while the repository variable `ATLAS_ZONE_IMAGES` is `on`, set by the owner once the atlas's maker agrees. It ships off.
- A list sort uses one named key, never a combined score (the owner, order 13): zone drops sort by AC, then name.

## Order 17b

- Order 17b's explicit override 1 of order 17's override 3: MnM Atlas's maker granted permission to show its zone images, credited, on 2026-10-21 (reported by the owner). `ATLAS_ZONE_IMAGES` is `on`.
- Order 17b's explicit override 2: the zone card no longer lists drops (order 17's "Notable drops" and More drops); Gear here finds a zone's gear.
- Order 17b's explicit override 3 of order 14's "Nothing else contacts the wiki", for monstersandmemories.wiki and storiesofmnm.com only: `scripts/zone/sites.ts`, run by hand when zones change (never on a schedule), makes at most one request per zone per site to verify each link (status and final address after redirects), plus one read of Stories of MnM's `/zones/` index, with order 14's named User-Agent and polite-guest rules. Miraheze is never contacted; its links are built from the import as before.
- A link to a page a site does not have is never offered: no fallback to a site's index or to MnM Atlas's root (which opens its world map). The card's MnM Atlas addresses name a registry id or nothing (`test/worker/zone.test.ts`, the order 17b regression test, applies the atlas's own address rule).
- The other sites' addresses live in one derived file, `src/zone/sites.json`; CI fails when a link it held on main disappears for a zone it still holds (`scripts/ci/zone-sites.test.ts`).
- A link check is proven in a real browser on the address the member is given, never only by comparing strings in a test.

## Order 18

- An autocomplete list is chosen by command and option (`src/commands/autocomplete.ts` LISTS), never by the option's name alone; every autocomplete option in the definitions has a list and every list names one (test/worker/next-commands.test.ts).
- A button on a message the bot already sent keeps working after a rename: every custom_id prefix the code has ever sent is still handled.
- A button that answers with a modal is never deferred (`src/interactions.ts` OPENS_MODAL).
- Order 18's explicit override 1 of the earlier orders' and the PRD's command names: the commands are `/me`, `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`, `/officer` and `/guildcraft` (docs/PRD.md, "Work order 18" table). The old names are not registered and answer "not available".
- Order 18's explicit override 2: the board index post and `/help` are rewritten for the new names; the bot's own posts are edited in place, with no pings.
- Every command a reply, a page of `/help`, the welcome or the board index names in backticks is a registered command (test/worker/interactions.test.ts); `/help`'s pages list every registered command, each on one page, from its own description.
- New commands are registered from the reviewed branch before its merge deploys the removal of the old entry points, so no registered name is ever without a route.

## Order 19

- Order 19's explicit override 2 of order 5's "The session never creates channels or posts on the owner's server" (as extended by orders 7–9 and 16): the bot creates its own channels (a GuildCraft category and the board, review, vault and request channels, with their permission overwrites), sets a forum's default sort order, and adds the officer role's overwrite to the private channels it created, only when an admin presses **Create GuildCraft channels** in `/guildcraft setup` (src/commands/channels.ts). The session itself creates nothing; tests use a mocked Discord.
- Order 19's explicit override 3: the install permissions add Manage Channels and Manage Roles (361045806096), still derived from src/permissions.ts ROUTES. Every bit a created channel's overwrites allow or deny is one the bot holds (Create Guild Channel: "only permissions your bot has in the guild can be allowed/denied"), and every channel that denies @everyone something allows the bot's own member what its routes there need (`channelBits`).
- A handler that calls Discord before a board run in the same invocation passes its count on (`Effects.discordCalls`), so the board's 40-call cap covers the whole invocation.
- Order 19's override 1 (Workers Logs omissions as platform omissions) was not applied: ITEM 1 stopped on a contradiction, named in the order's FINAL REPORT. Order 15's rule stands.

## Order 20

- Order 20's explicit override 1 of orders 7, 8, 15 and 19's alarm in `.github/workflows/timings.yml`: timings never fails on Cloudflare log or analytics completeness. The two Cloudflare sources are estimates: analytics is sampled ("an estimate derived from the sampled value"), and Workers Logs' per-request event counts overstate (10 invocation events for one invocation, order 19). A gap between two estimates cannot tell real loss from noise. Its figures (completeness, the drop-rate bound, the speed per path) stay in its job summary for information, and it fails only when it cannot run (an API error). Order 7's "A logs-based conclusion states the completeness check's result for its window" stands.
- Order 20's explicit override 2 of order 8's "It re-notifies only when the state changes, at most once a day", for the health alarm only (`.github/workflows/health.yml`, `scripts/health/judge.ts`): it fails on every day a rule is breached, judged on the bot's own D1 records for the previous UTC day per copy. A breach is genuine missed work, so a lasting problem never goes quiet. It keeps no state between runs.
- An alarm on missed work rests on exact records the bot writes itself (`sweep_run`, `data_import`, `backup_status`, `usage_daily`), never on a platform's sampled or estimated counts. Its expected population is derived from config (the cron expression in `wrangler.jsonc`), never typed by hand.
- `sweep_run` (migrations/0016) is the heartbeat: one row per cron invocation, written before the sweep's work, with `finished_at` set as its last step (src/heartbeat.ts).

## Order 21

- A check that matches records to expected events states its matching rule. A record that matches no expected event fails the check, or is reported under a named exemption. It is never a silent pass.
- Order 21's explicit override 1 of order 20's report-only "rows on no expected slot" (scripts/health/judge.ts): such a row fails the health check's "check broken" rule (the cause is the check's matching, the cron configuration, or a manual trigger; never reported as a missed sweep), except inside a deploy window, where it is reported. While it fails, "missed sweeps" fails only on a breach that stands with each unmatched row counted toward the slot before it (genuine missed work, whatever broke the match). On 2026-10-22 that report-only line was the only sign the check was broken while it sent a false "missed sweeps" alarm. Order 20's other alarm rules stand.
- The health check's matching rule: a heartbeat row belongs to the expected slot whose minute holds its scheduledTime (`slotOf`). Cloudflare's scheduledTime is not aligned to the minute: each Worker's rows carry a constant offset inside it (production +8.996 s, dev +37.257 s, order 21 ITEM 1).

## Order 22

- Order 22's explicit override 1 of order 4's "content: '' breaks a reply": for the rollback of the roster board's first-message line only, a board message edit may send content "" (`src/board/render.ts` LineMode `'clear'`). The message keeps its embeds. Interaction replies never send it.
- A Discord message edit keeps every field it does not send. Removing something a message carries therefore takes an edit that sends the field empty: reverting the code is never enough on its own.

## Order 23

- A zone button is offered only for a zone the message's text shows, and only when the derived mapping (`zone_name`) maps the name to an active zone (src/zone/buttons.ts); an unmatched name stays text. One button per zone key, since Discord refuses two components with one custom_id in a message.
- The list of custom_id prefixes sent before order 18 (`SENT_BEFORE`, test/worker/next-commands.test.ts) is frozen history. A new prefix gets its own routing test beside the feature's tests.

## Order 24

- Order 24's explicit override 4 of order 19's override 2 (as the order states it): the bot may also create one guild custom emoji per server (Create Expressions), set `default_reaction_emoji` on the forums GuildCraft uses, and create and maintain the factions board's posts.
- An NPC's wiki fields are shown under the wiki's own labels only: `factions` is "Reputation Lost", `opposing_factions` is "Reputation Gained" (scripts/import/zones.ts `FactionKind`). Faction names are trimmed, never merged or re-spelled; a name that disappears upstream is deactivated.
- What a faction's post shows changes only through the import, which sets that faction's `changed_at` in the same statement group as the change (scripts/import/core.ts `zoneGroups`); the factions board re-renders a post rendered before it. The import never writes a guild's rows.
- One invocation's 40 calls: the tradeskill boards first, then the factions boards down to `FACTIONS_FLOOR` (src/board/refresh.ts), which the request sweep and the dev usage warning run on after them.
- A local bench reads this checkout's own config and state (scripts/import/db.ts `localDb`), never the working directory's.
- Order 24, PR B: Create GuildCraft channels' layout is src/commands/channels.ts `LAYOUT` (two forums, two text channels; no vault). A forum's default reaction is set only where it has none, so a reaction a server chose stays. The emoji Worker module is derived from `assets/emoji/guildcraft.png` (`scripts/emoji/build.ts --check` in CI). Install permissions: 9157138828304.
- Order 24, PR C (the owner, 2026-10-27, resolving the ITEM 5 contradiction with option B): member screenshots are turned off, a named departure from PRD FR-6 layer 2. Nothing new is submitted and no new card offers Stat image; `img:`, `ima:` and `imr:` stay handled for messages already sent (order 18). The vault is neither created nor set by setup. Install permissions: 9157138795536 (Attach Files dropped with the upload route).

## Order 25

- Order 25's explicit override 1 of order 17's override 1 ("the import also reads mnm-tools' `mnmdb/maps.json` …, MnM Atlas's `data/maps.json` …, and mo-betta-quests' `zones.json` and `npcs.json`, each pinned to the commit that last changed it"): the import also reads mo-betta-quests' `quests.json`, pinned the same way (scripts/import/zones.ts `ZONE_FILES`), for the faction posts' quest lines only: reward lines that begin with "Faction" (scripts/import/quests.ts).
- Order 25's explicit override 2 of order 24's "Faction names are trimmed, never merged or re-spelled" and order 4's "Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so": the owner said so (2026-10-27, corrected 18:18 ET) for exactly eight groups of faction names, held in one file, `src/faction-aliases.ts`, and applied by the import before it writes `faction` and `npc_faction`. That list is never extended without the owner. Every other name stays as written.
- A quest line mentions a faction only when it contains a stored faction name exactly (case-insensitive, whole phrase); where names overlap the longest wins (scripts/import/quests.ts `mentions`). A line that mentions none is reported by the import and shown nowhere.
- A board post whose topic stops being shown is retired, never deleted (order 6): edited to a one-line notice, its embeds sent empty, then archived (src/board/refresh.ts, `retiring` from src/board/data.ts). Its row is kept, so a rebuild never deletes it, and a topic shown again is edited back.

## Order 26

- Order 26's explicit override 1 of order 11's alarm output. Order 11's rule, word for word: "its production run fails once when a metric's state changes upward (yesterday at or over 10% of its Free limit, the day before under), so GitHub mails the owner; staying over passes, and dropping back under is reported in the job summary and passes." A failing level alarm now also carries its cause, as an `::error` annotation and in the job summary, for each day judged: the UTC day ("this mail arrives the morning after"), the database (dev / production / other), the top 3 statements by that metric (literals as ?) and that UTC day's workflow runs (scripts/usage/cause.ts). Reading the cause never changes the outcome. Unchanged: the 10% target, once per crossing, production-only judging, and order 15's rule that the usage workflow is never dispatched to confirm its level alarm.
- Order 26's explicit override 2 of usage.yml's `permissions: contents: read`: `actions: read`, used only to list the judged UTC day's workflow runs.
- Actions logs and summaries are public: a database is printed only as dev, production or other, and a statement only with every literal replaced by ? (scripts/usage/queries.ts `queryShape`). Fuller detail goes in the FINAL REPORT, never in a log.
- A workflow that runs on a pull request never runs a script with `--remote` (scripts/ci/ci-reads.test.ts, over every workflow file; it checks that switch, not every read: the health dry runs' few hundred rows remain, named in ci.yml). CI's zone benches read a local D1 filled by the real import (ci.yml `local-data`). From the dev copy they read about 450,000 rows per CI run, and eight runs on 2026-10-27 took the account to 79.4% of D1 Free's daily reads.
- Who read D1's rows is measured per database and per statement from GraphQL (`d1QueriesAdaptiveGroups`, read back 90 days; `notOlderThan` 7,776,000 s on 2026-10-28), never guessed: `timings.yml`'s `insights` input (scripts/usage/insights-cli.ts). It costs no D1 rows.
- A query the cron runs on every 15-minute run (96 a day per copy) has its rows read benched on the real data before it ships, idle, for 1 and 10 guilds (scripts/bench/sweep-reads.ts on the local D1 after `npm run import:local`).

## Order 27

Order 27 is the DKP add-on, part 1 (docs/PRD.md, "DKP add-on (orders 27–28)"). Its explicit overrides each quote the earlier rule in full.

- Order 27's explicit override 1 of order 5's "The session never creates channels or posts on the owner's server. Live board posts start from the owner's own `/guildcraft setup board:`; before that, board code is verified in workerd against a mocked Discord API, and the dry run is a read-only render from live D1 (`.github/workflows/board.yml`, action `render`), with `delete` as the rollback.", as extended by orders 7, 9, 16, 19 and 24.
  - When an admin presses **Add DKP** in `/guildcraft setup`, the bot creates one text channel, GC-DKP, with its overwrites (src/dkp/setup.ts). If a GuildCraft category exists, the channel goes in it; otherwise the bot creates the category first, as Create GuildCraft channels does.
  - In GC-DKP the bot posts and edits only its own messages: raid cards, approval cards, setting notices and standings messages. It pins nothing.
  - The session posts nothing live. Tests use a mocked Discord.
- Order 27's explicit override 2 of order 9's "A button on a posted (public) message answers the presser with a new private message (type 4, private), never UPDATE_MESSAGE (type 7): one member's press never changes a public post. Only officer cards and vault messages are edited in place."
  - In GC-DKP, the bot may edit in place every message it posted, whatever caused the edit: a member's press, an officer's action or a timer.
  - The presser's own answer is always a new private message.
  - Outside GC-DKP, order 9 stands.
- Order 27's explicit override 3 of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer."
  - DKP balances, attendance and history are guild-public by design: every member of a server may read every member's.
  - This covers DKP data only.
- Order 27's explicit override 4 of order 18's "Order 18's explicit override 1 of the earlier orders' and the PRD's command names: the commands are `/me`, `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`, `/officer` and `/guildcraft` (docs/PRD.md, "Work order 18" table). The old names are not registered and answer "not available"." and of order 10's registration scopes in "Order 10's explicit override of the rule against remote writes beyond the named ones (orders 5–9): one production D1 database and one production Worker in the same Cloudflare account, with the production Worker's secrets set from Actions secrets; the production database's migrations and every write the existing jobs and the Worker make to it (imports, cron sweeps, departures, `backup_status`, `usage_daily`); per-guild exports to `guild-exports/` in the private backup repository; the production app's interactions endpoint URL and icon (PATCH `/applications/@me`); global command registration for the production app. No posts on any server, and no change to the Dev app. Order 5's "no posts on the owner's server" rule and its extensions (orders 7–9) stand, for both apps."
  - `/dkp` is a separate, per-server definition (src/dkp/definition.ts), kept outside COMMANDS, with its own routing, autocomplete (LISTS) and help tests.
  - It is never registered globally and never sent in a bulk PUT.
  - The Worker creates it with the single-command upsert on Add DKP, and deletes it on Remove DKP.
  - After each deploy, register-commands.yml upserts `/dkp` on every server whose DKP is on (dkp_guild, derived from that copy's D1; scripts/discord/dkp.ts).
  - scripts/discord/dkp.test.ts proves that dev's bulk PUT leaves `/dkp` registered.
  - `/help`'s DKP page appears only in a server with DKP on (order 27, PR B).
- Order 27's explicit override 5 of order 10's list of production resources (quoted in full in override 4):
  - one Durable Object class (SQLite-backed), DkpTimers, bound as DKP_TIMERS to each copy's Worker and used only for DKP timers;
  - its `new_sqlite_classes` migration in each environment (wrangler.jsonc).
  - It is a new schedule; its expected usage is in order 27's FINAL REPORT. It never writes sweep_run, and never touches the cron or the health check.
- Order 27's explicit override 6 of order 4's "Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so (the owner, 2026-10-19: Corroded and Rusty items are not the same).", approved by the owner on 2026-10-29, as a display order only.
  - Named killed lists a zone's creatures with names that don't start with "a " or "an " (case-insensitive) first, then the rest, each part A→Z (src/dkp/creatures.ts).
  - Nothing is stored or labelled "named". Every creature stays selectable.
- Order 27's explicit override 7 of PRD FR-8's tiering ("`/officer` and `/guildcraft` are shown to Manage Server by default; a server admin grants `/officer` to the officer role once (Server Settings → Integrations → the app → `/officer`)." and "the Worker re-checks the caller's roles on every request").
  - By default, DKP is run by the officer role, plus admins as isOfficer already allows.
  - An admin may name another role in `/dkp settings`.
  - That decision lives in src/access.ts (`isDkpRunner`).
- Order 27's explicit override 8 of "Never add a column for a value the table already holds.": `dkp_ledger.balance_after`.
  - It is the member's balance in that pool once the row applies, written in the same statement as the row.
  - test/worker/dkp.test.ts recomputes every balance_after from the amounts.
  - It exists so that reading a balance costs one indexed row, not the whole history.
- Order 27's explicit override 9, a restatement (not a widening) of order 16's "Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party."
  - DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one.
- The DKP ledger is append-only. The database refuses an UPDATE or DELETE of a row (migrations/0021's triggers).
  - A correction is a new row that names the row it corrects.
  - A reversal returns the amount actually paid. A re-add is capped against the pool's cap at that moment.
- One function reads balances and attendance (src/dkp/ledger.ts `dkpRead`), and every surface uses it.
- Nobody changes, or approves a change to, their own DKP. One function decides this (src/access.ts `dkpSelfConflict`), and every route calls it. It covers adjustments, approvals and corrections.
  - Bot-made rows are not "self": kill and flat payouts, and removals by Check again.
  - Per-named values and settings are public, forward-only and not about one member, so they are outside this rule.
- Removing DKP never deletes DKP data. Deleting a server's DKP history is not built in order 27.
- A DKP button keeps working after DKP is removed, answering privately "DKP is off on this server" (order 18: every sent custom_id stays handled).
- Public logs show pseudonyms only (order 5). No balance, member name or reason appears in an Actions log.
- Budget for order 27 (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges.

## Order 28

Order 28 reads the Monsters and Memories Wiki directly and retires Mo Betta (the owner, 2026-10-29: the "never contact Miraheze" rule lifted at 14:51 ET; "Proceed now" on reading the wiki from Cloudflare). Its explicit overrides each quote the earlier rule in full. Overrides 2, 4, 6, 8 and 9 take effect with PR B, which ships only if ITEM 3's gate passes and the owner approves gate line 6's list.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests and 2 merges; PR A at most 3 pushes, PR B at most 4. The owner, 2026-10-29, added a third pull request and merge (at most 2 pushes) for the relay's readiness fix (wiki-snapshot run 40952610941 met workers.dev's 404 before the new relay was live everywhere), and a fourth (at most 2 pushes) for planning the content from the title listings first (run 40955580245 reached the 150-request cap with no record of where the requests went), and a fifth (at most 2 pushes) for the cap below.
- Override 1, of order 14's override 1 ("Order 14's explicit override 1 of the earlier orders' "GuildCraft never contacts the wiki": the reachability probe's two API requests (scripts/probe/wiki.ts) from this machine, a GitHub-hosted runner and Cloudflare's network, through the dispatch-only `.github/workflows/wiki-probe.yml`; and one temporary Worker, `guildcraft-wiki-probe` (scripts/probe/wrangler.jsonc: no bindings, routes or cron), deployed, called once and deleted in the same run. Nothing else contacts the wiki.") and of order 17b's override 3 ("Order 17b's explicit override 3 of order 14's "Nothing else contacts the wiki", for monstersandmemories.wiki and storiesofmnm.com only: `scripts/zone/sites.ts`, run by hand when zones change (never on a schedule), makes at most one request per zone per site to verify each link (status and final address after redirects), plus one read of Stories of MnM's `/zones/` index, with order 14's named User-Agent and polite-guest rules. Miraheze is never contacted; its links are built from the import as before.").
  - The wiki snapshot job (ITEM 1: `.github/workflows/wiki-snapshot.yml`, and from PR B import.yml's wiki job) reads https://monstersandmemories.miraheze.org/w/api.php, and only that path.
  - At most 200 requests per workflow run, every attempt counted (scripts/wiki/snapshot.ts `REQUEST_CAP`), one at a time, with maxlag=5 and order 14's named User-Agent. (The order said 150; the owner raised it to 200 on 2026-10-29 after the plan-only run 40957526471 measured about 151 needed.)
  - A maxlag answer is waited out for its Retry-After, at most 3 times. A network error gets order 14's single retry after 10 s. A 403 or 429 is an answer, never retried.
  - Order 17b's link check is unchanged.
- Override 2 (PR B), of order 17's override 1 ("Order 17's explicit override 1 of the import scope (orders 1 and 13: wiki.json only): the import also reads mnm-tools' `mnmdb/maps.json` (and links its map images), MnM Atlas's `data/maps.json` (map ids and titles only), and mo-betta-quests' `zones.json` and `npcs.json`, each pinned to the commit that last changed it, with that commit's date from GitHub (scripts/import/zones.ts `ZONE_FILES`). It warns, never fails, when a mnm-tools or Mo Betta file has not changed for 30 days; MnM Atlas's registry is exempt.") and order 25's override 1 ("Order 25's explicit override 1 of order 17's override 1 ("the import also reads mnm-tools' `mnmdb/maps.json` …, MnM Atlas's `data/maps.json` …, and mo-betta-quests' `zones.json` and `npcs.json`, each pinned to the commit that last changed it"): the import also reads mo-betta-quests' `quests.json`, pinned the same way (scripts/import/zones.ts `ZONE_FILES`), for the faction posts' quest lines only: reward lines that begin with "Faction" (scripts/import/quests.ts).").
  - The wiki snapshot replaces Mo Betta's zones.json, npcs.json and quests.json, and takes Mo Betta's fill-only role: mnm-tools mobs keep their own fields, the wiki fills only what a mob lacks, and every conflict is reported.
  - mnm-tools and MnM Atlas stay as they are. Mo Betta's credit goes; the wiki's CC BY-SA credit stays.
- Override 3, of order 10's production resource list ("Order 10's explicit override of the rule against remote writes beyond the named ones (orders 5–9): one production D1 database and one production Worker in the same Cloudflare account, with the production Worker's secrets set from Actions secrets; the production database's migrations and every write the existing jobs and the Worker make to it (imports, cron sweeps, departures, `backup_status`, `usage_daily`); per-guild exports to `guild-exports/` in the private backup repository; the production app's interactions endpoint URL and icon (PATCH `/applications/@me`); global command registration for the production app. No posts on any server, and no change to the Dev app. Order 5's "no posts on the owner's server" rule and its extensions (orders 7–9) stand, for both apps.").
  - One temporary relay Worker per workflow run, `guildcraft-wiki-relay` (scripts/wiki/wrangler.jsonc: no bindings, routes or cron), deployed, used and deleted by ITEM 1's single job, with a one-time token compiled in. Deletion is verified by a 404 from the Cloudflare API.
  - Each relay call makes exactly one wiki request and returns the wiki's response unparsed (scripts/wiki/relay.ts). It allows only GET requests to api.php for ITEM 1's actions (scripts/wiki/allowed.ts). Everything else gets a 403 and contacts nothing (scripts/wiki/wiki.test.ts, and the job's own refusal step).
  - The probe's request is generalised (scripts/probe/wiki.ts `politeGet`); wiki-probe.yml is unchanged.
- Override 4 (PR B), of order 27's override 6, all of it ("Order 27's explicit override 6 of order 4's "Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so (the owner, 2026-10-19: Corroded and Rusty items are not the same).", approved by the owner on 2026-10-29, as a display order only." with its two points: "Named killed lists a zone's creatures with names that don't start with "a " or "an " (case-insensitive) first, then the rest, each part A→Z (src/dkp/creatures.ts)." and "Nothing is stored or labelled "named". Every creature stays selectable.").
  - npc.named and npc.raid are stored from the wiki's categories, Category:Named Mobs and Category:Raid Encounters (migrations/0022, in PR A; NULL from a source without tags).
  - The Named killed order is raid encounters, then named mobs, then "Other creatures", each A→Z. The source says so; nothing is inferred from names.
- Override 5 (PR B), of order 24's "An NPC's wiki fields are shown under the wiki's own labels only: `factions` is "Reputation Lost", `opposing_factions` is "Reputation Gained" (scripts/import/zones.ts `FactionKind`). Faction names are trimmed, never merged or re-spelled; a name that disappears upstream is deactivated." together with order 25's override 2 ("Order 25's explicit override 2 of order 24's "Faction names are trimmed, never merged or re-spelled" and order 4's "Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so": the owner said so (2026-10-27, corrected 18:18 ET) for exactly eight groups of faction names, held in one file, `src/faction-aliases.ts`, and applied by the import before it writes `faction` and `npc_faction`. That list is never extended without the owner. Every other name stays as written.").
  - The wiki's spellings replace Mo Betta's, and src/faction-aliases.ts still applies.
  - A faction name that appears only because the source changed is reported, never merged.
- Override 6 (PR B), of order 17's "Zone names match only after two normalisations, case and curly to straight apostrophes (`zoneKey`). Every other difference is a row in the derived mapping (`zone_name`, zone_key NULL) and a warning, never a guess. Mo Betta's NPC zone text is split only on ", " and " or "."
  - Each NPC template block is one NPC × zone; its zone text is never split.
  - Removing link markup ([[…]], [[…|…]]) and HTML entities is parsing, not a third name normalisation. The two normalisations are otherwise unchanged.
  - Text that maps to no zone is stored unmatched and reported.
- Override 7, of order 14's "A polite guest: at most 2 requests per path, a named User-Agent that does not name Brian, one retry after 10 s on a network error only, never on a 403 or 429. Never disguise the origin: no browser User-Agents, proxies, IP rotation or retry-until-it-works. A block is an answer." The owner, 2026-10-29, chose "Proceed now", knowing that Miraheze challenges GitHub's runners.
  - The wiki is read from Cloudflare through ITEM 1's relay, honestly: order 14's named User-Agent, which names GuildCraft and a contact; no browser User-Agent, no IP rotation, and no retry around a refusal.
  - The block stays an answer on the Cloudflare path: a 403, a 429 or a challenge there stops the run and is reported, never worked around. If Miraheze objects or blocks Cloudflare, yesterday's zone data stays (override 9), and the owner decides whether to return to Mo Betta by reverting PR B.
  - The rest of order 14's rule stands.
- Override 8 (PR B), of order 26's "A workflow that runs on a pull request never runs a script with `--remote` (scripts/ci/ci-reads.test.ts, over every workflow file; it checks that switch, not every read: the health dry runs' few hundred rows remain, named in ci.yml). CI's zone benches read a local D1 filled by the real import (ci.yml `local-data`). From the dev copy they read about 450,000 rows per CI run, and eight runs on 2026-10-27 took the account to 79.4% of D1 Free's daily reads."
  - CI, import:local, the benches and the fixtures read a committed snapshot of the wiki (data/wiki-snapshot/, with a CC BY-SA credit file), never the live wiki. The snapshot is refreshed by hand from ITEM 1's artifact.
  - Nothing outside ITEM 1's job contacts the wiki.
- Override 9 (PR B), of order 8's "Every alarm states who is notified, how often, and what counts as its state. It re-notifies only when the state changes, at most once a day. (The nightly jobs' alarms are stated in each workflow's header; the mechanism is `scripts/ci/alarm.ts`, and the usage warning is under order 11.)" and of import.yml's alarm header ("state: the newest data_import row in the alarm state (src/import-status.ts: ok, failed, running, refused); failed and refused count as failing.").
  - The import keeps running when the wiki doesn't: if the snapshot job fails (relay deploy, refusal, cap, or a failed delete check), both copy jobs still import mnm-tools and keep yesterday's zone data.
  - Each copy writes its normal data_import row, plus the zone part's own state: a new status, defined once in src/import-status.ts. It counts as failing and is notified once per state change, as order 8 says.
  - The snapshot job itself is never the alarm; its failure surfaces only through that row. The alarm header is updated to match.
- Only ITEM 1's job contacts the wiki. Everything else reads its snapshot.
- A missing wiki field is NULL, never guessed. Every template field the import reads is named in one place in code (scripts/wiki/parse.ts `TEMPLATE_FIELDS`).
