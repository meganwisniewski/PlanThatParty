-- Theme & Zones page: the finalized party theme, a decor concept per house
-- zone, and uploaded floor-plan images.
ALTER TABLE party ADD COLUMN theme_concept TEXT;      -- the finalized theme, in a sentence or two
ALTER TABLE party ADD COLUMN theme_mood TEXT;         -- the overall mood/aesthetic
ALTER TABLE party ADD COLUMN theme_inspiration TEXT;  -- references / inspirations

CREATE TABLE IF NOT EXISTS zones (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  vibe       TEXT,                          -- cute | unsettling | scary
  decor      TEXT,                          -- freeform decor notes for the zone
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS floorplans (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT,
  data       TEXT NOT NULL,                 -- image data URL
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
