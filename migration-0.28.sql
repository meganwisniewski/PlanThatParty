-- Events can name a host / person responsible for running them.
ALTER TABLE events ADD COLUMN assignee_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
