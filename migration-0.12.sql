-- Migration to v0.12 — a private guest list (host-only). Informal by design:
-- the party is open, this is just a place to jot who we're expecting.
CREATE TABLE IF NOT EXISTS guests (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  status     TEXT DEFAULT 'invited',   -- invited | coming | maybe | cant
  plus_count INTEGER DEFAULT 0,        -- extra heads beyond this person
  contact    TEXT,                      -- optional email / phone / handle
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
