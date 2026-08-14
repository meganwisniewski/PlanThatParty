-- Freeform per-person notes for co-hosts: interests, what they've offered to
-- help with, or any handy context — distinct from channel_notes (how to reach
-- them). Surfaced on each person's card and editable from the person modal.
ALTER TABLE people ADD COLUMN notes TEXT;
