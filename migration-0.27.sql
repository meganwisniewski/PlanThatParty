-- Guest contact fields (both optional) + used by bulk paste import/export and
-- the Apple Shortcut sync bridge.
ALTER TABLE guests ADD COLUMN phone TEXT;
ALTER TABLE guests ADD COLUMN email TEXT;
