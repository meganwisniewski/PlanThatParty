-- Guest handling & tracking: record which host sent each invite (so hosts can
-- filter to just their own), and a week-of "confirmed" flag.
ALTER TABLE guests ADD COLUMN invited_by_person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
ALTER TABLE guests ADD COLUMN confirmed INTEGER DEFAULT 0;
