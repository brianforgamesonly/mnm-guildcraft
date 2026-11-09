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

## Order 28b

Order 28b finishes order 28: two fixes (PR C), then the switch-over and the DKP tags (PR D, order 28's "PR B"). Order 28's overrides and added rules stand, with the corrections below. Override 6, as corrected, and override 8's committed snapshot take effect in PR C (the snapshot is committed there; CI and the local paths read it from PR D's switch-over).

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests (PR C: ITEMs 1–3; PR D: ITEMs 4–5), each with at most 3 pushes, and 2 merges.
- Correction 1, of order 28's override 6, quoted in full: "Override 6 (PR B), of order 17's "Zone names match only after two normalisations, case and curly to straight apostrophes (`zoneKey`). Every other difference is a row in the derived mapping (`zone_name`, zone_key NULL) and a warning, never a guess. Mo Betta's NPC zone text is split only on ", " and " or "." — Each NPC template block is one NPC × zone; its zone text is never split. — Removing link markup ([[…]], [[…|…]]) and HTML entities is parsing, not a third name normalisation. The two normalisations are otherwise unchanged. — Text that maps to no zone is stored unmatched and reported."
  - A block's zone value is split exactly as order 17's rule splits Mo Betta's NPC zone text: split only on ", " and " or "; then remove repeats; then map each part (scripts/import/zones.ts `npcZoneParts`, the one function both sources use).
  - Removing link markup stays parsing. Order 17's rule is restored for this field, unchanged.
- No change to names: a block's name field is kept as written, the page title only when it has none (scripts/wiki/parse.ts). A name that differs from its page title by more than the first letter's case is a wiki typo, on either side; the comparison reports each one (`nameMismatches`) so it can be fixed on the wiki, and gate line 2 counts such a miss as explained by wiki content (scripts/wiki/compare.ts: line 2 passes at or above Mo Betta's count, or when every miss is such a one).
- The wiki snapshot doesn't start while a deploy of either copy's Worker (deploy.yml) is queued or running: it polls every 15 s and waits at most 10 minutes, then fails with "a deploy was still running" (scripts/wiki/deploys.ts; a GitHub API error is polled again, never read as "no deploy"). Never a shared concurrency group: GitHub keeps at most one running and one pending job per group, and a newer arrival cancels the pending one.
  - A deploy that starts during a snapshot is recorded in that run's result (the job summary lists the deploy runs that overlapped it), with the relay readiness calls' times and answers.
  - deploy.yml's and register-commands.yml's concurrency keys stay as they are. register-commands.yml is dispatched only after a deploy has concluded with success.
- Fixtures for the parser are real pages cut from a snapshot artifact (scripts/wiki/fixtures.ts, test/fixtures/wiki-pages.json), carrying their CC BY-SA 4.0 credit and each page's revision. The committed snapshot (data/wiki-snapshot/, with its CREDIT.md) is refreshed by hand from a wiki-snapshot artifact.
- Failed runs: every one is listed in the FINAL (order 12).
- PR D (the switch-over): the snapshot job is one reusable workflow, `.github/workflows/wiki-job.yml`, called by import.yml's `wiki` job and by wiki-snapshot.yml; both callers grant `actions: read`. Mo Betta is in no `ZONE_FILES` entry and no credit. Override 9's zone state is the run's own data_import row: status `zones-kept` (src/import-status.ts: finished for the game data's readers, failing for the alarm), with the reason in `error`. One row per run, so the alarm's "previous run" rule (scripts/import/core.ts `previousImportFailing`) is unchanged: as order 8 says, the owner is mailed once when the zone part starts failing and again only after a recovery, so nights of `zones-kept` in a row are one mail. The health check counts a `zones-kept` night as an import that ran (its game data finished). A cancelled import run imports nothing (`!cancelled()`).
- No zone source records a zone description since Mo Betta left (the wiki's `{{ZoneDetails}}` has no such field); the zone card no longer lists "description" as not recorded. Reading the page's lead text as a description would be a new parsing rule, for the owner to decide.

## Order 29

Order 29 is the DKP add-on, part 2: spending points (docs/PRD.md, "Order 29: spending points"; the owner settled the bidding rules on 2026-10-29, 16:08 and 16:12 ET). Order 27's overrides and added rules stand, with the overrides below, each quoting the earlier rule in full.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 4 pull requests, each with at most 3 pushes, and 4 merges. PR A: ITEMs 0–3 (ITEM 3 first, because ITEM 1 needs its tables); PR B: ITEM 4; PR C: ITEMs 5–6; PR D: ITEMs 7–8.
- Override 1, of order 27's "The DKP ledger is append-only. The database refuses an UPDATE or DELETE of a row (migrations/0021's triggers)."
  - One migration, 0023, rebuilds dkp_ledger to add the kinds standby, spend, refund and decay. It uses PRAGMA defer_foreign_keys (corrects refers back to the ledger), drops the triggers before the old table is dropped, copies every row unchanged (ids included), and recreates the triggers and indexes.
  - The row count and a checksum of every column match before and after, proved by a test (test/worker/dkp-ledger-rebuild.test.ts) and in the dry run (backup.yml's migration check, on a copy of each copy's live data; scripts/backup/ledger-proof.ts holds the one proof both run). The per-guild export and the backup are re-checked against the new schema.
  - No other update or delete of the ledger is allowed.
- Override 2, of the PRD's DKP section: docs/PRD.md's "Everyone Present or Standby at that moment earns the named's raid points and the guild points.", "*Flat mode.* There is no Named killed. Pay attendance pays the flat value once, to everyone Present or Standby at that moment." and "| Pool cap | 100 |".
  - Standby earns the raid's standby value once per raid, at close, not per kill. The cap default becomes 200.
  - Only raids opened after PR A deploys (dkp_raid.standby_once). Ledger rows already written stay as they are, and a raid open across the deploy keeps the old rule, so standby is never paid twice.
- Override 3, of order 16's "Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party." and of order 27's override 9, a restatement (not a widening) of that same order 16 rule: "DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one."
  - A wishlist nudge is a direct message to a member who put that item on their wishlist, carrying a link to the auction card, not a Bid button (a press from a direct message has no server member).
  - Adding an item to a wishlist is the member's opt-in, and the wishlist command says so. A refused direct message (the member blocks them) is skipped silently and counted.
  - No channel message pings anyone (order 27, override 9).
- Override 4, of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.", as order 27's override 3 already extends it: sealed bids, revealed after an auction closes, are DKP data and guild-public. Wishlists are guild-public too, because officers see them when items drop.
- Override 5, of order 27's override 1's "In GC-DKP the bot posts and edits only its own messages: raid cards, approval cards, setting notices and standings messages. It pins nothing.": GC-DKP may also hold the bot's auction cards, results and cancellations; general-auction cards and disposal records; and shop listings and purchase posts. All are edited in place under order 27's override 2.
- Not overridden: order 4's "Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so". Creature names that differ only by "a"/"an" are reported (order 29, ITEM 2), never matched; the owner decides that separately.
- The bot decides every auction. Bids stay hidden from everyone until close, closing is by timer only, and the price is computed. An officer can cancel only with a public reason, which reveals the bids.
- One function decides who may bid in a raid auction, and every route calls it.
- Every spend, refund, standby payout and decay is a ledger row whose actor is the bot (or the officer, for a cancel). Balances stay derived.
- A spend checks the balance inside its own insert, so a shop purchase and an auction can't both spend the same points.
- Who was at a kill is read only from dkp_kill_member, never from the ledger.
- A zone's description is its page's lead text (the owner, 2026-10-29), read by one named function in scripts/wiki/parse.ts (`leadText`) and recorded beside TEMPLATE_FIELDS (`zoneDescription`). That function strips __NOTOC__, <br>, templates, files, references and markup.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 30

Order 30 clears four small items: forum post guidelines, a building line on boards, the "DKP module" wording and a guard on the weekly decay timer. Nothing earlier is overridden except override 1 below.

- Override 1, of order 27's override 5, "It is a new schedule; its expected usage is in order 27's FINAL REPORT. It never writes sweep_run, and never touches the cron or the health check.": the cron's daily slot calls the object's `ensureDecay`, as ITEM 4 orders. The object itself still never writes sweep_run or touches the health check.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEMs 1–2; PR B: ITEMs 3–4.
- Forum defaults are set at creation and by one backfill, then never touched again. GuildCraft sets a forum's guidelines when it creates the forum, plus one backfill of forums that already exist (scripts/forum/backfill.ts: dry run, then the test copy, then production; it sets a field only if it's empty at that moment; PR B removes it). After that GuildCraft never reads or writes these fields, so an officer who changes or clears them keeps their choice.
- Order 24's member-post denial on GuildCraft forums stands. The guidelines text says why.
- The DKP switch is called the "DKP module" on its buttons, its confirmations and in help. No button, reply or help text uses "Add DKP" or "Remove DKP" unless the word "module" follows, because the bare phrase reads like awarding points.
- A guild with DKP on always has exactly one decay item on its Durable Object. One idempotent function ensures it (src/dkp/timers.ts `ensureDecay`), and every path that can find it missing calls that function: Add DKP module, the cron's daily slot (09:00 UTC, src/dkp/guard.ts) and, because a runner can't reach a Durable Object, the post-deploy step through the Worker's signed route `POST /ops/decay-guard` (`register-commands.yml`, or `decay-guard.yml` by dispatch). The route is signed with an HMAC under the copy's bot token, needs no new credential, and answers counts only.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 31

Order 31 moves cancelling an auction to a command and renames the after-kill re-check (the owner, 2026-10-30, 07:52 and 08:08).

- Override of the PRD's Order 29 Cancel rule, as stored at 155155d: "Cancel: an officer can cancel an open auction unless they have bid in it. The reason is required; the cancellation is public and reveals the bids. There's no spend."
  - Who may cancel, the self-conflict refusal, the required public reason, revealing the bids and no spend do not change. Only the control changes: cancelling moves from a button on the card to `/dkp cancel`.
- Auction cards show members only controls they can use. On an auction card, every button any viewer sees is one a member can press; an officer-only auction action is a command. Exception: Post to general auction on a closed, unsold card stays. Raid cards and approval cards are officer workflow cards, and they keep their buttons.
  - Decided by the owner (2026-10-30 12:11; order 32's override 3): Record what was done stays on closed, unsold general-auction cards. It is this rule's second exception.
- "Kill roll call" is the name of the after-kill re-check, on the card, in replies, in the setting's label and in help. An earlier rule's "Check again" means it. The custom_id and the setting key `check_seconds` stay.
- Ledger rows already written keep their stored reason text, because history is never rewritten (order 27). New rows use the new reason.
- `/dkp cancel` and an old card's form share one cancel function (src/dkp/auction.ts `cancelAuction`). `dkpac:` and `dkpacm:` stay handled (order 18).
- Failed runs: every one is listed in the FINAL (order 12).

## Order 32

Order 32 is the Events module, part 1 (docs/PRD.md, "Events module"; the owner approved it on 2026-10-30). Its explicit overrides each quote the earlier rule in full.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 3 pull requests, each with at most 3 pushes, and 3 merges. PR A: ITEMs 0–1; PR B: ITEM 2; PR C: ITEM 3.
- Override 1, of order 18's "Order 18's explicit override 1 of the earlier orders' and the PRD's command names: the commands are `/me`, `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`, `/officer` and `/guildcraft` (docs/PRD.md, "Work order 18" table). The old names are not registered and answer "not available"."
  - `/event` is added beside it, registered per server only while the Events module is on, by the same step as `/dkp` (src/events/definition.ts, outside COMMANDS; scripts/discord/dkp.ts). Nothing else changes.
- Override 2, of order 27's override 5, "one Durable Object class (SQLite-backed), DkpTimers, bound as DKP_TIMERS to each copy's Worker and used only for DKP timers;", and of Remove DKP module's `deleteAll()` (src/dkp/timers.ts at e29b905).
  - The Events module's items share the guild's due-list. Every Events kind starts `ev`; no DKP kind does (test/worker/events-switch.test.ts).
  - Each module removes only its own items. Remove DKP module keeps its effect on DKP items exactly; Remove Events module removes only Events items, and each card's pace goes with its item.
- Override 3, of order 31's "Auction cards show members only controls they can use. On an auction card, every button any viewer sees is one a member can press; an officer-only auction action is a command. Exception: Post to general auction on a closed, unsold card stays. Raid cards and approval cards are officer workflow cards, and they keep their buttons."
  - Second exception (the owner, 2026-10-30 12:11): Record what was done, on a closed, unsold general auction card, stays.
  - The old Cancel button's handlers (`dkpac:`, `dkpacm:`) stay permanently, under order 18's "A button on a message the bot already sent keeps working after a rename: every custom_id prefix the code has ever sent is still handled." No removal is planned.
- Override 4, of order 5's "The session never creates channels or posts on the owner's server. Live board posts start from the owner's own `/guildcraft setup board:`; before that, board code is verified in workerd against a mocked Discord API, and the dry run is a read-only render from live D1 (`.github/workflows/board.yml`, action `render`), with `delete` as the rollback.", as extended by orders 7, 9, 16, 19, 24 and 27, and of order 9's "A button on a posted (public) message answers the presser with a new private message (type 4, private), never UPDATE_MESSAGE (type 7): one member's press never changes a public post. Only officer cards and vault messages are edited in place."
  - When an admin presses **Add Events module** in `/guildcraft setup`, the bot creates one text channel, GC-Events, with GC-DKP's overwrites (src/events/setup.ts): members read; only GuildCraft posts.
  - In GC-Events the bot posts and edits only its own messages: event cards, setting notices, change notices and roster changes, each edited in place under order 27's override 2. The presser's own answer is always a new private message.
  - The session posts nothing live. Tests use a mocked Discord.
- Override 5, of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.", as order 29's override 4 extends it.
  - Event rosters (character, class, level, status and member) are guild-public on the card.
  - Sign-up history is shown only to officers, in `/event list`.
  - Every reply to a press, `/event list` and the preview are private.
- Override 6, of order 16's "Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party.", restated for Events as order 27's override 9 is for DKP: Events messages ping nobody. Every GC-Events post and edit sets `allowed_mentions: {parse: []}`.
- Events members see only controls they can use. On the event card every button is one any member can press. Officer actions are `/event` commands. This is order 31's rule, applied to event cards.
- One function decides who may sign up for an event (the member role, the event's sign-up role, the lock, frozen, left), and every route calls it.
- Every status change is a row in the event's sign-up history, with time and actor. The card and every count are derived from the current rows.
- A sign-up keeps a snapshot of its character's name, class and level, so a deleted or renamed character never breaks a card. This is a deliberate exception to "Never add a column for a value the table already holds."
- Roles and types are stored as fixed keys. Admins rename only their labels.
- Direct messages of any kind are not in order 32: they are part 2, which brings the ping override.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 33

Order 33 is the Events module, part 2 (docs/PRD.md, "Events module"; the owner approved its specification on 2026-10-30). Its explicit overrides each quote the earlier rule in full.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEMs 0–1; PR B: ITEMs 2–3.
- Override 1, of order 16's "Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party.", of order 27's override 9 ("DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one."), and of order 32's override 6 ("Events messages ping nobody. Every GC-Events post and edit sets `allowed_mentions: {parse: []}`.").
  - Events may send direct messages to members on that event's roster: a reminder, a promotion, a time change and a cancellation (docs/PRD.md, "Who gets which message").
  - A refused direct message (50007) is skipped silently and counted.
  - No channel message pings anyone. `allowed_mentions` stays empty everywhere.
  - A direct message carries only that event's card data and the recipient's own sign-up.
- Override 2, of order 32's "Direct messages of any kind are not in order 32: they are part 2, which brings the ping override." That exclusion ends here.
- Override 3, of order 32's "Direct messages are part 2: a promoted member sees it on the card, and privately if it happened on their own press." (src/events/press.ts at d0da30b, lines 4–5). A promoted member now gets a direct message, unless the promotion came from their own press; then the private reply is enough.
- The roster means Signed up, Tentative, Bench and Waitlist. It excludes Can't make it and Left.
- Lock and reminder due together: the lock goes first, and the reminder reuses that run's Left result instead of a second lookup. Recipients are worked out after any promotion, so a promoted member gets both messages.
- Buttons name actions. Only "Signed up" changes, to Sign up. Tentative, Bench, Can't make it, Going and Maybe stay as the specification lists them. The status keeps its name on the roster.
- Every time a member sees is in their own time zone (Discord `<t:…>`), or in the server's named time zone where Discord can't render one (autocomplete). UTC is never shown. The .ics text and Google's `dates=` parameter are exempt, because they must be in UTC. The operator's dev-only usage line is not member-facing (order 11). test/worker/order33-cards.test.ts scans every string in src, each exception named.
- A card that couldn't be updated is put right later. It is marked out of date (`card_stale`, src/dkp/stale.ts) and redrawn by the next sweep until Discord accepts it, for DKP and Events cards alike.
  - Out-of-date cards are a flag queried by the cron, which costs 0 Discord calls when none are out of date.
  - Each guild's Durable Object does its own redraws, so no single run approaches the 50-subrequest limit. This adds to order 30's override 1: the cron also calls the object's `schedule`, only for a guild with a flag.
  - 10003, 10008 and 50001 stop the retries and are recorded (audit action `card.stopped`). A 429 waits for retry_after.
  - The sweep's redraw only edits. Order 32's "posted again if Discord no longer has it" stands for a change to the event (an `evcard:` item), never for the sweep: a card someone deleted doesn't come back unasked.
- A chunk of direct messages is derived from the alarm's cap (src/events/dm.ts `chunkSize`), and its cursor names the start it belongs to. A change or a cancel landing during a run wins over the run's own progress (src/dkp/timers.ts `save`).
- Remove module never switches a module off by mistake. A refused Add or Remove leaves the state exactly as it was, for DKP and Events. A refused Add saves only the channel it kept or made, through a statement that can't name the switch (src/dkp/setup.ts `keepChannel`).
- Failed runs: every one is listed in the FINAL (order 12).

## Order 34

Order 34 is the Events module, part 3: the DKP link (docs/PRD.md, "Events module"; the owner approved its specification on 2026-10-30). Its explicit overrides each quote the earlier rule in full.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEMs 1, 2 and 4; PR B: ITEM 3.
- Override 1, of the PRD's "`/dkp adjust member: pool: points: reason:` takes a reason, which is required, and the change is posted publicly in GC-DKP." and of order 27's "Nobody changes, or approves a change to, their own DKP. One function decides this (src/access.ts `dkpSelfConflict`), and every route calls it. It covers adjustments, approvals and corrections."
  - `/dkp adjust` gains an `event:` option, for a whole event's roster as one batch (PR B). Every existing rule still applies to each member.
- Override 2, of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.", as order 29's override 4 and order 32's override 5 extend it: a raid's no-shows (names) are guild-public on the event card (the owner's decision 11).
- Override 3, of the PRD's "The event closes 8 hours after start (a setting) by a due-list item.": it also closes when its linked raid closes, whichever comes first (src/events/link.ts `closeWithRaid`).
- Kept, not changed: order 29's "Who was at a kill is read only from dkp_kill_member, never from the ledger." Events attendance reads it and never the ledger.
- A raid links to at most one event, and an event to at most one raid. The link is set when the raid opens and never changes, except that cancelling the event unlinks it.
- A raid with no linked event behaves exactly as today. No check and no marks.
- Events never pays or removes points by itself. The Present check only marks or refuses taps. Points still come from kills, flat payouts, standby and adjustments.
- One function decides who is on an event's roster (src/events/eligible.ts `onRoster`), and every route calls it.
- A foreign key names only a table created before the one holding it. A D1 export writes tables in creation order, and SQLite refuses a row whose key names a table that doesn't exist yet, so a later key makes the dump unloadable as soon as that table has a row (dev's backup dry run, run 41134004732). test/worker/schema.test.ts derives this from the live schema. A column pointing at a later table holds the id with no REFERENCES, and the code keeps it true.
- No-shows and raid-event attendance are derived, never stored: dkpRead reads them from dkp_kill_member and the sign-up rows (order 27's one reader), and a flat payout's roster is there too (src/dkp/raid.ts `recordKill`).
- Failed runs: every one is listed in the FINAL (order 12).

## Order 35

Order 35 is gear upgrades, part 1: race, item levels, the coverage report and saved gear (docs/PRD.md, "Gear upgrades"; the owner approved it on 2026-11-05). Its explicit overrides each quote the earlier rule in full, from where it is stored.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEM 1's item part, ITEMs 2 and 3 (data only: no derived level is shown to members); PR B: ITEM 1's character part and ITEM 4.
- Override 1, of order 13's "never parsed", stored in migrations/0010_gear.sql:44 as the mob table's `level TEXT, -- as recorded ("3 - 10", "31-33", "~15"); never parsed`. (npc.level and zone.level carry no such statement: migrations/0013_zones.sql:6 says "level, description, adjacent_json: Mo Betta, as recorded.", and that stands.)
  - The import now parses mob.level, npc.level and zone.level into numbers, in memory, for the item level rule (scripts/import/levels.ts `parseLevel`). The text stays as recorded in its column.
- Override 2, of order 13's override 3: "Order 13's explicit override 3 of "Never add a column for a value the table already holds": generated columns read from `item.stats_json` (`ac`, `dmg`, `delay`, `ratio`, `skill`, `handed`), and three derived columns rewritten on every import (`item.class_mask`, `item.slot_mask`, `item.source_mask`). `game_class.bit` is a named departure (a class's bit, assigned once, never reused)."
  - The derived columns gain `item.race_mask` and the level columns `item.level_low`, `item.level_high`, `item.level_kind` and `item.level_kinds` (migrations/0029). Each is rewritten on every import from data already held, like class_mask, and only a row whose values changed is written (`itemDiffers`).
  - `game_race.bit` is a named departure, as `game_class.bit` is. `item.gone_at` (the no-longer-listed flag, below) is not a value held elsewhere.
- Override 3, of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.": saved gear is private like the rest of `/me`. Only the member, and officers through `/officer edit-member`, can see or change it.
- Override 4, of order 13's "Whenever the source holds a value that a /gear find choice list lacks, the import warns: a new slot, weapon type, stat or resist (src/gear/vocab.ts), or a change in the class list. Commands are then re-registered. The warning never fails the run.": it extends to races. A race token the derived race list (game_race) lacks raises the same `vocab_drift` warning (list `race`), and so does a change in that list. The race list is no command's choice list, so it needs no re-registration.
- Levels are derived, never typed. No command sets an item's level.
- A level's kind is always shown with it. A zone-range fallback or a crafted floor is never presented as a mob's level.
- Saved gear names items, never copies them. It stores the item's stable key (`item.name_key`), never an autoincrement id, with no foreign-key cascade. The import never deletes an item that saved gear names; it flags it (`item.gone_at`, set for every wiki item the source stops listing and cleared when it returns), and the slot shows it as no longer listed until the member changes it.
- Saved gear acts only on the presser's own characters. A button on a public `/item` card changes the presser's characters, never the card owner's. Autocomplete for `character:` lists only the caller's own.
- The race list is derived as the class list is: a code on at least 2 items is kept (`RACE_MIN_ITEMS`), with a bit assigned once; a mount race is told apart by its items' slots alone (src/gear/vocab.ts `MOUNT_SLOTS`). `game_race` may legitimately hold no rows (every race list ALL), so it is in `IMPORT_MAY_BE_EMPTY`, outside the backup's must-hold-rows list (`IMPORT_TABLES`), and exported whole with the other game data (`IMPORT_WRITES`).
- A command whose shape changes is registered after its deploy, and the new code answers the old shape until then.
  - Committed by order 36 (ITEM 1). Order 35's push 80ee0ae said it added this rule, but its tree did not hold it: the edit failed ("String to replace not found") in the same batch of tool calls as the commit and the push, which ran without seeing the failure. Order 36's rules below make that impossible to miss.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 36

Order 36 is gear upgrades, part 2: scoring, `/gear upgrades` and the officer weights (docs/PRD.md, "Gear upgrades"; the owner approved its specification on 2026-11-05). Its explicit overrides each quote the earlier rule in full, from where it is stored.

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEMs 1, 2 and 3, and ITEM 5's bench for the summary and the slot list; PR B: ITEM 4, and ITEM 5's rows written per weight change.
- Override 1, of order 2's "A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer." (this file, "Added by work order 2").
  - `/gear upgrades` answers privately. Post to channel makes one list public, as `/item`'s post does.
  - The list names no other member except as a Reliable crafter, which `/item` already shows.
- Override 2, of order 35's "PR A: ITEM 1's item part, ITEMs 2 and 3 (data only: no derived level is shown to members)" (this file, "Order 35", the budget line).
  - Levels are shown in `/gear upgrades`, always with their kind (order 35's "A level's kind is always shown with it.").
- Override 3, of order 17's "A list sort uses one named key, never a combined score (the owner, order 13): zone drops sort by AC, then name." (this file, "Order 17").
  - Order 13's `/gear search` sorts are unchanged (src/gear/search.ts `searchStatement`). `/gear upgrades` has its own order: by gain (a score), smallest first, then the lower level_low, then the name.
- Nothing is hidden. Every usable item that scores higher than what's worn is listed, however small the gain.
- A score is always explainable. Each result shows the stat differences that produced it.
- Weights are the server's. Defaults live in code; an officer's change applies to that server only and is posted with who made it.
- A commit message describes only what the pushed tree contains.
  - After every push, `git show <pushed-sha>:<file> | grep -F "<text>"` is run for each rule or change the commit message claims.
  - CI fails a pull request whose commit says it adds a rule ("Order N rule…") without changing this file in that commit (scripts/ci/commit-claims.mjs; order 35's 80ee0ae fails it).
  - A commit is never sent in the same batch of tool calls as the edits it records: it waits for their results.
- Scores are computed, never stored, in integer hundredths (src/gear/score.ts). Scoring reads weights only through `weightsFor(server, class)`.
- Override 4 (the owner, 2026-11-06, resolving PR A's FINAL's contradiction 1), of order 5's "The session never creates channels or posts on the owner's server. Live board posts start from the owner's own `/guildcraft setup board:`; before that, board code is verified in workerd against a mocked Discord API, and the dry run is a read-only render from live D1 (`.github/workflows/board.yml`, action `render`), with `delete` as the rollback." and of order 7's "Order 7's one explicit override of order 5's "The session never creates channels or posts on the owner's server": the bot's departure notices, posted in the review channel the owner sets with `/guildcraft setup review:`. Everything else in that rule stands."
  - `/gear weights` and `/gear settings` changes post in the review channel: a third permitted kind of review-channel post, alongside departure notices (order 7) and report cards (order 9). Each names who, the class or setting, and the old and new values, and pings nobody (src/gear/weights.ts `postReview`).
  - The session itself posts nothing live; tests use a mocked Discord. Everything else in order 5's rule stands.
- Gains show two decimals everywhere (the owner, 2026-11-06: `fmtHundredths` as is).
- ITEM 5's local measurements stand; the deployed Worker's CPU is not required (the owner, 2026-11-06).
- Race names (src/gear/vocab.ts `RACE_NAMES`) come from Cowork's reading of the Monsters and Memories wiki's races list (2026-11-05), confirmed by the owner. HRS and DNK, the mount races, stay codes.
- The class table's source is the Stories of MnM character planner's published priority list, against which Cowork verified all 18 rows on 2026-11-05 (the owner, 2026-11-06).
- Failed runs: every one is listed in the FINAL (order 12).

## Order 36 follow-up

The owner's decisions in chat on 2026-11-06, after order 36's FINAL: quest names and links, wiki links on items, Pick a result opening the item's card, no level cap by default, and `/gear settings` retired. Worked as 1 pull request (this file's default budget). Its explicit overrides each quote the earlier rule in full.

- Override 1, of order 36's "Nothing is hidden. Every usable item that scores higher than what's worn is listed, however small the gain."
  - With no `max_level:` (the default) it stands. With one, items whose level is above it are not listed; the list ends with a quiet count of them ("9 more above Lv 30 not shown"), and the summary's footer carries the same count. Items with no level are always listed.
- Override 2, of order 36's specification "Nothing to show: "Nothing beats <item> for a <Class> in <slot>." The reply never suggests that items were filtered out, because none were." (docs/PRD.md, "Gear upgrades", part 2): with a cap, the quiet count is shown, as the owner chose.
- Override 3, of order 17b's override 3, "Order 17b's explicit override 3 of order 14's "Nothing else contacts the wiki", for monstersandmemories.wiki and storiesofmnm.com only: `scripts/zone/sites.ts`, run by hand when zones change (never on a schedule), makes at most one request per zone per site to verify each link (status and final address after redirects), plus one read of Stories of MnM's `/zones/` index, with order 14's named User-Agent and polite-guest rules. Miraheze is never contacted; its links are built from the import as before."
  - `scripts/gear/quest-sites.ts`, run by hand when quests change (never on a schedule), makes one control request and at most one request per quest that rewards gear to monstersandmemories.wiki (`/quests/<slug>`), with order 14's named User-Agent and polite-guest rules, and writes the verified links to `src/gear/quest-sites.json`. A link is offered only for a page that answered 200 at its own address; if the control (a quest that cannot exist) answers 200, nothing is written.
- Order 36's override 4 is narrowed to `/gear weights`: `/gear settings` is retired with the window it set. It is no longer registered and answers "not available" (order 18's retired names). migrations/0031's `gear_setting` table stays, unread; a saved row is never deleted automatically.
- Quest names are imported data, never typed: each gear item's quests come from the wiki snapshot's quest bucket, matched as its quest level is (scripts/import/core.ts `questsByItem`), and are kept in `item.origin_json.quests` (no new column). A quest's wiki link is offered only when the snapshot holds a page with exactly that title.

## Order 37

Order 37 is gear polish: the right creature on drop lines, readable vendor lines, the relay cleanup warning, and the monthly quest-page check (the owner's check of order 36, 2026-11-06). Its explicit overrides each quote the earlier rule in full.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge); ITEM 4 may take a 4th push on the same pull request.
- Override 1, of order 36's FINAL reading "The Vendor line shows the source's list as recorded, because it mixes zones, shops and merchants; picking out a merchant would mean guessing from names (order 4)." and of the rule it relied on, order 4's "Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or the owner says so (the owner, 2026-10-19: Corroded and Rusty items are not the same)." (this file, "Added by work order 4").
  - Recognising a vendor entry by an exact, case-insensitive match against the npc or zone_name tables is a lookup in data already held, not a guess from names (src/gear/sources.ts `vendorParts`). Anything that matches neither table is shown as recorded.
- A drop line names the mob with the lowest parsed level. When the item's level_kind is mob, that level equals its level_low. The import and the drop line read creatures through one function (scripts/import/levels.ts `creatureIndex`); test/worker/gear-sources.test.ts checks both on Corroded Bronze Plate Breastplate's data, and `npm run bench:gear-sources` scans every item.
- A warning names a real problem. A step that warns on every run while nothing is wrong is a defect.
- A temporary Worker is deleted by name from the config its deploy used, through Cloudflare's script DELETE (scripts/wiki/cleanup.ts), never `wrangler delete` (its Workers Sites cleanup needs a KV right the token lacks). A name without `guildcraft-wiki-` is refused before any request. Only a Worker confirmed still there fails the job.
- PR A recorded override 2 as not applied (ITEM 4 stopped on a contradiction: a new workflow can't be dispatched before it is on main). The owner chose Way A on 2026-11-06, so PR B applies it, below.
- Failed runs: every one is listed in the FINAL (order 12).

### Order 37, PR B (the owner, 2026-11-06: Way A, the npc indexes, and two defects from Brian's check at 15:03 ET)

- Budget: order 37's (1 pull request for PR B, at most 4 pushes, 1 merge).
- Override 2, of order 17b's link-check permission as the order 36 follow-up extended it (its override 3): "`scripts/gear/quest-sites.ts`, run by hand when quests change (never on a schedule), makes one control request and at most one request per quest that rewards gear to monstersandmemories.wiki (`/quests/<slug>`), with order 14's named User-Agent and polite-guest rules, and writes the verified links to `src/gear/quest-sites.json`. A link is offered only for a page that answered 200 at its own address; if the control (a quest that cannot exist) answers 200, nothing is written." — and of order 17b's override 3 it extends: "Order 17b's explicit override 3 of order 14's "Nothing else contacts the wiki", for monstersandmemories.wiki and storiesofmnm.com only: `scripts/zone/sites.ts`, run by hand when zones change (never on a schedule), makes at most one request per zone per site to verify each link (status and final address after redirects), plus one read of Stories of MnM's `/zones/` index, with order 14's named User-Agent and polite-guest rules. Miraheze is never contacted; its links are built from the import as before."
  - The permission also covers `.github/workflows/quest-sites.yml`: monthly (cron 23 9 1 * *) plus dispatches, at most robots.txt, one control and one request per production quest that rewards gear, half a second apart, with order 14's named User-Agent and polite-guest rules. The links live in `quest_site` (migrations/0032), not a committed file; `src/gear/quest-sites.json` is retired.
  - The control must answer 404, robots.txt must allow `/quests/` (a 404 robots.txt allows), and a 403 or 429 on a quest stops the run; a stopped run writes nothing and fails.
  - A link is removed only by the second counted 404 in a row; a check counts only on a scheduled run at least 25 days after the quest's last counted check (a dispatch never counts). A 5xx, a timeout or a network error changes nothing. The terms were read on 2026-11-06 (the Terms of Use, robots.txt and the partner API's page); the owner: proceed, no partner API for now.
- A schedule that must keep running is watched by the health check: no scheduled success of the quest-page check in 35 days fails it (scripts/health/judge.ts `judgeQuestSites`).
- How to get an item is decided in one place (src/gear/howto.ts `sourceWays`: the level kinds, then source_mask, then the recorded data) and its lines are built in one place (`howToGet`); /gear upgrades, the /item card, /gear find's result lines and the recipes a page loads (pageData) all read them. Scarab Helm's card said "Unknown — source not recorded" from source_mask while its upgrade line named the quest. Not yet moved: /gear find's `source:` filter, a bitmask on the gear index (src/gear/search.ts, order 13's measured query), still reads source_mask alone; changing it is a query-cost change for its own order.
- A pull request's migration is applied before its merge by dispatching deploy.yml on the branch with `migrations_only` (it deploys no Worker), after the backup's migration dry run (backup.yml `migration_check`).

## Order 38

Order 38 profiles and fixes the Worker's CPU: the board sweep, the cold upgrade summary, and an alert on any CPU-limit error (Workers Free: 10 ms of CPU per invocation, cron included).

- Budget (explicit override of this file's "By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge."): 2 pull requests, each with at most 3 pushes, and 2 merges. PR A: ITEMs 1, 2 and 4; PR B: ITEM 3.
- CPU is measured in workerd or from Cloudflare's records. The Node proxy is not used for CPU decisions.
- A CPU fix names the function the profile showed, with its share of CPU before and after.
- Any CPU-limit error is an alert, within one daily run: the health check fails on any invocation status outside `success` and `clientDisconnected`, in either GraphQL invocation dataset, and (because GraphQL's adaptive counts are sampled) on any Workers Logs outcome outside `ok` and `canceled` when that read succeeds (scripts/health/judge.ts `judgeWorkerStatuses`, `OK_STATUSES`, `OK_OUTCOMES`). A failed GraphQL read, or one counting fewer than half the day's sweep_run rows, fails too.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 39

Order 39 is the Gear header, the class menu and full item stats (the owner's requests of 2026-11-07, 10:45 and 10:50 ET; the class menu and the slot flow are Cowork's fixes, approved by the owner's pasting of the order). Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Override 1, of the copy approved by the owner by exception on 2026-10-20, stored at docs/COPY.md:39 (src/commands/character.ts): "Class **\<class>** isn't in the class list taken from the wiki data, so it's saved as typed. (The game is in Early Access; the list may be incomplete.)"
  - A character's class is picked from a menu of the derived class list (game_class codes on items, src/commands/character.ts `GAME_CLASSES_SQL`). Nothing is saved as typed: a value that isn't a code from the list is refused (`CLASS_NOT_LISTED`), so a stale form can't save one.
  - The list grows by itself through the import (order 13's `vocab_drift` warning and re-registration), so a new class reaches the menu without anyone typing it.
  - Characters already saved with a class the data doesn't know keep it, unchanged; nothing is rewritten, not even an exact full name such as "Ranger" (order 4's rule stands). Members fix their own characters through the menu.
- Override 2, of docs/PRD.md's (at a16ec03, line 999) "each result has its name and gain, up to three stat differences (largest weighted effect first, signed), and how to get it by its level kinds, primary first" and of its line 1033's "with the upgrade's own lines above it (its gain for that character's slot, the breakdown and how to get it)".
  - A result in a slot's list shows the item's full stat line, every changed stat marked (src/gear/statline.ts `markedLine`).
  - The summary line and Pick a result's own lines show every changed stat, marked, and no unchanged ones.
  - Order 36's "A score is always explainable. Each result shows the stat differences that produced it." stands: the full marked line meets it.
- Classes are picked from the derived list; a stored unknown class is kept, never rewritten.
- A select whose pick needs typing updates its message in place before opening a box (Discord sends nothing when a box is dismissed, so an answer to the box alone can never reset the select). The Gear panel's Change a slot does (src/gear/wear.ts `slotView`), and its box's submit edits the panel (src/interactions.ts `planFor`, `WEAR_SUBMITS_IN_PLACE`).
- One shared character head (src/commands/character.ts `characterHead`): the Gear panel, the character card (without the name, its title), the add/edit replies and `/gear upgrades`.
- One shared stat line, the same on the card and the list (src/gear/statline.ts `statParts`, read by src/commands/find.ts `statFields` and by `/gear upgrades`).
- A changed stat is never hidden: a stat the replaced item has and the candidate lacks reads "— ▼−n".
- Failed runs: every one is listed in the FINAL (order 12).

## Order 40

Order 40 makes each paired side its own slot in `/gear upgrades` (the owner, 2026-11-07, 13:16–13:17 ET, reversing the 10:50 ET decision recorded in order 39, "paired slots stay as built") and fixes the CPU script's labels. Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Override 1, of docs/PRD.md:995 (at 3210464): "Paired slots (Ear, Wrist, Finger) are one slot each (17 in all); a candidate compares with the weaker side and says which side it replaces; an item worn on the other side is still a candidate."
  - Every one of the 20 wear slots is its own slot in `/gear upgrades`, including the summary, Pick a slot, `slot:`, the slot list, I'm wearing it now and Post to channel (src/gear/score.ts `UPGRADE_SLOTS`, from src/gear/slots.ts `WEAR_SLOTS`).
  - A candidate compares only with what is worn in that slot. An item worn on the other side of the pair is still a candidate (no one-per-character rule: ITEM 1.4 found no source definition of any flag).
- Override 2, of docs/PRD.md:999 (at 3210464), two phrases: "slot: (17 choices)" becomes 20 choices; "I'm wearing it now (saved through order 35's rules, the weaker side for a pair; …)" now saves to the slot whose list it came from.
- Override 3, of docs/PRD.md:1039 (at 3210464): "The slot list's header shows each worn side's full line, unmarked; each result its full line, marked against the side it replaces". The header shows that slot's worn item only (the hands unchanged: Primary's list shows Primary and Secondary, Secondary's under a two-hander shows Primary), and each result is marked against that slot.
- Override 4, of order 28's "Only ITEM 1's job contacts the wiki. Everything else reads its snapshot." (this file, "Order 28"): not lifted. Order 40's flag check read only wiki snapshots already taken (wiki-snapshot.yml run 40962576790 and import run 42354892171's artifact) and the local import, never the live wiki. It is quoted so nobody reads the flag check as permission to fetch.
- Unchanged: Primary, Secondary and two-handers (including "Secondary is then free" and "needs a one-handed Primary"), haste stacking, `/gear wear`'s own paired-slot rules (order 35: fill the empty side first, ask when both are filled) and the Gear panel.
- Old controls keep working (order 18): a pair key from before order 40 (ear, wrist, finger) in `slot:`, a Pick a slot value, `gup:` or `pub:gu:` is answered as that pair's first side, with one line naming the other side ("Wrist 2: pick it from Pick a slot."); in `gur:` both sides are searched for the picked item, "gone" only when neither has it (src/gear/score.ts `resolveSlot`, `OLD_PAIR_KEYS`, derived from WEAR_SLOTS). `guw:` always carried a slot key.
- Every wear slot is its own slot in /gear upgrades; a pair is never compared as one.
- A flag's game meaning comes only from its source's own definition, cited.
- worker-cpu.ts windows are whole UTC days; an unread schema prints unknown, never absent.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 41

Order 41 reads an unknown level top as not recorded, gathers the evidence on near-identical item names for the owner, reads the CPU after order 39's deploy, and proves the repository's credentials with rule-compliant steps (the checklist of 2026-11-07). Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Override 1, of docs/PRD.md:940 (at d025476): "Parsing level text: strip [[…]] link text and anything in parentheses first. Read every integer from 1 to 80 in what remains; low = the smallest, high = the largest. "~15" is 15–15. "N+" gives low N, high NULL. Text with no such integer is no level. Text with more than two integers is still parsed, and listed in the coverage report. Every distinct text that failed to parse is reported, with a count."
  - A bound written only as question marks is unknown. "N - ??", "N - ?" and "N-???" give low N, high NULL, as "N+" does (src/level-text.ts `UNKNOWN_TOP`, read by scripts/import/levels.ts `parseLevel`). A text that is only question marks ("?", "??") stays no level. The rest stands.
  - A number or range followed by "?" ("15?", "42-44?") parses exactly as before; its "?" is given no meaning (order 4). Every level text holding a "?" is listed in the import's coverage report with its count and reading (`levels.questionMarks`).
- Override 2, of docs/COPY.md:705 (at d025476), as stored: "| src/zone/card.ts:14 | **Levels:** \<level text> / not recorded | DRAFT |". A level text with an unknown top shows the known part and says the rest is not recorded ("1 and up (top level not recorded)"); a text of only question marks shows "not recorded"; any other text shows as recorded. One function decides it for every surface (src/level-text.ts `shownLevel`).
- Unchanged, quoted so nobody widens it: order 35's "The import now parses mob.level, npc.level and zone.level into numbers, in memory, for the item level rule (scripts/import/levels.ts `parseLevel`). The text stays as recorded in its column."
- A level bound recorded as question marks is unknown: parsed as open, shown as not recorded, never as "?".
- Names that differ only by a plural or an article are reported, never merged; the owner decides. (The import reports item titles differing only by a trailing "s": `pluralPairs`, scripts/import/core.ts `pluralOnlyPairs`.)
- A proof step never sets an environment variable for one command; it uses -c options or env -u.
- Named, not lifted (review of PR #72): order 24's "What a faction's post shows changes only through the import, which sets that faction's `changed_at` in the same statement group as the change" stands. A faction post rendered before this order keeps its old level wording ("level 18-???", "level ?") until the import next changes that faction; nothing re-renders it early. Whether to refresh those posts is the owner's call (order 41's FINAL).
- Parsing and reading judge the same text: links and parentheses are removed by one function (src/level-text.ts `stripLevelText`) for both. The Worker parses creature levels at request time (src/gear/sources.ts), so a drop line's level follows the new parse from the deploy, while stored item levels follow from the next import.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 42

Order 42 shows every member once, as their plain saved name, records four copy approvals and the precompute decision (the owner, 2026-11-08 15:03 ET). Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Override 1, of order 16's override 2 and its reason (this file, "Order 16"): "Order 16's explicit override 2: members are shown as Discord user mentions (`<@id>`, src/discord.ts `memberTag`), always sent with `allowed_mentions` that pings nobody. Every create and every edit sends `allowed_mentions` explicitly (Discord re-parses an edit without it with default allowances). The only pings permitted: a request thread's first message pings the crafters it adds; a claim message pings the requester; a Done or Cancel message pings the other party." and "A mention that pings nobody is not carried in the message's `mentions` array, in content or in an embed, so a reader whose app has not loaded that member sees `<@id>` or "@invalid-user" (discord-api-docs issues #1479, #2126, Discord staff). The name saved at the member's last command is kept beside every such mention."; as restated by order 27's override 9 ("Order 27's explicit override 9, a restatement (not a widening) of order 16's "Order 16's explicit override 2: …"" with its point "DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one."), by order 29's override 3 ("Override 3, of order 16's "Order 16's explicit override 2: …" and of order 27's override 9, a restatement (not a widening) of that same order 16 rule: "DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one."", with its points "A wishlist nudge is a direct message to a member who put that item on their wishlist, carrying a link to the auction card, not a Bid button (a press from a direct message has no server member).", "Adding an item to a wishlist is the member's opt-in, and the wishlist command says so. A refused direct message (the member blocks them) is skipped silently and counted." and "No channel message pings anyone (order 27, override 9)."), by order 32's override 6 ("Override 6, of order 16's "Order 16's explicit override 2: …", restated for Events as order 27's override 9 is for DKP: Events messages ping nobody. Every GC-Events post and edit sets `allowed_mentions: {parse: []}`.") and by order 33's override 1 ("Override 1, of order 16's "Order 16's explicit override 2: …", of order 27's override 9 ("DKP messages ping nobody. Every create and every edit uses memberTag, with allowed_mentions set to ping no one."), and of order 32's override 6 ("Events messages ping nobody. Every GC-Events post and edit sets `allowed_mentions: {parse: []}`.")." with its points "Events may send direct messages to members on that event's roster: a reminder, a promotion, a time change and a cancellation (docs/PRD.md, "Who gets which message").", "A refused direct message (50007) is skipped silently and counted.", "No channel message pings anyone. `allowed_mentions` stays empty everywhere." and "A direct message carries only that event's card data and the recipient's own sign-up."). (Each "…" stands for order 16's override 2, quoted in full above.)
  - A member is shown as their saved name, in plain text (markdown-escaped), never as a mention and a name together (src/discord.ts `memberTag`, the one function). With no saved name (none held, empty, or the member's own id standing in for one, as `coalesce(m.display_name, member_id)` gives) it shows the mention alone, never a raw id as text.
  - A mention appears only where a message pings that member, and only for the member it pings.
  - The request thread's first message shows plain names and pings nobody, on create and on every edit (NO_PINGS). Discord's docs do not show that an edit never notifies (docs.discord.com/developers/resources/message, Edit Message: the `mentions` array "will be reconstructed from scratch based on the new content"; the Allowed Mentions object never covers edits), so the crafters it adds are pinged by a separate short message posted right after it ("<mentions>: a new craft request for you", src/requests.ts `crafterPing`), which is never edited. Where the first message is posted late (the sweep), the ping follows it the same way.
  - Unchanged: every create and every edit sends `allowed_mentions` explicitly; who is pinged and when (the crafters a request adds, the requester on a claim, the other party on Done or Cancel); DKP and Events channel posts ping nobody; order 29's wishlist nudges and order 33's Events direct messages.
  - The rest of order 16's reason stands as a fact: an unpinged mention can show as `<@id>`, which is why it is used only as the no-name fallback.
- Override 2, of docs/PRD.md:787 (at 0143b3b), "- Roster: compact text, grouped by role with each count against its limit, then by class. Each line is Name · Cls 32 · @member (mention text, no ping).", and docs/PRD.md:865 (at 0143b3b), "- Names are shown with memberTag; nobody is pinged. None means "No-shows: none"." Names are shown as plain saved names; nobody is pinged. (No other PRD line says members show as mentions: a search of PRD.md for memberTag, mention, @member, `<@`, saved name and ping found only these two.)
- Override 3, of docs/COPY.md (at 0143b3b), each as stored:
  - :4 "Parts in angle brackets, such as \<item name> or \<character>, are filled in by the bot each time. @\<member> is a mention of a member, #\<channel> a link to a channel, @\<role> a role, \<date and time> a Discord timestamp shown in the reader's own time zone."
  - :665 "Member lines (ITEM 1, no new words): `**1.** **Character** · @member (saved name) · level` on the board (src/board/render.ts:47), the same `· @member (saved name)` after each crafter on `/item` (formerly `/craft find`; src/commands/find.ts:143) and `/roster skill` (src/commands/roster.ts:72), after the name on `/roster top` and `/roster recipes`, and the `/roster member` header `@member (saved name): N characters`."
  - :680 "| src/commands/requests.ts:262-264 | Not sent: no opted-in crafter can make it yet, so no thread was opened. Your request is kept, unsent. / Left out: / @member (name): \<why> | DRAFT |"
  - :685 "| src/requests.ts:225-229, 241-252 | First message: ## Craft request from @requester (name) (\<main>) / **\<n>. \<item>** ×\<qty> · Open / Claimed by @member / Done (@member) / Cancelled / Crafters: \<members> (or Crafters: \<n> and Crafters added: \<mentions>) / **Note:** … / **Closed:** every item is done or cancelled · cancelled · nothing was claimed in 14 days · no activity in 30 days. / -# A crafter presses **I'll craft this** to take an item (the requester is told), and **Done** when it's handed over. The requester can **Cancel**. | DRAFT |"
  - :687 "| src/commands/requests.ts:374-394, 416 | Thread notices: @requester: @crafter will craft **\<item>** ×\<qty>. · @other: **\<item>** ×\<qty> is done (marked by @member). · @other: **\<item>** ×\<qty> was cancelled by @member. · (added when the last item closes) Every item is done or cancelled, so this thread is now closed. | DRAFT |", and in :689 "You're down to craft **\<item>** ×\<qty>. @requester has been told." and in :690 "· from @requester ·" and "@…: This request was cancelled by @member, so this thread is now closed."
  - :1047 "Every string is in src/dkp/copy.ts (`DKP_COPY`), except the command and option descriptions (src/dkp/definition.ts) and the setting labels (src/dkp/settings.ts `SETTINGS`). Member mentions are `<@id> (saved name)` and ping nobody. Approved by exception when the owner's check passes."
  - :1107 "Every string is in src/dkp/copy.ts `AUCTION_COPY` (lines 57-124), except the command and option descriptions (src/dkp/definition.ts, `auction`) and the setting labels (src/dkp/settings.ts: Wins per raid · Wins per 7 days · New-member wait (kills in that pool) · Raid auction length · General auction length). Members are `<@id> (saved name)` and nobody is pinged."
  - (The order cited :675 and :683 at d025476; those rows, "**Your craft request** (not sent yet) …" and "Sent: #\<thread>. …", show members through \<members>, which now reads as plain names, and their wording is unchanged.)
  - New: "## Craft request from \<name> · \<character>", or "## Craft request from \<name>" with no character; "Done (\<name>)" becomes "Done by \<name>", matching "Claimed by \<name>". Both DRAFT (docs/COPY.md, "Order 42").
- A member is named once, by saved name; a mention appears only in a message that pings that member.
  - The presser's own saved name is the one their interaction saves (src/access.ts `displayName`), so a line naming the presser uses it with no D1 read: "Shared by" on every posted reply (src/commands/share.ts `postedReply`), the officer on a departure notice (src/commands/members.ts), a screenshot approval (src/commands/images.ts), and the one who acted in a request thread's notices.
  - Left as a single mention, because no saved name is loaded there and reading one would be a new D1 read: the event history's actor (src/events/manage.ts `historyLine`), a report card's reporter and resolver (src/commands/reports.ts), the private "has no character(s)" and "has never used GuildCraft" replies (src/commands/character.ts, src/commands/members.ts), and a DKP correction's and history page's member (src/dkp/raid.ts, `memberTag(member, null)`).
  - Known limit: the crafters' ping is its own message, sent once. If it alone fails, it is not sent again (that would need state the request rows don't hold); the requester's reply says so.
- The cold Find upgrades summary is not precomputed (owner, 2026-11-08). Revisit only if the daily Worker-status alert reports a CPU-limit error or the guild count grows; B11 and order 13's mask design stand. (Order 38's proposal is not recorded in docs/PRD.md: a search for precompute, cold and "order 38" found none, so nothing there is marked declined.)
- A posted page carries no line that points at a menu it doesn't have: `pub:gu:` posts an old pair key's first side without "\<other side>: pick it from Pick a slot." (src/gear/upgrades.ts `postUpgrades`); private pages keep it.
- Failed runs: every one is listed in the FINAL (order 12).

## Order 43

Order 43 adds a Filter to one slot's upgrade list, by minimum AC and (weapon slots) minimum ratio, and the same floors as `/gear upgrades` options (Brian, 2026-11-08 15:23–15:58 ET: "One slot at a time is fine."). Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Explicit override 1, of docs/PRD.md:999 (at b26b53f), quoted in full: "**`/gear upgrades`** `character:` (the member's own; required when they have several) `slot:` (20 choices, order 40) `levels:` (0–60). Find upgrades on the Gear panel opens the same summary. The summary (no slot) has at most 8 lines: the Around slots' smallest candidate with its gain and source kind, smallest first; then "nothing around your level · next: <item> +<gain> (Lv …)" slots, by that level; then "only level-unknown upgrades"; a footer counts what didn't fit and the slots with nothing better; Pick a slot opens a list. One slot's list: 5 a page, the three groups in order, each headed, under a header of what's worn and its score; each result has its name and gain, its full stat line with every changed stat marked (order 39's override 2: bold, ▲/▼ and the difference, against what it replaces; a lost stat as "— ▼−n"; the summary shows the changed stats only), and how to get it by its level kinds, primary first (Drop: the lowest-level mob, its zone and level, "+N more"; Crafted: tradeskill, trivial, up to three Reliable members with their skill, or "You can make this (…)" first, or "No Reliable crafter in the guild yet"; a floor "Lv 14+"; Vendor: any level; Harvest: any level; Quest: its level). Pick a result opens a private reply with Open item, I'm wearing it now (saved through order 35's rules, to the slot whose list it came from (order 40); the list then compares against it) and Request a craft (crafted items), then up to 5 zone buttons. ◀ Smaller and Bigger ▶ page; Post to channel posts the page publicly with no buttons, and not from an officer's view of a member. Nothing to show: "Nothing beats <item> for a <Class> in <slot>." Race names show in place of codes where a confirmed name is held (src/gear/vocab.ts `RACE_NAMES`). Every result says it uses "your guild's <Class> weights"."
  - One slot's list has a Filter button; `/gear upgrades` has `min_ac:` and `min_ratio:`, which apply when `slot:` is given. A filter hides candidates below it and counts them, like `max_level:`. Scores, gains and order are unchanged.
- Explicit override 2, of that line's "Nothing to show" sentence, quoted in full: "Nothing to show: "Nothing beats <item> for a <Class> in <slot>."". It stands, and a filtered variant is added: when a floor hid every candidate, "Nothing beats <item> for a <Class> in <slot> with this filter.", with the counts.
- Explicit override 3, of order 36's "Nothing is hidden. Every usable item that scores higher than what's worn is listed, however small the gain." (this file, "Order 36") as the order 36 follow-up's override 1 left it: "With no `max_level:` (the default) it stands. With one, items whose level is above it are not listed; the list ends with a quiet count of them ("9 more above Lv 30 not shown"), and the summary's footer carries the same count. Items with no level are always listed." The order states the floors' rule as "like max_level:" without naming order 36's rule; it is named here. With no filter (the default) the rule stands; with one, items below a floor are not listed and are counted at the end of the list. The summary is never filtered.
- Applies, quoted (order 35): "A command whose shape changes is registered after its deploy, and the new code answers the old shape until then." `/gear` is registered on both copies after the merge's deploy.
- Applies (order 18): old controls keep working. A custom_id with no filter state ("c", "c<level>", a window number) reads as no filter.
- Applies (this file, "Data"): "Imported data is never invented. A value the source does not hold is stored as unknown (NULL), never guessed." An item with no recorded AC, or no ratio (NULL), does not pass a floor above 0; it is counted among the hidden, never shown as 0.
- A filter on an upgrade list only removes candidates; it never changes a score, a gain or the order.
- A missing stat never passes a floor; it is counted as hidden.
- List state (cap and filters) travels in one segment, parsed by one function; every control keeps it. (src/gear/filter.ts `listState` / `listFilter`, replacing `capState` / `capOf`; gup:, gur:, guw:, guq: and pub:gu: carry the whole segment; gum: carries it too, and its submit keeps the cap while the typed boxes replace the floors; gus: carries the cap only, because a filter is set per slot list.)
- The Filter form reads nothing itself; the press's one D1 read is the guild row every immediate answer loads (src/interactions.ts `skillSelect`), as for the other forms. A list a filter emptied keeps Filter but has no Post to channel.
- The weapon slots are one constant (src/gear/slots.ts `WEAPON_TOKENS`, `WEAPON_SLOTS`), read by scoring's `ratioCounts` and by the Minimum ratio box; the box goes by slot token, never by the class preset.
- The floors are judged on the candidate's own stats: AC from its score vector, the ratio from item.ratio exactly (added to the gear index's one query, src/gear/index.ts `GEAR_INDEX_SQL`), never the rounded RATIO the score uses.
- Failed runs: every one is listed in the FINAL (order 12).
- Addendum: /roster top shows '<character> <level> (<owner>)' (owner, 2026-11-08 21:10 ET); at the worst case it overflows into fitLines' '+N more', as before.
  - Explicit override of docs/COPY.md:276 (at 299bd87), quoted with its status: "| src/commands/roster.ts:190 | **\<tradeskill>**: \<character> \<level> · \<character> \<level> · \<character> \<level> | APPROVED (owner, by exception, 2026-10-20) |". The row is now DRAFT, until Brian's check.
  - Unchanged, quoted (this file, "Order 42"): "A member is named once, by saved name; a mention appears only in a message that pings that member."

## Order 44

Order 44 links each worn item on the Gear panel to its wiki page and adds View an item, which opens a worn item's /item card privately (Brian, 2026-11-09 10:04 ET, approved 10:10 ET: "Yes, please do"). Its explicit overrides each quote the earlier text in full, from where it is stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Explicit override 1, of docs/PRD.md:948 (at bf47ee1), quoted in full: "- **Gear on `/me`:** each character card gets a Gear button. It opens a private panel: the character head (order 39: "**\<name>** · \<Class name> · level \<n> · \<Race name>", the one head every surface uses); the 20 slots and what's in each; how many are filled; a Change a slot menu. (Part 2 adds Find upgrades.)"
  - The head (and any note above it) is the message content; how many are filled and the 20 lines are one embed (description up to 4,096; its links don't unfold previews). Each worn item's name links to its wiki page, when it has an https one. A third row, View an item, lists the worn items still listed and opens each one's /item card privately.
- Explicit override 2, of docs/PRD.md:949 (at bf47ee1), quoted in full: "- **Changing a slot from the panel (order 39):** picking a slot updates the panel in place to that slot (what it holds, with Type the item, Empty slot when it is filled, and Back), and the Change a slot menu shows its prompt again. Type the item opens a box for the item name (a Discord modal; autocomplete is not available in modals). The box is optional: submitting it blank empties the slot. Every answer edits the same panel, never a new message: one exact match (name, case-insensitive) that fits the slot and the character saves it, and the panel returns with the saved line on top; a refusal (the class or race can't use it, it doesn't fit, Secondary under a two-hander) and no match say so on the slot's view; several matches, including two items with the same name, show a menu of up to 24 on the slot's view, sorted by name and told apart by slot and classes, plus "N more: type more of the name" when there are more. Never sorted by stats."
  - Added: the slot's view is message content only (embeds sent empty, no View an item), and its name is not linked there, because a link in content unfolds a preview; the only documented way to stop that on an edit, the SUPPRESS_EMBEDS flag (docs.discord.com/developers/resources/message: "The `SUPPRESS_EMBEDS` flag can be both set and unset"), is dropped from every edit by src/respond.ts `editBody`. Back and every save return the panel with its embed, links and View an item. The rest stands.
- Explicit override 3, of docs/COPY.md:1300 (at bf47ee1), quoted with its status: "| src/gear/wear.ts:57-95 (order 35; see order 36 below) | Every saved-gear string (WEAR_COPY): the panel head "\<name> · \<class> · level \<n> · race \<code>/any race", "\<n> of 20 slots filled", "—", "*(no longer listed)*", "*(\<class> can't use)*", Change a slot, the box (\<Slot>: type the item · Item name · Leave blank to empty the slot), Type again, Gear, no match, "\<n> \<slot> items match. Pick one:", "\<n> more: type more of the name", the save/replace/empty replies, the two-hander lines, the class and race refusals, doesn't go in, isn't worn, no item called, which character, which slot, both sides filled, several characters, "Changed by \<officer>", I'm wearing this, That character no longer exists., the not-yours replies | DRAFT; the panel head and "Type again" RETIRED by order 39 (see "Work order 39") |". The words stand; "\<n> of 20 slots filled" and the 20 lines move into the embed, each worn name linked (docs/COPY.md, "Order 44").
- Explicit override 4, of docs/COPY.md:1361 (at bf47ee1), quoted with its status: "| src/gear/wear.ts:82-86 | (Gear panel, the slot view) Type the item · Empty slot · Back · "**\<Slot>:** \<item>" / "**\<Slot>:** empty" | DRAFT |". The words stand; the slot view is content only and its \<item> is not linked (override 2's addition).
- Unchanged, quoted so nobody reads the layout change as touching it: docs/PRD.md:1038 (at bf47ee1), "- **One character head** (src/commands/character.ts `characterHead`): "**\<name>** · \<Class name> · level \<n> · \<Race name>" on the Gear panel, the add/edit replies and `/gear upgrades`; the character card drops the name (it is the card's title). The class by its name (Ranger, not RNG); "no class", "no level", "any race" when unset. A stored class outside the game's list shows as stored with "(not a game class: edit on /me)"; its gear is filtered as any class and scored with the default weights, and `/gear upgrades` says "Uses default weights: no game class saved. Pick one on /me."", and this file's order 39 rule, "One shared character head (src/commands/character.ts `characterHead`): the Gear panel, the character card (without the name, its title), the add/edit replies and `/gear upgrades`." The panel's content is that head.
- Applies, not overridden: order 22's "Interaction replies never send it" (content ""). Every panel and slot-view form sends a non-empty content (the head) and an explicit embeds (the slot view's []), because a Discord edit keeps every field it does not send (order 22), so an old content-only panel is replaced whole.
- Applies (order 18): old controls keep working. Every wr*: and guf: custom_id is unchanged; wrx: is new, with its routing test beside the feature's (test/worker/order44-gear-links.test.ts, order 23).
- A worn item's name links to its wiki page when it has one; a gone or missing item is never linked.
  - One https rule for every wiki link on an item name (src/gear/wiki-link.ts `wikiHref`, read by the gear index's `toItem` and the panel's `slotText`), and one link builder (`wikiLinked`, with `linkUrl`'s parentheses encoding).
- View an item opens the same /item card as Open item, from one shared function (src/commands/item.ts `itemCardReply`, also /item's own reply).
  - Its options are valued by slot key, never item id (both sides of a pair can hold one item, and equal option values would make Discord refuse the whole panel); a pick reads the slot's saved row again (src/gear/wear.ts `wornItemId`).
- The Gear panel never truncates mid-line; lines that don't fit lose their link first.
  - From the bottom up (src/gear/wear.ts `panelText`); at the data's worst case every line keeps its link (3,316 of 4,096 characters: 20 lines of the longest name, 44, and the longest address, 90, with the can't-use mark). Only if the plain lines could pass 4,096 do whole lines go, with "+N more".
- Failed runs: every one is listed in the FINAL (order 12).

## Order 45

Order 45 diagnoses and fixes the error reply sent after a Change a slot pick that Discord applied (Cowork's check of order 44, 2026-11-09 19:17–19:18 UTC). Its explicit override quotes the earlier rules in full, from where they are stored.

- Budget: this file's default (1 pull request, at most 3 pushes, 1 merge).
- Explicit override 1, of this file's order 15 rule, quoted in full: "A dispatch is made only to confirm a fix and only when it is expected to pass; a run expected to fail is never dispatched. Every failed run is listed in the report with its reason." and of order 12's "Don't dispatch a run you expect to fail. Test locally first, and dispatch only to confirm." For ITEM 1 only: one read-only dispatch of timings.yml (copy both, hours 72, requests true), expected to pass (run 42682954628, passed). The rest of both rules stands.
- A delivery that times out is checked before the member is told it failed. An edit with no answer (status 0: our 10 s abort or a network error) or a 5xx is read back once (GET @original, src/respond.ts `readBack`); the error is sent only when the read fails or the message does not show the edit (`editLanded`: the content sent, ends trimmed, and edited after the interaction was created, or for a type 5 message no longer "thinking"; an edit sent without content is never judged landed). A 4xx is a refusal and is never re-checked. The error reply itself is never read back.
- One deadline bounds every webhook call of a deferred run: 30 s from when the Worker received the interaction, less 1 s (`deadlineFrom`). The reply's own calls end 8 s before it (`ERROR_RESERVE_MS`), so each error call (a public type 5 error is a delete and a follow-up) keeps its 4 s (`ERROR_CALL_MS`); a read-back runs only when it and the error still fit (`canReadBack`). test/worker/order45-delivery.test.ts walks the worst case for handler times up to 20 s.
- Unchanged, quoted (src/respond.ts): "Never silent: an exception, or a delivery Discord refuses, logs Discord's answer and sends the polite ERROR_REPLY privately."
- Known limits: a follow-up (POST) with no answer cannot be read back (Discord returns its id only in the answer), so it still sends the error. An edit that landed but whose read-back fails is followed by the error, which on a type 5 defer replaces (private) or removes (public) the reply: the member is told to try again, never left without an answer.
- Failed runs: every one is listed in the FINAL (order 12).
