-- Apply in the Supabase SQL Editor before deploying the matching application
-- code. Connections/users live in Firestore, so these identifiers deliberately
-- have no Postgres foreign keys.

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS client_uuid text;

-- Hot path: load a connection's newest messages and paginate backwards.
CREATE INDEX IF NOT EXISTS messages_connection_created_at_idx
  ON public.messages (connection_id, created_at DESC);

-- Idempotency for retries after a lost HTTP response.
CREATE UNIQUE INDEX IF NOT EXISTS messages_connection_sender_client_uuid_idx
  ON public.messages (connection_id, sender_id, client_uuid);

-- Read receipts are stored beside messages.
CREATE TABLE IF NOT EXISTS public.chat_read_receipts (
  connection_id bigint NOT NULL,
  user_id bigint NOT NULL,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (connection_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_read_receipts_user_connection_idx
  ON public.chat_read_receipts (user_id, connection_id);

ALTER TABLE public.chat_read_receipts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.chat_read_receipts FROM anon, authenticated;

-- Batched latest-message lookup for the messages list.
-- Deleted rows remain eligible, matching the existing lookup behavior.
CREATE OR REPLACE FUNCTION public.latest_messages_for_connections(
  conn_ids bigint[]
)
RETURNS SETOF public.messages
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (m.connection_id) m.*
  FROM public.messages AS m
  WHERE m.connection_id = ANY(conn_ids)
  ORDER BY m.connection_id, m.created_at DESC, m.id DESC;
$$;
