-- Inventory (things we already have / can access), a per-host guided-intake
-- capture, and a remembered host message group for drafting group texts.
CREATE TABLE IF NOT EXISTS inventory (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  item             TEXT NOT NULL,
  category         TEXT,
  quantity         TEXT,
  status           TEXT DEFAULT 'have',
  holder_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  holder_name      TEXT,
  area_id          INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  link             TEXT,
  notes            TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);
ALTER TABLE people ADD COLUMN intake TEXT;
ALTER TABLE party ADD COLUMN message_group TEXT;
