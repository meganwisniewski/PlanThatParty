-- Host mentions: tagging a host in a task/idea comment drops a row here, which
-- surfaces as a subtle notification banner for that host.
CREATE TABLE IF NOT EXISTS mentions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id  INTEGER REFERENCES people(id) ON DELETE CASCADE,
  kind       TEXT,        -- task_comment | idea_comment
  ref_id     INTEGER,     -- the task/idea id
  actor_name TEXT,
  text       TEXT,
  seen       INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
