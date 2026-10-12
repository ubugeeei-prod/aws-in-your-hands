-- One row per request that has been applied, written in the same transaction
-- as the change itself. A retry finds the row and returns `result` instead.
CREATE TABLE IF NOT EXISTS app.requests (
  owner text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (owner, key)
);
