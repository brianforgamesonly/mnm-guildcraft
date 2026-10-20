-- Order 7 (ITEM 3): the departure run reads each member's latest member.* audit rows (src/departures.ts),
-- and /guildcraft status the latest departures.run row. One index serves both; no new column.
CREATE INDEX audit_by_target ON audit_log(guild_id, target, id);
CREATE INDEX audit_by_action ON audit_log(guild_id, action, id);
