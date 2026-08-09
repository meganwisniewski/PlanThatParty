-- Migration to v0.13 — a host-only checklist with per-item notes. Good for
-- working through the hosts call and capturing answers inline.
CREATE TABLE IF NOT EXISTS checklist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  section    TEXT,                       -- optional grouping header
  label      TEXT NOT NULL,              -- the item / question
  note       TEXT,                       -- free-text answer / detail
  done       INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
