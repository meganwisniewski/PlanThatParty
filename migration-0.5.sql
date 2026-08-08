-- Migration to v0.5 — the Ideas pipeline (Planisware-informed stage-gate).
CREATE TABLE IF NOT EXISTS ideas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT NOT NULL,
  description         TEXT,
  submitter_name      TEXT,
  submitter_person_id INTEGER,
  area_id             INTEGER,
  category            TEXT,
  stage               TEXT DEFAULT 'submitted',
  impact              INTEGER,
  effort              INTEGER,
  decision_note       TEXT,
  promoted_task_id    INTEGER,
  created_at          TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS idea_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER,
  voter_key  TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(idea_id, voter_key)
);
CREATE TABLE IF NOT EXISTS idea_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id          INTEGER,
  author_name      TEXT,
  author_person_id INTEGER,
  body             TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now'))
);
