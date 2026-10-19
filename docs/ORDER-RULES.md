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
