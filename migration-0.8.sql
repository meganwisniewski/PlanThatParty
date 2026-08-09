-- Migration to v0.8 — photos on ideas (stored inline, compressed).
ALTER TABLE ideas ADD COLUMN thumb TEXT;
CREATE TABLE IF NOT EXISTS idea_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id INTEGER,
  data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
