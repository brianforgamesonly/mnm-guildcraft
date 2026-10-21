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
