-- Events: the sub-events leading up to (and including) the party — movie night,
-- craft days, pumpkin carving, setup sessions, day-of activities, tear-down.
-- The base table already exists on the live DB (title/event_date/start_time/
-- location/notes/sort_order); this brings it up to date with a per-event type
-- and an optional end time. CREATE IF NOT EXISTS covers any deployment that
-- doesn't have the table yet.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  event_date  TEXT,
  start_time  TEXT,
  location    TEXT,
  notes       TEXT,
  sort_order  INTEGER DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);
ALTER TABLE events ADD COLUMN kind TEXT;      -- movie | craft | pumpkin | setup | dayof | teardown | other
ALTER TABLE events ADD COLUMN end_time TEXT;  -- optional end time
