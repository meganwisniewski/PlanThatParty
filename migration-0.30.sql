-- Sourcing/Inventory depth: free-form tags on both (cross-cutting items like
-- "build" + "decor"), and how much of a needed supply we already have.
ALTER TABLE supplies ADD COLUMN qty_have TEXT;
ALTER TABLE supplies ADD COLUMN tags TEXT;
ALTER TABLE inventory ADD COLUMN tags TEXT;
