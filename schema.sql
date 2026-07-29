-- PlanThatParty schema + starter template
-- Safe to re-run: it only seeds when tables are empty.

CREATE TABLE IF NOT EXISTS party (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL,
  event_date  TEXT,
  start_time  TEXT,
  location    TEXT,
  notes       TEXT,
  admin_pin   TEXT
);

CREATE TABLE IF NOT EXISTS areas (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  emoji       TEXT,
  description TEXT,
  sort_order  INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS people (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  email             TEXT,
  phone             TEXT,
  preferred_channel TEXT DEFAULT 'email',   -- email | sms | imessage | whatsapp | phone | in_person | calendar
  platform          TEXT,                    -- iphone | android | google | microsoft | other
  channel_notes     TEXT,
  role              TEXT,                    -- host | co-host | lead | volunteer
  share_token       TEXT UNIQUE,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'todo',           -- todo | claimed | in_progress | blocked | done
  priority    TEXT DEFAULT 'normal',         -- low | normal | high
  due_date    TEXT,
  assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS supplies (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id        INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  item           TEXT NOT NULL,
  quantity       TEXT,
  estimated_cost REAL,
  status         TEXT DEFAULT 'needed',      -- needed | claimed | purchased
  assignee_id    INTEGER REFERENCES people(id) ON DELETE SET NULL,
  notes          TEXT,
  created_at     TEXT DEFAULT (datetime('now'))
);

-- The always-available "how's this working for you?" widget writes here.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page        TEXT,
  person_id   INTEGER REFERENCES people(id) ON DELETE SET NULL,
  author_name TEXT,
  message     TEXT NOT NULL,
  sentiment   TEXT,                          -- love | idea | confusing | bug
  status      TEXT DEFAULT 'new',            -- new | reviewed | done
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ---------- Seed: the party (only if not present) ----------
INSERT INTO party (id, name, event_date, start_time, location, notes, admin_pin)
SELECT 1, 'The Annual Halloween Bash', NULL, '7:00 PM', NULL,
       'Taking over coordination this year to lighten the load for our hosts. 🎃', 'boo-2026'
WHERE NOT EXISTS (SELECT 1 FROM party WHERE id = 1);

-- ---------- Seed: planning areas (only if empty) ----------
INSERT INTO areas (name, emoji, description, sort_order)
SELECT column1, column2, column3, column4
FROM (VALUES
  ('Logistics & Timeline',   '🎯', 'Dates, schedule, run-of-show, day-of coordination', 1),
  ('Guests & Invites',       '💌', 'Guest list, invitations, RSVPs, headcount', 2),
  ('Food',                   '🍕', 'Menu, potluck coordination, dietary needs, serving', 3),
  ('Drinks',                 '🍹', 'Bar, non-alcoholic options, cups, ice', 4),
  ('Decor & Ambiance',       '🕸️', 'Decorations, lighting, fog, spooky vibes', 5),
  ('Music & AV',             '🎵', 'Playlist, speakers, projector, mic', 6),
  ('Activities & Costumes',  '🎃', 'Games, costume contest, photo booth, prizes', 7),
  ('Setup & Teardown',       '🛠️', 'Day-of setup crew, cleanup, trash, returns', 8),
  ('Safety & Comfort',       '🦺', 'Parking, rideshare, allergies, first aid, warm space', 9),
  ('Budget',                 '💸', 'Costs, reimbursements, who paid for what', 10)
)
WHERE NOT EXISTS (SELECT 1 FROM areas);

-- ---------- Seed: a starter checklist (only if tasks empty) ----------
-- Resolves area_id by area name so it stays correct regardless of ids.
INSERT INTO tasks (area_id, title, description, priority)
SELECT a.id, v.column2, v.column3, v.column4
FROM (VALUES
  ('Logistics & Timeline','Lock the party date & time','Confirm with hosts and put it on the shared calendar','high'),
  ('Logistics & Timeline','Build the day-of run-of-show','Hour-by-hour: setup, doors, food, contest, cleanup','normal'),
  ('Logistics & Timeline','Recruit volunteer leads for each area','One point-person per area so it is not all on the hosts','high'),
  ('Guests & Invites','Finalize the guest list','Get the list from hosts; estimate headcount','high'),
  ('Guests & Invites','Send invitations','Pick the invite method and send; track RSVPs','normal'),
  ('Food','Plan the menu','Decide catered vs potluck; note dietary needs','high'),
  ('Food','Coordinate potluck sign-ups','Who is bringing what — avoid five bowls of chips','normal'),
  ('Drinks','Plan drinks & quantities','Alcoholic + non-alcoholic, cups, ice, water','normal'),
  ('Decor & Ambiance','Decide the theme & decor plan','Set the vibe; make a decor shopping list','normal'),
  ('Decor & Ambiance','Schedule the decorating crew','Who decorates and when','normal'),
  ('Music & AV','Build the playlist','Collaborative playlist + backup speaker','low'),
  ('Activities & Costumes','Plan the costume contest','Categories, judges, prizes, timing','normal'),
  ('Activities & Costumes','Set up a photo spot','Backdrop + props + someone to take photos','low'),
  ('Setup & Teardown','Recruit a setup crew','People who can arrive early','normal'),
  ('Setup & Teardown','Recruit a teardown crew','People who can stay to clean up','normal'),
  ('Safety & Comfort','Sort parking & rides','Parking plan and a rideshare-home plan','normal'),
  ('Safety & Comfort','Note allergies & first aid','Collect allergy info; know where the first-aid kit is','normal'),
  ('Budget','Set the budget','Agree a number with hosts and track against it','high'),
  ('Budget','Set up reimbursements','How volunteers get paid back for what they buy','normal')
) AS v
JOIN areas a ON a.name = v.column1
WHERE NOT EXISTS (SELECT 1 FROM tasks);
