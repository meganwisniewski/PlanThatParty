-- Idempotency keys so a double-tapped / retried "add" can't create duplicate
-- ideas or people. The client sends a per-form client_token; the API returns
-- the first row for a repeat token instead of inserting a twin. The partial
-- unique index makes it safe even for concurrent submits.
ALTER TABLE ideas ADD COLUMN client_token TEXT;
ALTER TABLE people ADD COLUMN client_token TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_ideas_token ON ideas(client_token) WHERE client_token IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_people_token ON people(client_token) WHERE client_token IS NOT NULL;
