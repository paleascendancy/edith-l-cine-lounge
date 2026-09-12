BEGIN;

CREATE TABLE IF NOT EXISTS rimuru_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rimuru_audit (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  group_id text,
  event_type text NOT NULL,
  operation_key text UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS rimuru_audit_event_time_idx
  ON rimuru_audit(event_type, occurred_at DESC);

COMMIT;
