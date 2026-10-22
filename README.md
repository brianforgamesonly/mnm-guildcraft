# mnm-guildcraft

A Discord bot for a Monsters & Memories guild: who can craft what, tradeskill rosters, and a forum board.
It runs on Cloudflare's free tier (one Worker plus a D1 database). GitHub Actions loads the recipe data each night.

- **Specification:** [docs/PRD.md](docs/PRD.md). **Binding rules:** [docs/STANDING-report-contract.md](docs/STANDING-report-contract.md) and [docs/ORDER-RULES.md](docs/ORDER-RULES.md).
- **Status:** dev and production copies; no guild has installed yet. Commands (work order 18): `/me`, `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`, `/officer` and `/guildcraft`.

## Stack

TypeScript Cloudflare Worker with [Hono](https://hono.dev), Discord request verification using [discord-interactions](https://github.com/discord/discord-interactions-js) (Ed25519 via WebCrypto), and raw SQL through Wrangler D1 migrations (no ORM). Tests use Vitest in workerd via `@cloudflare/vitest-plugin`.

## Setup

No credential lives on a developer machine. Everything remote runs in GitHub Actions from repository secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_BOT_TOKEN`, `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY` and `DISCORD_TEST_GUILD_ID`.

```sh
npm ci
npm run typecheck && npm test        # workerd + local D1, no network
npm run db:migrate:local             # schema into the local D1
npm run import:local                 # mnm-tools wiki.json -> local D1 (add -- --dry-run to preview)
```

| Workflow | Trigger | Does |
|---|---|---|
| `ci.yml` | pull request | typecheck and tests |
| `provision.yml` | dispatch | creates the dev D1 if missing; prints its ID for `wrangler.jsonc` |
| `deploy.yml` | push to main, dispatch | remote migrations, deploys `mnm-guildcraft-dev`, sets the Discord key and token |
| `import.yml` | daily 07:30 UTC, dispatch (dry run by default) | loads recipe data into the dev D1 |
| `register-commands.yml` | dispatch | registers commands on the test server and sets the interactions endpoint |

## Data import

`scripts/import/` fetches `mnmdb/wiki.json`, pinned to the commit that last changed it, and checks its structure before anything is written. It then upserts tradeskills, items, recipes and components, writing only the rows that changed. The data version is recorded as `<commit sha> / <generatedAt>`. Recipes that disappear upstream are set inactive and never deleted. Unknown trivials stay NULL.

`recipe.source_key` is `<tradeskill>|<result item, lower-case>|<variant>`. A variant keeps its number when its components change (see `assignVariants` in `scripts/import/core.ts`).

## If the Bash hook blocks everything

`.claude/hooks/check-bash.mjs` runs before every Bash call in Claude Code and fails closed: if it cannot check a command, it blocks it. Since order 8 the hook entry also sets `"onFailure": "block"` (Claude Code 2.1.295 or later), so a hook that cannot even start (node missing, a bad path) blocks too. If a broken hook ever blocks every Bash call, either:

- edit `.claude/settings.json` with Claude Code's file tools (Edit or Write, which the hook does not cover) to remove or fix the hook entry; or
- start Claude Code with all hooks off: `claude --settings '{"disableAllHooks": true}'`.

Then fix the hook and run `npm run test:hook`.

## Credits

- Item and recipe data: the [Monsters and Memories Wiki](https://monstersandmemories.miraheze.org/), licensed [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/).
- Data extraction: [mnm-tools](https://github.com/Boisteroux/mnm-tools) by Boisteroux, MIT licence. This project reads its `mnmdb/wiki.json` and, for `/zone`, `mnmdb/maps.json` (zone names and map markers).
- Zone and NPC data for `/zone`: [Mo Betta](https://github.com/amyklindley/mo-betta-quests) by Amy Lindley, MIT licence for its code. Its `zones.json` and `npcs.json` are taken from the Monsters and Memories Wiki, whose contributors hold them under that wiki's CC BY-SA licence.
- Maps: [MnM Atlas](https://www.mnmatlas.com/), an illustrated fan atlas, and the original map authors it credits. `/zone` links to its maps by id (from its `data/maps.json`) and, as its [embed page](https://www.mnmatlas.com/embed/) asks, credits "MnM Atlas" and the original map authors. MnM Atlas's maker granted permission to show its zone images, credited, on 2026-10-21 (reported by the owner).
- Zone links on `/zone` (links only; none of their content is shown): [monstersandmemories.wiki](https://monstersandmemories.wiki/zones) and [Stories of MnM](https://storiesofmnm.com/zones/).
