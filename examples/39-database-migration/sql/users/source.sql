-- Run with psql as the master user of the source (RDS for PostgreSQL).
-- The password is the one in the stack's SourceSecretArn. Set it with
--   \password dms_source
-- so that it is neither typed into a statement nor written to a log.
CREATE ROLE dms_source LOGIN;

-- What the AWS DMS documentation requires of the user on an AWS-managed source.
GRANT rds_superuser TO dms_source;
GRANT rds_replication TO dms_source;

-- Where the endpoint's WAL heartbeat keeps its table (HeartbeatSchema).
CREATE SCHEMA IF NOT EXISTS dms_heartbeat AUTHORIZATION dms_source;
