-- Serves "this owner's notes, newest first" without scanning the table.
-- ASYNC is Aurora DSQL syntax; the local runner drops the word for PostgreSQL.
CREATE INDEX ASYNC IF NOT EXISTS notes_owner_created_idx ON app.notes (owner, created_at, id);
