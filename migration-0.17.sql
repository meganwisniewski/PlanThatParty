-- Associate an idea with a house zone (Theme & Zones).
ALTER TABLE ideas ADD COLUMN zone_id INTEGER REFERENCES zones(id) ON DELETE SET NULL;
