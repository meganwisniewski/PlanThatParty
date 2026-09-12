-- #43: host-provided guiding / source / reference images pinned to a zone.
CREATE TABLE IF NOT EXISTS zone_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  zone_id    INTEGER NOT NULL,
  name       TEXT,
  data       TEXT NOT NULL,
  thumb      TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
