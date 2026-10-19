SELECT r.id AS recipe_id, r.acquisition, r.faction, c.name AS character, m.display_name AS member, cs.level, r.trivial,
CASE WHEN r.acquisition IN ('reputation','discovery')
AND NOT EXISTS (SELECT 1 FROM character_recipe k
WHERE k.character_id = c.id AND k.recipe_id = r.id)
THEN 'recipe not confirmed'
WHEN r.trivial IS NULL THEN 'trivial unknown'
WHEN cs.level >= r.trivial THEN 'reliable'
ELSE 'still learning' END AS tier,
EXISTS (SELECT 1 FROM character_recipe cr
WHERE cr.character_id = c.id AND cr.recipe_id = r.id) AS knows_recipe
FROM recipe r
JOIN character_skill cs ON cs.tradeskill_id = r.tradeskill_id
JOIN character c ON c.id = cs.character_id AND c.deleted_at IS NULL
JOIN member m ON m.guild_id = c.guild_id AND m.discord_user_id = c.owner_user_id
WHERE r.result_item_id = ?1 AND r.active = 1
AND (r.guild_id IS NULL OR r.guild_id = ?2) -- shared + this guild's private recipes
AND c.guild_id = ?2 AND m.status = 'active'
ORDER BY CASE tier WHEN 'reliable' THEN 1 WHEN 'still learning' THEN 2
WHEN 'trivial unknown' THEN 3 ELSE 4 END,
knows_recipe DESC, cs.level DESC;
