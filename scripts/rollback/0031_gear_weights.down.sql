-- Rollback of migrations/0031_gear_weights.sql (order 36, PR B): the stored weight and setting changes go; every server is
-- back on the defaults in code.
DROP TABLE gear_setting;
DROP TABLE gear_weight;
