-- Migration to v0.10 — ideas can carry a reference link (a URL to a build,
-- product, or inspiration image).
ALTER TABLE ideas ADD COLUMN link TEXT;
