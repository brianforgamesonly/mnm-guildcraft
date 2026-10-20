# Launch guide (DRAFT: Joegandomi approves all copy at launch, order 10)

Steps a server admin follows when GuildCraft is added to a guild's server. Started in order 8.

## Adding GuildCraft to your server

A server admin (someone with **Manage Server**) opens this link, chooses the server and presses **Authorize**:

```
https://discord.com/oauth2/authorize?client_id=<APP_ID>&scope=bot+applications.commands&permissions=292057893888
```

Discord shows the permissions GuildCraft asks for before you authorize. Each is there because GuildCraft calls something that needs it, and nothing else is asked for:

| Permission | Why GuildCraft needs it |
|---|---|
| View Channel | to see the roster board, review and vault channels you choose |
| Send Messages | to create the roster board's posts (in a forum channel, a post) and to post in the review and vault channels |
| Send Messages in Threads | to add further messages inside a board post when a tradeskill's list is long |
| Embed Links | GuildCraft's board posts, report cards and departure notices are embeds |
| Attach Files | to re-post item screenshots in the vault channel for officers to approve |
| Read Message History | to find archived board posts, and to read approved screenshots back |
| Manage Threads | to keep board posts open, pin the board's index post, and remove old board posts when the board is rebuilt |

GuildCraft does not ask for Administrator, Manage Messages, Create Public Threads or any moderation permission. It never reads members' messages. Discord's own guide to the link: https://docs.discord.com/developers/topics/oauth2 (bot authorization flow; `permissions` is "an integer corresponding to the permission calculations for the bot").

After authorizing, run `/guildcraft setup` to choose the roles and channels; it checks GuildCraft can do its job in each channel you pick and names anything missing.

## Letting officers use `/guildcraft remove-member`

**Why this is needed.** The `/guildcraft` command is registered with `default_member_permissions` = Manage Server (`src/commands/definitions.ts`), so Discord shows it only to members with Manage Server (or Administrator). An officer without Manage Server does not see `/guildcraft remove-member` at all, even though GuildCraft itself would let them use it.

**The steps** (a server admin, in the Discord app):

1. Open **Server Settings → Integrations**.
2. Next to **MNM-Guildcraft**, click **Manage**.
3. Under the command list, choose **`/guildcraft`**. Its permissions start "synced" with the app's defaults; unsync them for this command.
4. Add your **officer role** and set it to allowed (✓). Save.

Source: Discord's developer documentation, Application Commands → Permissions: "The command permissions interface can be accessed in the client by navigating to `Server Settings` > `Integrations`, then clicking `Manage` to the right of an installed app. At the top of the interface, users can edit permissions for a specific user, role, or channel. By default, these top-level permissions will apply to all of an app's commands. However, each permission can also be unsynced and customized for individual commands" (https://discord.com/developers/docs/interactions/application-commands#permissions). Discord's blog says the same: "Just head to Server Settings → Integrations and then click 'Manage' next to an app" (https://discord.com/blog/slash-commands-permissions-discord-apps-bots). Discord's support article on command permissions (https://support-apps.discord.com/hc/en-us/articles/26501869403159-Command-Permissions) could not be read (HTTP 403), so the exact labels in steps 3 and 4 are **unverified**: look for the `/guildcraft` command in the list on the app's Manage page, and a way to add a role to it.

**What the officer role then sees: probably every `/guildcraft` subcommand.** Discord attaches permissions to a command, and `setup`, `status`, `rebuild-board` and `remove-member` are subcommands of the one `/guildcraft` command. No Discord page we found describes permissions per subcommand, so this is **unverified**: granting the role `/guildcraft` probably shows it all four.

That is safe, because GuildCraft checks every subcommand itself, whatever Discord shows (`src/interactions.ts`):

| Subcommand | Who GuildCraft lets run it |
| --- | --- |
| `/guildcraft setup` | admins only (Administrator or Manage Server) |
| `/guildcraft status` | admins only |
| `/guildcraft rebuild-board` | admins only |
| `/guildcraft remove-member` | officers (the officer role set with `/guildcraft setup officer_role:`), and admins |

An officer who tries `setup`, `status` or `rebuild-board` gets a private "admins only" reply, and nothing changes.

**Keep the grant.** Discord's documentation warns: "Deleting or renaming a command will permanently delete all permissions for the command" (same page, "Edit Application Command Permissions"). GuildCraft registers its commands with Discord's bulk overwrite (`PUT …/commands`, `scripts/discord/register.ts`), which should update `/guildcraft` under the same name rather than delete it, so a grant ought to survive a re-registration (**unverified** against a live grant). If `/guildcraft` is ever renamed or deleted, repeat the steps above.

## Letting officers use `/recipe source` and `/recipe override` (order 9)

`/recipe` is its own top-level command, registered with `default_member_permissions` = Manage Server, like `/guildcraft` (`src/commands/definitions.ts`). Granting it to the officer role shows officers `/recipe` without showing them `/guildcraft`.

1. Open **Server Settings → Integrations**, and next to **MNM-Guildcraft** click **Manage**.
2. Choose **`/recipe`** in the command list and unsync its permissions.
3. Add your **officer role**, allowed (✓). Save.

GuildCraft re-checks the officer role on every `/recipe` call (`src/interactions.ts`, access `officer`), so a member without the officer role who somehow sees it gets "Only officers can do that." and nothing changes. The same source and the same **unverified** labels apply as in the section above.

## The vault channel for item screenshots (order 9)

Screenshots sent with `/item image` wait in a private channel until an officer presses Approve or Reject there.

1. Create a private text channel (for example `guildcraft-vault`) that only officers and MNM-Guildcraft can see.
2. Run `/guildcraft setup vault:#guildcraft-vault`. GuildCraft checks it can View Channel, Send Messages, Attach Files and Read Message History there, and names any permission it is missing. It warns (and still saves) if @everyone can see the channel.

## Coming soon

- `/recipe add`: members record a recipe the community data lacks, kept private to the guild until an officer approves it (PRD FR-3.1). Moved to after launch by order 9.
