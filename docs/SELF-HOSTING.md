# Running your own copy of GuildCraft

GuildCraft's promise to your guild: if Joegandomi stops running GuildCraft, "your guild will be told in advance and handed everything it needs to run its own copy under its own accounts: the code, with setup instructions, and a full export of your guild's data."

This page is those setup instructions. It is written for a capable volunteer: someone comfortable creating accounts, copying values between web pages, and running a command or two. You do not need to write code.

Everything here stays on free plans. No step asks for a credit card. If a page ever asks you for one, stop: something has changed, and you should ask before going on.

**What you will have at the end:** your own copy of the GuildCraft bot in your Discord server, with your guild's characters, skills, known recipes, corrections and settings, running under accounts your guild controls.

**What you need from Joegandomi:** the link to the GuildCraft repository (ask Joegandomi for the link), and your guild's export: two files, `<date>.sql` and `<date>.json`.

Do the steps in order: several of them depend on the one before.

Steps marked *(unverified)* describe a screen or a behaviour that could not be checked when this was written. The rest cite the page they follow.

---

## The accounts

You need three free accounts. Use one person's accounts that the guild trusts, or a shared guild email.

| Account | What it runs | Sign up |
|---|---|---|
| GitHub | Holds your copy of the code, and runs the nightly jobs (data refresh, backup) | https://github.com/signup |
| Cloudflare | Runs the bot itself (a Worker) and its database (D1) | https://dash.cloudflare.com/sign-up |
| Discord (Developer Portal) | Your own bot identity | https://discord.com/developers/applications (your normal Discord login) |

---

## Step 1 — Copy the code (GitHub fork)

1. Open the GuildCraft repository link and press **Fork** (top right). Keep the name `mnm-guildcraft`. GitHub's guide: https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo
2. In your fork, open the **Actions** tab. GitHub disables a fork's scheduled workflows: "When a public repository is forked, scheduled workflows are disabled by default." Enable each one: select it in the left sidebar, then **Enable workflow** (https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows). If GitHub first shows a button to allow workflows on the fork, press it *(unverified: the wording of that banner)*.
3. Create a second repository for backups, **private**, named exactly `mnm-guildcraft-backup`, under the same account (https://github.com/new, choose **Private**). The backup job finds it by that name and refuses to push to a repository that is not private.

## Step 2 — Cloudflare

1. Sign in to Cloudflare. Open **Workers & Pages** once, so Cloudflare gives your account its `workers.dev` address *(unverified: the dashboard's wording; the deploy step checks it and stops if it is missing)*.
2. Note your **Account ID** (shown on the Workers & Pages overview, and in the dashboard's account menu *(unverified: where the dashboard shows it)*).
3. Create an API token: **My Profile → API Tokens → Create Token → Create Custom Token** (https://developers.cloudflare.com/fundamentals/api/get-started/create-token/). Give it these account permissions, which are what the jobs call:
   - Workers Scripts: Edit (deploy the bot)
   - D1: Edit (the database: migrations, the nightly import, backups)
   - Account Analytics: Read (the free-tier usage figures in `/guildcraft status`)
   - Workers Observability: Write (the timings check reads the bot's logs; Cloudflare lists this as the query API's permission)

   *(Unverified: the exact names Cloudflare shows for these permissions.)* "The token secret is only shown once": copy it straight into Step 4.

## Step 3 — Discord: your own bot

Discord's guide: https://docs.discord.com/developers/quick-start/getting-started

1. In the Developer Portal, **New Application**, name it (for example "GuildCraft").
2. **General Information:** copy the **Application ID** and the **Public Key** (Step 4 needs both). Leave **Interactions Endpoint URL** empty: the register job (Step 7) fills it in.
3. **Bot:** press **Reset Token**, and copy the token (Step 4). Turn on **Server Members Intent** (GuildCraft notices when a member leaves the server). Leave **Public Bot** on if other servers should be able to add it; turn it off for your guild only.
4. **Installation:** under Installation Contexts, turn **Guild Install** on and **User Install** off. GuildCraft only works inside a server.
5. Your server's ID: in Discord, **User Settings → Advanced → Developer Mode** on, then right-click your server's icon → **Copy Server ID** *(unverified: Discord's menu wording)*.

## Step 4 — Secrets (GitHub)

In your fork: **Settings → Secrets and variables → Actions → New repository secret** (https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/use-secrets). Add each of these. Never paste them anywhere else.

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from Step 2.3 |
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from Step 2.2 |
| `DISCORD_BOT_TOKEN` | the bot token from Step 3.3 |
| `DISCORD_APPLICATION_ID` | the Application ID from Step 3.2 |
| `DISCORD_PUBLIC_KEY` | the Public Key from Step 3.2 |
| `DISCORD_TEST_GUILD_ID` | your server's ID from Step 3.5 (the commands are registered there) |
| `BACKUP_REPO_TOKEN` | a fine-grained GitHub token with **Contents: Read and write** on `mnm-guildcraft-backup` only (https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) |

## Step 5 — The database

1. **Actions → provision → Run workflow.** It creates the database and prints a line `database_id=...` (not a secret).
2. In your fork, open `wrangler.jsonc` (press the pencil to edit it on GitHub), replace the `database_id` value with yours, and commit to `main`.
3. That commit starts a **deploy** run (Actions tab). **Wait until it has finished**, whether it succeeds or fails, before Step 6: it sets up the database's tables, and the export must not load while that is still running.
4. In `src/limits.ts`, set `BACKUP_TOKEN_EXPIRY_NOTE` to `'unset'` unless your `BACKUP_REPO_TOKEN` really has no expiry date. (It records the original operator's choice; with `'unset'`, `/guildcraft status` warns you 30 days before your token expires.)

## Step 6 — Load your guild's export

Load it before you add the bot to your server (Step 8), so nothing is written in between. The export's tables are created only if missing, so it loads whether or not the deploy has already set them up.

The export loads with one command from your own computer:

1. Install Node.js (the LTS version) from https://nodejs.org/.
2. Put the two export files in a folder, open a terminal there, and sign in to Cloudflare: `npx wrangler login` (https://developers.cloudflare.com/workers/wrangler/commands/#login).
3. Load it (https://developers.cloudflare.com/workers/wrangler/commands/#d1-execute), replacing the date:
   ```
   npx wrangler d1 execute mnm-guildcraft-dev --remote --file <date>.sql
   ```
   The database name is the one in your `wrangler.jsonc`. Running it from a folder without a `wrangler.jsonc` finds the database by name in your account *(unverified)*; if it says it cannot find it, run the command from your fork's folder instead.
4. Check it. The `.json` file's `tables` lists how many rows each table should hold. A guild row the database refuses stops the load with an error rather than being skipped, so an error here means: stop and ask. To compare, run this and check each number against `tables`:
   ```
   npx wrangler d1 execute mnm-guildcraft-dev --remote --command "SELECT (SELECT count(*) FROM guild) AS guild, (SELECT count(*) FROM member) AS member, (SELECT count(*) FROM character) AS character, (SELECT count(*) FROM character_skill) AS character_skill, (SELECT count(*) FROM character_recipe) AS character_recipe, (SELECT count(*) FROM recipe_correction) AS recipe_correction, (SELECT count(*) FROM audit_log) AS audit_log"
   ```

The export holds your guild's rows, and all of the shared game data (every item, recipe, tradeskill and class), which your rows point to. It holds nothing from any other guild.

No export? A brand-new copy skips this step: Step 10 fills in the game data, and your members register their characters again.

## Step 7 — Deploy

**Actions → deploy → Run workflow.** It applies any database updates newer than the export and starts the bot on Cloudflare.

## Step 8 — Add the bot to your server

Discord only lets the bot's commands into a server the bot has been added to, so this comes before Step 9. Open this link, with your Application ID in place of `<APP ID>`, choose your server and press **Authorize** (Discord: https://docs.discord.com/developers/topics/oauth2, bot authorization flow):

```
https://discord.com/oauth2/authorize?client_id=<APP ID>&scope=bot+applications.commands&permissions=292057893888
```

`292057893888` is these permissions together, each one because GuildCraft calls something that needs it:

| Permission | Why |
|---|---|
| View Channel | to see the roster board, review and vault channels |
| Send Messages | to create the roster board's posts (in a forum, a post) and post in the review and vault channels |
| Send Messages in Threads | to add messages inside board posts |
| Embed Links | GuildCraft's posts are embeds |
| Attach Files | to re-post item screenshots in the vault channel |
| Read Message History | to read archived board posts and the vault's screenshots back |
| Manage Threads | to keep board posts open, pin the index post, and remove old board posts on a rebuild |

## Step 9 — Register the commands

**Actions → register-commands → Run workflow** (leave *read only* off). It checks the bot answers safely, registers the commands in your server, and sets the bot's Interactions Endpoint URL in the Developer Portal for you.

## Step 10 — Game data

**Actions → import → Run workflow** with *dry run* on: it prints what it would write. Run it again with *dry run* off. After that it runs every morning by itself (07:30 UTC). Expect about 1,200 recipes and 5,500 items (the numbers grow with the community data).

## Step 11 — Settings and the roster board

Run `/guildcraft status` in your server. If you loaded an export, your roles and channels are already set.

The roster board's posts, the screenshots waiting in the vault and the report cards were posted by the old bot, and your bot cannot edit another bot's messages. So, if you loaded an export, do this once, best before Step 8:

1. Make the bot forget the old board posts, so it creates its own on its next 15-minute run:
   ```
   npx wrangler d1 execute mnm-guildcraft-dev --remote --command "DELETE FROM board_post; UPDATE guild SET board_index_thread_id = NULL"
   ```
   Then delete the old bot's board posts in the forum by hand (right-click a post → **Delete Post** *(unverified: menu wording)*).
2. Screenshots that were still waiting for approval, and open reports, cannot be answered with the old bot's buttons. Ask members to send those again; the old messages can be deleted by hand. Approved screenshots keep working.

Without an export, run `/guildcraft setup` to choose the roles and channels.

## Afterwards

- The jobs that keep it running are all in the **Actions** tab: `import` (game data, daily), `backup` (nightly, to your private backup repository), `usage` and `timings` (free-tier checks). GitHub emails the account owner when one fails.
- `/guildcraft status` in Discord shows the data version, the last backup and the free-tier usage.
- To give the guild's data to someone else later, the `export` workflow does what Joegandomi did for you: **Actions → export → Run workflow**, with your server's ID. It writes to `guild-exports/` in your private backup repository.
