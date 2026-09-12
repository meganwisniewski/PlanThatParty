-- Multi-assignee: tasks, supplies, and events can each have several owners.
-- Stored as a CSV of people ids in assignee_ids; assignee_id is kept synced to
-- the first (primary) owner as a fallback for legacy reads.
ALTER TABLE tasks ADD COLUMN assignee_ids TEXT;
ALTER TABLE supplies ADD COLUMN assignee_ids TEXT;
ALTER TABLE events ADD COLUMN assignee_ids TEXT;
UPDATE tasks SET assignee_ids = CAST(assignee_id AS TEXT) WHERE assignee_id IS NOT NULL;
UPDATE supplies SET assignee_ids = CAST(assignee_id AS TEXT) WHERE assignee_id IS NOT NULL;
UPDATE events SET assignee_ids = CAST(assignee_id AS TEXT) WHERE assignee_id IS NOT NULL;
