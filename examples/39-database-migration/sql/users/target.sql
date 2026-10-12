-- Run with psql as the master user of the target (Aurora PostgreSQL), after
-- sql/target/0001_schema.sql. Set the password from TargetSecretArn with
--   \password dms_target
CREATE ROLE dms_target LOGIN;

-- The minimum the AWS DMS documentation lists for a PostgreSQL target.
-- Replace `postgres` if the database has another name.
GRANT CONNECT ON DATABASE postgres TO dms_target;
GRANT CREATE ON DATABASE postgres TO dms_target;
GRANT USAGE ON SCHEMA app TO dms_target;
GRANT CREATE ON SCHEMA app TO dms_target;
GRANT UPDATE, INSERT, SELECT, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA app TO dms_target;
