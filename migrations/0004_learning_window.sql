-- Order 3 (PRD FR-3 "within 25 points below trivial (adjustable)"): the "Still learning" window of
-- /craft find, per guild. Read by src/crafters.ts crafterTier, the one place crafters are tiered.
ALTER TABLE guild ADD COLUMN learning_window INTEGER NOT NULL DEFAULT 25 CHECK (learning_window >= 0);
