-- Per-person fantasy avatars: either a built-in token ("fx:wizard", "fx:fairy",
-- …) or an uploaded image stored as a data URL.
ALTER TABLE people ADD COLUMN avatar TEXT;
