-- PlanThatParty schema + starter template
-- Safe to re-run: it only seeds when tables are empty.

CREATE TABLE IF NOT EXISTS party (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  event_date       TEXT,
  start_time       TEXT,
  location         TEXT,
  theme            TEXT,
  headcount_target INTEGER,
  budget_target    REAL,
  notes            TEXT,
  cal_details      TEXT,                     -- editable text shown in calendar-link events
  public_fields    TEXT DEFAULT 'name,event_date,start_time', -- CSV of fields guests may see
  admin_pin        TEXT
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
  is_approver       INTEGER DEFAULT 0,       -- can moderate the ideas pipeline from their own link
  reminder_minutes  TEXT DEFAULT '',         -- CSV of minutes-before offsets for calendar alarms (empty = none)
  share_token       TEXT UNIQUE,
  created_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tasks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  area_id     INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  parent_id   INTEGER REFERENCES tasks(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  status      TEXT DEFAULT 'todo',           -- todo | claimed | in_progress | blocked | done
  priority    TEXT DEFAULT 'normal',         -- low | normal | high
  due_date    TEXT,
  percent     INTEGER DEFAULT 0,             -- 0..100
  links_field TEXT,                          -- a party fact this task fills in (event_date, location, theme, headcount_target, budget_target, start_time)
  ext_id      TEXT,                          -- stable id from an imported plan (e.g. "t4.7")
  effort_hours REAL,                         -- estimated hours
  core        INTEGER DEFAULT 0,             -- load-bearing task flag
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

-- Ideas pipeline (Planisware-informed): anyone submits, ideas move through a
-- stage-gate, and an approved idea can be promoted into a real task.
CREATE TABLE IF NOT EXISTS ideas (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  title               TEXT NOT NULL,
  description         TEXT,
  link                TEXT,                        -- optional reference URL (a build, product, or inspo)
  submitter_name      TEXT,
  submitter_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  area_id             INTEGER REFERENCES areas(id) ON DELETE SET NULL,
  category            TEXT,
  stage               TEXT DEFAULT 'submitted',  -- submitted | screening | approved | promoted | declined | parked
  impact              INTEGER,                    -- 1..5, optional score
  effort              INTEGER,                    -- 1..5, optional score
  decision_note       TEXT,                       -- why approved/declined
  promoted_task_id    INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  admin_only          INTEGER DEFAULT 0,           -- 1 = visible to admins/approvers only
  thumb               TEXT,                        -- tiny inline preview (data URL) for cards
  created_at          TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS idea_images (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
  data       TEXT,                                 -- compressed image as a data URL
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS idea_votes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id    INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
  voter_key  TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(idea_id, voter_key)
);
CREATE TABLE IF NOT EXISTS idea_comments (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  idea_id          INTEGER REFERENCES ideas(id) ON DELETE CASCADE,
  author_name      TEXT,
  author_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL,
  body             TEXT NOT NULL,
  created_at       TEXT DEFAULT (datetime('now'))
);

-- The always-available "how's this working for you?" widget writes here.
CREATE TABLE IF NOT EXISTS feedback (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page        TEXT,
  target      TEXT,                          -- the on-page element the feedback is about
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
  ('Invites & Promo',        '💌', 'Invite graphic, sharing it broadly, and a rough headcount for planning', 2),
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
-- column5 = links_field: when set, this task fills in a real party fact,
-- and completing it in the detail panel writes that fact everywhere.
INSERT INTO tasks (area_id, title, description, priority, links_field)
SELECT a.id, v.column2, v.column3, v.column4, v.column5
FROM (VALUES
  ('Logistics & Timeline','Lock the party date & time','Confirm with hosts and put it on the shared calendar','high','event_date'),
  ('Logistics & Timeline','Set the start time','When do doors open?','normal','start_time'),
  ('Logistics & Timeline','Confirm the location','Address or venue for the party','high','location'),
  ('Logistics & Timeline','Build the day-of run-of-show','Hour-by-hour: setup, doors, food, contest, cleanup','normal',NULL),
  ('Logistics & Timeline','Recruit volunteer leads for each area','One point-person per area so it is not all on the hosts','high',NULL),
  ('Invites & Promo','Estimate a rough headcount','A ballpark for planning food and drinks — people just show up, so this is only an estimate','normal','headcount_target'),
  ('Invites & Promo','Design the invite graphic','Hosts make the graphic with the date, time, and place','high',NULL),
  ('Invites & Promo','Share the invite broadly','Post it where people will see it — group chats, socials, word of mouth','normal',NULL),
  ('Food','Plan the menu','Decide catered vs potluck; note dietary needs','high',NULL),
  ('Food','Coordinate potluck sign-ups','Who is bringing what — avoid five bowls of chips','normal',NULL),
  ('Drinks','Plan drinks & quantities','Alcoholic + non-alcoholic, cups, ice, water','normal',NULL),
  ('Decor & Ambiance','Decide the theme','Set the vibe for the whole party','normal','theme'),
  ('Decor & Ambiance','Make the decor plan & shopping list','What goes where; what to buy','normal',NULL),
  ('Decor & Ambiance','Schedule the decorating crew','Who decorates and when','normal',NULL),
  ('Music & AV','Book the live DJ(s)','Confirm who is spinning and their set times','high',NULL),
  ('Music & AV','Sort DJ setup & sound','Power, table, speakers, mic — what the DJs need to bring vs. what we provide','normal',NULL),
  ('Activities & Costumes','Plan the costume contest','Categories, judges, prizes, timing','normal',NULL),
  ('Activities & Costumes','Set up a photo spot','Backdrop + props + someone to take photos','low',NULL),
  ('Setup & Teardown','Recruit a setup crew','People who can arrive early','normal',NULL),
  ('Setup & Teardown','Recruit a teardown crew','People who can stay to clean up','normal',NULL),
  ('Safety & Comfort','Sort parking & rides','Parking plan and a rideshare-home plan','normal',NULL),
  ('Safety & Comfort','Note allergies & first aid','Collect allergy info; know where the first-aid kit is','normal',NULL),
  ('Budget','Set the budget','Agree a number with hosts and track against it','high','budget_target'),
  ('Budget','Set up reimbursements','How volunteers get paid back for what they buy','normal',NULL)
) AS v
JOIN areas a ON a.name = v.column1
WHERE NOT EXISTS (SELECT 1 FROM tasks);
