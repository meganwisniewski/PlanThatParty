-- Task discussion + attachments on the task detail panel. (Already present on
-- the live DB; this covers any deployment that doesn't have the tables yet.)
CREATE TABLE IF NOT EXISTS task_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  author_name      TEXT,
  author_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS task_attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  name       TEXT,
  mime       TEXT,
  url        TEXT,
  data       TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
