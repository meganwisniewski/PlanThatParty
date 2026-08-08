-- Migration to v0.4 — fields for imported research-backed plans.
ALTER TABLE tasks ADD COLUMN ext_id TEXT;
ALTER TABLE tasks ADD COLUMN effort_hours REAL;
ALTER TABLE tasks ADD COLUMN core INTEGER DEFAULT 0;
