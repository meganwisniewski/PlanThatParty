-- Migration to v0.7 — editable calendar details + no-notification-by-default.
ALTER TABLE party ADD COLUMN cal_details TEXT;
