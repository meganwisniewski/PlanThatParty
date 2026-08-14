-- Events leading up to the party (movie night, craft days, setup, tear down…).
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  title      TEXT NOT NULL,
  event_date TEXT,                          -- YYYY-MM-DD
  start_time TEXT,
  location   TEXT,
  notes      TEXT,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);
