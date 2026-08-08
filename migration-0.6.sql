-- Migration to v0.6 — idea approvers.
ALTER TABLE people ADD COLUMN is_approver INTEGER DEFAULT 0;
