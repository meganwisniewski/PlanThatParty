-- Migration to v0.11 — ideas can be flagged host-only (hidden from the
-- public and volunteer idea lists; visible only to admins/approvers).
ALTER TABLE ideas ADD COLUMN admin_only INTEGER DEFAULT 0;
