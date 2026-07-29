-- Migration to v0.2 — adds relational "facts" model to an existing database.
-- Non-destructive: only ADD COLUMN + targeted UPDATE/INSERT. Safe to run once.

ALTER TABLE party ADD COLUMN theme TEXT;
ALTER TABLE party ADD COLUMN headcount_target INTEGER;
ALTER TABLE party ADD COLUMN budget_target REAL;

ALTER TABLE tasks ADD COLUMN parent_id INTEGER;
ALTER TABLE tasks ADD COLUMN percent INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN links_field TEXT;

-- Link existing tasks to the facts they produce.
UPDATE tasks SET links_field = 'event_date'
  WHERE title = 'Lock the party date & time' AND links_field IS NULL;
UPDATE tasks SET links_field = 'budget_target'
  WHERE title = 'Set the budget' AND links_field IS NULL;
UPDATE tasks SET links_field = 'theme'
  WHERE title IN ('Decide the theme', 'Decide the theme & decor plan') AND links_field IS NULL;

-- Add the fact-producing tasks that the original seed lacked.
INSERT INTO tasks (area_id, title, description, priority, links_field)
SELECT a.id, 'Set the start time', 'When do doors open?', 'normal', 'start_time'
FROM areas a WHERE a.name = 'Logistics & Timeline'
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE links_field = 'start_time');

INSERT INTO tasks (area_id, title, description, priority, links_field)
SELECT a.id, 'Confirm the location', 'Address or venue for the party', 'high', 'location'
FROM areas a WHERE a.name = 'Logistics & Timeline'
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE links_field = 'location');

INSERT INTO tasks (area_id, title, description, priority, links_field)
SELECT a.id, 'Set the headcount target', 'Roughly how many people are we planning for?', 'high', 'headcount_target'
FROM areas a WHERE a.name = 'Guests & Invites'
  AND NOT EXISTS (SELECT 1 FROM tasks WHERE links_field = 'headcount_target');
