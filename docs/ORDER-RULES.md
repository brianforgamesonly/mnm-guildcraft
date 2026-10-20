# Order rules (mnm-guildcraft)

**Ported 2026-10-19 from Brian's Sunshine State Auctions rules. Rules that applied only to that project were left out.**

These rules bind alongside [STANDING-report-contract.md](STANDING-report-contract.md). Every order cites this file at a SHA and adds only new rules. A rule an order adds is committed here in the same pull request, under a heading that names the order.

## Rules

⚠ If neither of us can say what is going on and what we are trying to do, we do nothing. Never ask permission for agreed work ("Why should I have to say go?" — Brian).

Treat the clock as authoritative over any date an order states.

### Evidence and numbers

- Fix causes, never symptoms. Every report ends ROOT or BANDAGE. ROOT means the class of defect is now impossible because of a derived guard: one whose population comes from the live schema, the data or the code, never from a hand-maintained list.
- Every factual claim comes from a tool call in the same turn, or the sentence says "unverified". Adjectives are claims too ("external", "upstream", "flaky", "impossible").
- Numbers carry their predicate: X of Y, measured how, and when. Establish Y before X becomes a headline. An aggregate across runs is not a statement about any one run.
- Cite code as `file:line` at a SHA, using plain paths and never editor URLs. A claim about code is read on `origin/main` after `git fetch`.
- Prose is not state. Run the predicate; do not just read it. Read a parameter's meaning from the function itself, never from its name.
- Name the operand and check it before building on it. A mechanism an order proposes holds "unless the rows show otherwise". Verify before building, and if you refuse on evidence, say so.
- A literal search that fails is not proof of absence. Before accepting an empty result, state what you assumed about the thing you were looking for: its type, its format, and where it lives.
- "Residual", "acceptable remainder", "unclosable", "external", "blocked" and "impossible" are never accepted dispositions without primary evidence. In Brian's earlier project, all nine such claims that were examined turned out to be wrong.
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

- The target is $0 per month. Any step that would need a payment method, a paid plan or a credit card stops and goes to Brian, with the number attached.
- Every report carries its bill: GitHub Actions minutes, plus Cloudflare usage against each free-tier limit where it was measured.
- By default an order is worked in 1 pull request, with at most 3 pushes and 1 merge.

### Credentials and accounts

- Brian creates and pastes every credential himself. Neither session handles secret values.
- Never print a secret or a file holding one. Not `cat` of an env file, `echo $TOKEN`, `printenv`, or logging a config object. That includes "just the prefix". To check a secret, compare its length or shape, or check whether it is set.
- Credentials live outside every checkout. This project keeps them in GitHub Actions secrets. The local machine needs none for normal work.
- This project's GitHub, Cloudflare and Discord identities are Brian's gaming accounts. They never mix with his other projects' accounts or credentials. A command that would act as the wrong account stops.
- If a secret reaches a transcript, it is compromised. Say so plainly so Brian can rotate it.

### Commands and permissions

- Run every command through the Bash tool, never PowerShell. One command per call, unchained. No `VAR=x cmd`. No bare `git stash`.
- Python and TypeScript are written with the file tools. Heredocs carry only SQL or shell.
- Code runs from a fresh worktree on `origin/main` under `.claude/worktrees/`, never from the root checkout, which is Brian's. Never write loose files into `C:\Users\bmatt\Projects\` itself.
- A helper agent carries the order's rules, and the session answers for what the helper does.
- Quote a refusal verbatim. A second refusal of the same command stops that track and names the exact command. Permission denials are diagnosed, never shifted to Brian.
- An item that belongs to the session (a route to choose, a diagnosis to make) is never handed to Brian. Only spend, credentials, copy and product decisions are Brian's.
- Grep before opening a file, and read by line range (token discipline).

### Product

- Member-facing copy (help text, welcome messages, announcements) is drafted by the session and approved by Brian before launch.
- The PRD (`docs/PRD.md`) is the specification. A departure from it is named in the report, with the reason.
- Attribution: item data replies credit the Monsters and Memories Wiki (CC BY-SA 4.0), and the README credits mnm-tools (MIT).
- When Brian asks to understand something, lead with a plain-words explanation before the numbers.

## Added by work order 2 (characters, skills and first use)

- A member's command never reveals another member's private data. Replies about the caller are ephemeral. A name that resolves to another member's character returns the same "not found" a missing name would, unless the caller is an officer.

## Added by work order 3 (find, roster, faster, clearer)

- Measure before fixing a performance complaint. Every interaction logs one structured timing line (src/telemetry.ts), and Workers Logs stays within the free 200,000 events a day.
- An autocomplete costs at most one D1 statement per keystroke and never writes. Game-data autocomplete (tradeskills, classes, items) is public game data and is not role-gated. A cache of import-only lists refreshes within one request after a completed import.
- Search and roster replies are private by default, with Post to channel. The default is the single setting `SEARCH_REPLIES_PRIVATE` (src/commands/share.ts) while Brian's question A6 stands.
- `.claude/hooks/check-bash.mjs` blocks the forbidden Bash forms (chaining, `VAR=x cmd`, writing code files by shell, in-place sed/perl edits, `node -e`/`python -c` file writes). It is a BANDAGE, and these rules still bind where it cannot see. A hook added to `.claude/settings.json` takes effect from the next session that starts in the root checkout.

## Added by work order 4 (roster timeout and speed)

- Game meaning is never inferred from item names. Items with different names are distinct, and are never merged, aliased or described as a category, unless the source data or Brian says so (Brian, 2026-10-19: Corroded and Rusty items are not the same).

## Added by work order 5 (board, status, warm)

- The session never creates channels or posts on Brian's server. Live board posts start from Brian's own `/guildcraft setup board:`; before that, board code is verified in workerd against a mocked Discord API, and the dry run is a read-only render from live D1 (`.github/workflows/board.yml`, action `render`), with `delete` as the rollback.
- A Worker invocation that does board work (after a command, or a cron run) stops at about 40 external calls (D1 and Discord together), below the Free plan's 50 subrequests; work beyond that stays dirty for the next sweep (`src/board/api.ts` BOARD_CALL_CAP).
- This repository is public, so Actions logs are public: a log that would show guild data (display names, character names) prints pseudonyms instead.

## Added by work order 6 (alphabetical board and first keystroke)

- The bot never deletes a post or message that a member wrote, or that has member replies, without Brian's explicit approval for that action.

## Added by work order 7 (logs, hook, lag, departures)

- An order that permits something an earlier order or rule forbade says so explicitly, naming the earlier rule. Without that, the earlier rule stands, and the session stops on the conflict.
- Order 7's one explicit override of order 5's "The session never creates channels or posts on Brian's server": the bot's departure notices, posted in the review channel Brian sets with `/guildcraft setup review:`. Everything else in that rule stands.
- Workers Logs is not a complete record (order 7, ITEM 1.1: 3 of 39 invocations missing on 2026-10-19/20, against Cloudflare's own invocation analytics). A logs-based conclusion states the completeness check's result for its window (`.github/workflows/timings.yml`).
- `.claude/hooks/check-bash.mjs` cannot see a leading `cd <the current directory> &&`: Claude Code rewrites it into the call's working directory before the hook runs (order 7, ITEM 1.2). The rule against chaining still binds there.

## Order 8

- Every alarm states who is notified, how often, and what counts as its state. It re-notifies only when the state changes, at most once a day. (The nightly jobs' alarms are stated in each workflow's header; the mechanism is `scripts/ci/alarm.ts`, and the review channel's usage warning is in `src/usage.ts`.)
- Order 8's explicit override of order 5's "The session never creates channels or posts on Brian's server", extending order 7's exception: the bot's usage warnings, one line per metric whose state changes (at most once a day per metric), posted by the Worker's cron in the review channel. Departure notices continue. Everything else in that rule stands.
- Order 8's three permitted remote writes, an explicit exception to the rule against writing to the remote database: `backup_status` (`.github/workflows/backup.yml`) and `usage_daily` (`.github/workflows/usage.yml`), each dry-run first by dispatch. The usage-alert state is not a third table: it is derived from `usage_daily` and the limits (no column for a value already held), and the posted lines are recorded as `usage.alert` audit rows by the Worker, like departure notices.
- Workers Logs drops are expected: a missing log event whose invocation Cloudflare's analytics counts as a success is a platform drop, counted, never a failure (`scripts/bench/logs-check.mjs` `explainGaps`).

## Order 9

- Every member-facing string added in an order is listed in the FINAL REPORT with file:line, marked DRAFT, until Brian approves it. No guild-facing string names Brian; the operator is 'Joegandomi'.
- Order 9's explicit override of order 5's "The session never creates channels or posts on Brian's server", extending orders 7 and 8: the Worker's report cards in the review channel and screenshot re-posts (with Approve/Reject) in the vault channel Brian sets, each in response to a member's or officer's command or button, and the edits and deletions of those same bot messages when an officer acts. The session itself posts nothing live and creates no channels. Everything else in that rule stands.
- Order 9's override of order 8's "a refused import writes nothing": a refused import writes a `data_import` row with status `refused` and its reason, so the import alarm can compare one refusal with the next. The statuses are held once, in `src/import-status.ts`; every reader picks rows by a positive rule from it.
- A button on a posted (public) message answers the presser with a new private message (type 4, private), never UPDATE_MESSAGE (type 7): one member's press never changes a public post. Only officer cards and vault messages are edited in place.
