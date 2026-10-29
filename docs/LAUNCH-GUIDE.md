# Launch guide (DRAFT: Joegandomi approves all copy at launch, order 10)

Steps a server admin follows when GuildCraft is added to a guild's server. Started in order 8.

## Adding GuildCraft to your server

A server admin (someone with **Manage Server**) opens this link, chooses the server and presses **Authorize**:

```
https://discord.com/oauth2/authorize?client_id=1562084361057345636&scope=bot+applications.commands&permissions=9157138795536
```

Discord shows the permissions GuildCraft asks for before you authorize. Each is there because GuildCraft calls something that needs it, and nothing else is asked for:

| Permission | Why GuildCraft needs it |
|---|---|
| View Channel | to see the tradeskills and factions forums, and the review and request channels you choose |
| Send Messages | to create the boards' posts (in a forum channel, a post) and to post in the review channel |
| Send Messages in Threads | to add further messages inside a board post when its list is long |
| Embed Links | GuildCraft's board posts, report cards and departure notices are embeds |
| Read Message History | to find archived board posts, and to read an old vault's approved screenshots back |
| Manage Threads | to keep board posts open, pin the board's index post, and remove old board posts when the board is rebuilt; to rename, close and reopen craft request threads |
| Create Private Threads | to open one private thread per craft request in the request channel |
| Manage Channels | for **Create GuildCraft channels** in `/guildcraft setup`: to create the GuildCraft category and its four channels, and to set the forums' sort order and default reaction |
| Manage Permissions (Manage Roles) | for **Create GuildCraft channels**: to add your officer role to the private channel after it exists. GuildCraft never creates, edits or assigns roles |
| Create Expressions | to add one emoji, **guildcraft** (GuildCraft's dwarf), used as the default reaction on GuildCraft's two forums. Without it the forums keep their reaction and everything else works |

GuildCraft does not ask for Administrator, Manage Messages, Create Public Threads or any moderation permission. It never reads members' messages. Discord's own guide to the link: https://docs.discord.com/developers/topics/oauth2 (bot authorization flow; `permissions` is "an integer corresponding to the permission calculations for the bot").

After authorizing, run `/guildcraft setup` to choose the roles and channels; it checks GuildCraft can do its job in each channel you pick and names anything missing.

**Or let GuildCraft create its channels (order 19).** Run `/guildcraft setup officer_role:` with your officer role, then press **Create GuildCraft channels**. It creates whichever of these are missing, in a **GuildCraft** category, and saves them (order 24): **GC-Tradeskills** and **GC-Factions**, two forums (everyone can read and reply; only GuildCraft posts), **GC-Craft Requests** (everyone can see it; private request threads only) and **GC-Officer Review** (officers, admins and GuildCraft only). Both forums are sorted by creation date and get the **guildcraft** emoji as their default reaction, and both boards start filling in. Pressing it again never duplicates anything, and a channel your server already uses is kept as it is, never renamed. The forums need **Community** turned on (Server Settings → Enable Community); without it the two text channels are created and setup says so.

## Servers that added GuildCraft before the factions board (order 24)

The **guildcraft** emoji needs **Create Expressions**, which earlier install links did not ask for. Grant it to GuildCraft's role (Server Settings → Roles → MNM-Guildcraft), or open the install link above again, choose the same server and press **Authorize**. Then press **Create GuildCraft channels** (or pick a forum with `setup board:` or `factions:`): forums with no default reaction of their own get the emoji. Without it, everything else works and the forums keep their reaction.

## Servers that added GuildCraft before Create GuildCraft channels

The button needs **Manage Channels** and **Manage Permissions**, which earlier install links did not ask for, and Discord does not add a permission to a bot already in a server. Grant both to GuildCraft's role (Server Settings → Roles → MNM-Guildcraft), or open the install link above again, choose the same server and press **Authorize**. Picking your own channels with `setup`'s options keeps working without them.

## The commands (order 18)

Members: `/me` (your characters, skills, notices and requests, with buttons to change them), `/skills`, `/item`, `/gear`, `/roster`, `/zone`, `/request`, `/help`. Officers: `/officer` (recipe-source, recipe-fix, remove-member, edit-member, requests). Admins: `/guildcraft` (setup, status, rebuild-board). `/help` shows them all, in pages.

## Servers that added GuildCraft before craft requests

Craft requests (`/request`) arrived after the first install link, and need one more permission: **Create Private Threads**. Discord does not add a permission to a bot that is already in a server, so `/guildcraft setup requests:` names it as missing. Either fix works:

1. **Grant it on the request channel:** Edit Channel → Permissions → add **MNM-Guildcraft** (its role) → turn on **Create Private Threads** (and **Send Messages in Threads**, **Manage Threads** and **Read Message History** if setup names them too) → Save. Then run `/guildcraft setup requests:` again.
2. **Or re-authorize with the link above:** open it, choose the same server and press **Authorize**. Discord updates GuildCraft's role with the new permissions; nothing else changes.

## Who can read craft requests

Each request is a private thread in the request channel. Discord shows a private thread only to the members in it, to anyone with **Manage Threads** in that channel, and to Administrators and the server owner. `/guildcraft setup requests:` names the roles that hold Manage Threads or Administrator there, so you know who else can read requests. Members also need **View Channel** on the request channel to see their thread.

## Grant `/officer` to your officer role once (order 18)

**Why this is needed.** `/officer` (recipe data, removing a departed member, editing a member's characters, every open craft request) is registered with `default_member_permissions` = Manage Server (`src/commands/definitions.ts`), so Discord shows it only to members with Manage Server (or Administrator). An officer without Manage Server does not see it until a server admin grants it to the officer role. `/guildcraft` stays admins-only: there is no need to grant it.

**The steps** (a server admin, in the Discord app):

1. Open **Server Settings → Integrations**.
2. Next to **MNM-Guildcraft**, click **Manage**.
3. Under the command list, choose **`/officer`**. Its permissions start "synced" with the app's defaults; unsync them for this command.
4. Add your **officer role** and set it to allowed (✓). Save.

Source: Discord's developer documentation, Application Commands → Permissions: "The command permissions interface can be accessed in the client by navigating to Server Settings > Integrations, then clicking Manage to the right of an installed app" (https://docs.discord.com/developers/interactions/application-commands). The exact labels in steps 3 and 4 are **unverified** (Discord's support article could not be read in order 7): look for the `/officer` command in the list on the app's Manage page, and a way to add a role to it.

GuildCraft re-checks the officer role on every `/officer` call and on every button an officer presses for someone else (`src/interactions.ts`, `src/commands/me.ts`), so a member without the officer role who somehow sees it gets "Only officers can do that." and nothing changes.

**Keep the grant.** Discord's documentation warns: "Deleting or renaming a command will permanently delete all permissions for the command". Order 18 renamed the commands before any guild installed, so no grant was lost; a grant on `/officer` survives re-registration under the same name (**unverified** against a live grant). If `/officer` is ever renamed, repeat the steps above.

## Item screenshots are off (order 24)

Members no longer send item screenshots, so there is no vault channel to set up; item cards show the wiki's own icon. A server that set a vault before keeps it as it is: screenshots already approved there still show from an old card's **Stat image**, and Approve and Reject on messages still waiting there still work. Don't delete that channel while you want those screenshots.

## Zones (`/zone`, order 17)

`/zone name:` shows a zone's card, privately, with **Post to channel**. The card has MnM Atlas's picture of the zone, its level range and a line about it, the zones next to it, its creatures by level (each with a **find on map** link to MnM Atlas), and spots from the community maps. Link buttons open the zone's page on the Monsters and Memories Wiki (**Wiki**), on monstersandmemories.wiki (**MnM Wiki**) and on Stories of MnM, the zone and world schematic (**Zone connections**), and the zone in MnM Atlas. A button appears only when that site has a page for the zone. **More creatures** pages through every creature. **Gear here** asks for your class, then shows `/gear` for that zone, by AC, with a sort menu. `/gear` also has a `zone:` option.

The data comes from the Monsters and Memories Wiki on Miraheze (CC BY-SA 4.0), MnM Atlas and mnm-tools, and updates with the nightly import. The other sites' addresses are checked one by one, by hand, when zones change (`scripts/zone/sites.ts`).

### MnM Atlas's zone pictures (operator)

MnM Atlas's maker granted permission to show its zone images, credited, on 2026-10-21 (reported by the owner). The pictures are on: the repository variable `ATLAS_ZONE_IMAGES` is `on`. Each picture is credited "Map: MnM Atlas (mnmatlas.com) and its original map authors" and linked to the zone in the atlas.

To turn them off: GitHub → the GuildCraft repository → **Settings** → **Secrets and variables** → **Actions** → **Variables** → set `ATLAS_ZONE_IMAGES` to `off`, then **Actions** → **deploy** → **Run workflow**.

## Coming soon

- `/recipe add`: members record a recipe the community data lacks, kept private to the guild until an officer approves it (PRD FR-3.1). Moved to after launch by order 9.
