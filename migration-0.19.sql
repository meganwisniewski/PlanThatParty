-- Comments and attachments on tasks.
CREATE TABLE IF NOT EXISTS task_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_name      TEXT,
  author_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS task_attachments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name       TEXT,
  mime       TEXT,                          -- e.g. image/jpeg, application/pdf
  url        TEXT,                          -- external link (when not an uploaded file)
  data       TEXT,                          -- data URL for an uploaded file
  created_at TEXT DEFAULT (datetime('now'))
);
