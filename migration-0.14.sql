-- Migration to v0.14 — free-form tags on tasks (CSV), e.g. "vendor sourcing".
ALTER TABLE tasks ADD COLUMN tags TEXT;
