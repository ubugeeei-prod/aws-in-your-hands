-- One row per owner. `note_count` is the row every create and delete of that
-- owner writes, so two of them at once conflict instead of both passing the quota.
CREATE TABLE IF NOT EXISTS app.owners (
  owner text PRIMARY KEY,
  note_count integer NOT NULL CHECK (note_count >= 0)
);
