-- Order 19 (ITEM 4): Create GuildCraft channels takes a per-server lease for its run, as board_lock_until does for a
-- board refresh (0005): "<expiry ISO>#<random>", taken with one conditional UPDATE, so a second press while the first is
-- still creating channels is refused instead of duplicating them. Rollback: scripts/rollback/0015_channel_setup_lock.down.sql.
ALTER TABLE guild ADD COLUMN channel_setup_lock_until TEXT;
