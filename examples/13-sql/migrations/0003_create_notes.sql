-- The id is a random UUID made by the application: no sequence to coordinate,
-- and writes spread over the key range.
CREATE TABLE IF NOT EXISTS app.notes (
  id uuid PRIMARY KEY,
  owner text NOT NULL REFERENCES app.owners (owner),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  body text NOT NULL CHECK (char_length(body) <= 10000),
  version integer NOT NULL CHECK (version >= 1),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
