-- One-off conversion of completed webhook returns to the final journal shape (#246).
-- No attempt-start evidence is invented; the old record proves only one completed attempt.
-- Invalid history stays untouched for diagnostics. Non-webhook return events are unchanged.
UPDATE run_events SET
  payload = json_object('delivery', json(CASE type WHEN 'return.delivered' THEN
    json_object('id', run_id || ':return:' || seq,
      'channel', json_extract(payload, '$.channel'), 'status', 'delivered',
      'attempts', 1, 'maxAttempts', 1, 'inFlight', json('false'),
      'acknowledgement', 'accepted', 'effectMayHaveHappened', json('true'))
    ELSE json_object('id', run_id || ':return:' || seq,
      'channel', json_extract(payload, '$.channel'), 'status', 'failed',
      'attempts', 1, 'maxAttempts', 1, 'inFlight', json('false'),
      'acknowledgement', 'unknown', 'effectMayHaveHappened', json('true'),
      'lastError', json_object('code', 'historical_failure',
        'message', json_extract(payload, '$.error'), 'retryable', json('false'), 'acknowledgement', 'unknown')) END)),
  type = 'delivery.finished'
WHERE type IN ('return.delivered', 'return.failed')
  AND CASE WHEN json_valid(payload) THEN
    json_extract(payload, '$.channel.kind') = 'webhook'
    AND json_type(payload, '$.channel.url') = 'text'
    AND (type = 'return.delivered' OR json_type(payload, '$.error') = 'text') ELSE 0 END;
--> statement-breakpoint
-- Allocate identities once for old unfinalized terminal runs that have not recorded a return.
-- The old first attempt may have happened: conservatively consume it as unknown, never not_sent.
-- Policy value generated from WEBHOOK_DELIVERY_POLICY by pnpm generate:webhook-policy.
WITH finished AS (
  SELECT r.id, r.initial_thread, v.definition, COALESCE(r.finished_at, r.created_at) AS ts,
    (SELECT node_id FROM run_events WHERE run_id = r.id AND type = 'exit.evaluated' ORDER BY seq DESC LIMIT 1) AS exit_id
  FROM runs r JOIN loop_versions v ON v.id = r.version_id
  WHERE r.finalized_at IS NULL
    AND json_valid(r.initial_thread) AND json_valid(v.definition)
    AND EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.type = 'run.finished'
      -- The terminal event can be durable while the row still says running. Ignore an old
      -- completion superseded by a resume/start or another terminal event.
      AND e.seq = (SELECT MAX(seq) FROM run_events WHERE run_id = r.id
        AND type IN ('run.finished', 'run.failed', 'run.cancelled', 'run.resumed', 'run.started'))
      AND CASE WHEN json_valid(e.payload) THEN json_type(e.payload, '$.result') IS NOT NULL ELSE 0 END)
), channels AS (
  SELECT f.id, f.ts, c.value AS channel FROM finished f,
    json_each(f.definition, '$.nodes') n, json_each(n.value, '$.config.destinations') c
  WHERE json_extract(n.value, '$.id') = f.exit_id AND json_extract(c.value, '$.kind') = 'webhook'
  UNION
  SELECT f.id, f.ts, c.value FROM finished f, json_each(f.initial_thread, '$.invocation.returnDefaults') c
  WHERE json_extract(c.value, '$.kind') = 'webhook'
), pending AS (
  SELECT c.*, ROW_NUMBER() OVER (PARTITION BY c.id ORDER BY c.channel) AS ordinal,
    COALESCE((SELECT MAX(seq) FROM run_events WHERE run_id = c.id), 0) AS last_seq
  FROM channels c
  WHERE NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = c.id AND e.type LIKE 'delivery.%'
    AND CASE WHEN json_valid(e.payload) THEN
      json_extract(e.payload, '$.delivery.channel.url') = json_extract(c.channel, '$.url')
      AND json_extract(e.payload, '$.delivery.channel.secretRef') IS json_extract(c.channel, '$.secretRef') ELSE 0 END)
)
INSERT INTO run_events (run_id, seq, ts, type, node_id, payload)
SELECT id, last_seq + ordinal, ts, 'delivery.attempt_finished', NULL,
  json_object('delivery', json_object('id', id || ':webhook:' || ordinal,
    'channel', json(channel), 'status', 'pending', 'attempts', 1, 'maxAttempts', 5,
    'inFlight', json('false'), 'acknowledgement', 'unknown', 'effectMayHaveHappened', json('true'),
    'lastError', json_object('code', 'interrupted', 'message',
      'Pre-upgrade return has no acknowledgement record; the effect may have happened.',
      'retryable', json('true'), 'acknowledgement', 'unknown')))
FROM pending;
--> statement-breakpoint
UPDATE runs SET last_event_seq = (SELECT MAX(seq) FROM run_events WHERE run_id = runs.id)
WHERE id IN (SELECT run_id FROM run_events WHERE type LIKE 'delivery.%');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `run_events_delivery_idx` ON `run_events` (`run_id`, `type`, `seq`);
