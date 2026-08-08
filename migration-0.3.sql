-- Migration to v0.3 — per-person calendar reminder preference + element-targeted feedback.
ALTER TABLE people ADD COLUMN reminder_minutes TEXT DEFAULT '1440';
ALTER TABLE feedback ADD COLUMN target TEXT;
