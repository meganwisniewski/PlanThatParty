-- Migration to v0.9 — host-configurable public info.
-- CSV of party fields guests may see. Default: name + date + time only.
ALTER TABLE party ADD COLUMN public_fields TEXT DEFAULT 'name,event_date,start_time';
