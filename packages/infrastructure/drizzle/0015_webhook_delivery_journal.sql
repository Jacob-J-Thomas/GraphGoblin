-- One-off conversion of completed webhook returns to the final journal shape (#246).
-- No attempt-start evidence is invented; the old record proves only one completed attempt.
-- Invalid history stays untouched for diagnostics. Non-webhook return events are unchanged.
UPDATE run_events SET
  payload = json_object('delivery', json(CASE type WHEN 'return.delivered' THEN
    json_object('id', run_id || ':return:' || seq,
      'channel', json_extract(payload, '$.channel'), 'status', 'delivered',
      'attempts', 1, 'maxAttempts', 1, 'inFlight', json('false'),
      'acknowledgement', 'accepted', 'effectMayHaveHappened', json('true'),
      'acknowledgementUncertain', json('false'))
    ELSE json_object('id', run_id || ':return:' || seq,
      'channel', json_extract(payload, '$.channel'), 'status', 'failed',
      'attempts', 1, 'maxAttempts', 1, 'inFlight', json('false'),
      'acknowledgement', 'unknown', 'effectMayHaveHappened', json('true'),
      'acknowledgementUncertain', json('true'),
      'lastError', json_object('code', 'historical_failure',
        'message', json_extract(payload, '$.error'), 'retryable', json('false'), 'acknowledgement', 'unknown')) END)),
  type = 'delivery.finished'
WHERE type IN ('return.delivered', 'return.failed')
  AND CASE WHEN json_valid(payload) THEN
    json_type(payload) = 'object'
    AND json_type(payload, '$.channel') = 'object'
    AND json_extract(payload, '$.channel.kind') = 'webhook'
    AND json_type(payload, '$.channel.url') = 'text'
    -- Validate the entire historical payload, including optional fields, bounds and strict keys.
    -- A null optional is damaged too; never strip it or unknown evidence during conversion.
    AND (json_type(payload, '$.channel.secretRef') IS NULL OR
      (json_type(payload, '$.channel.secretRef') = 'text' AND length(json_extract(payload, '$.channel.secretRef')) <= 128))
    AND NOT EXISTS (SELECT 1 FROM json_each(payload, '$.channel') WHERE key NOT IN ('kind', 'url', 'secretRef'))
    AND (SELECT count(*) = count(DISTINCT key) FROM json_each(payload, '$.channel'))
    AND (SELECT count(*) = count(DISTINCT key) FROM json_each(payload))
    AND CASE type WHEN 'return.delivered' THEN
      NOT EXISTS (SELECT 1 FROM json_each(payload) WHERE key NOT IN ('channel', 'target'))
      AND (json_type(payload, '$.target') IS NULL OR
        (json_type(payload, '$.target') = 'text' AND length(json_extract(payload, '$.target')) <= 4096))
    ELSE
      NOT EXISTS (SELECT 1 FROM json_each(payload) WHERE key NOT IN ('channel', 'error'))
      AND json_type(payload, '$.error') = 'text' AND length(json_extract(payload, '$.error')) <= 4000
    END ELSE 0 END;
--> statement-breakpoint
-- Allocate identities once for old unfinalized terminal runs that have not recorded a return.
-- The old first attempt may have happened: conservatively consume it as unknown, never not_sent.
WITH finished AS (
  SELECT r.id, r.initial_thread, v.definition, COALESCE(r.finished_at, r.created_at) AS ts,
    (SELECT node_id FROM run_events WHERE run_id = r.id AND type = 'exit.evaluated' ORDER BY seq DESC LIMIT 1) AS exit_id
  FROM runs r JOIN loop_versions v ON v.id = r.version_id
  WHERE r.finalized_at IS NULL
    AND json_valid(r.initial_thread) AND json_valid(v.definition)
    -- json_each exposes strings as bare SQL text. Never extract JSON from an untyped entry,
    -- or allocate work for a run whose defaults need per-run HISTORY_UNREADABLE diagnostics.
    AND CASE WHEN json_valid(r.initial_thread) THEN
      json_type(r.initial_thread) = 'object' AND json_type(r.initial_thread, '$.invocation') = 'object'
      AND (json_type(r.initial_thread, '$.invocation.returnDefaults') IS NULL OR
        (json_type(r.initial_thread, '$.invocation.returnDefaults') = 'array' AND
          NOT EXISTS (SELECT 1 FROM json_each(r.initial_thread, '$.invocation.returnDefaults') c
            WHERE CASE WHEN c.type = 'object' THEN
              json_type(c.value, '$.kind') IS NOT 'text' OR
              (json_extract(c.value, '$.kind') = 'webhook' AND json_type(c.value, '$.url') IS NOT 'text')
            ELSE 1 END))) ELSE 0 END
    AND EXISTS (SELECT 1 FROM run_events e WHERE e.run_id = r.id AND e.type = 'run.finished'
      -- The terminal event can be durable while the row still says running. Ignore an old
      -- completion superseded by a resume/start or another terminal event.
      AND e.seq = (SELECT MAX(seq) FROM run_events WHERE run_id = r.id
        AND type IN ('run.finished', 'run.failed', 'run.cancelled', 'run.resumed', 'run.started'))
      AND CASE WHEN json_valid(e.payload) THEN json_type(e.payload, '$.result') IS NOT NULL ELSE 0 END)
), channels AS (
  SELECT f.id, f.ts, c.value AS channel FROM finished f,
    json_each(CASE WHEN json_type(f.definition, '$.nodes') = 'array' THEN json_extract(f.definition, '$.nodes') ELSE '[]' END) n,
    json_each(CASE WHEN n.type = 'object' THEN
      CASE WHEN json_type(n.value, '$.config.destinations') = 'array' THEN json_extract(n.value, '$.config.destinations') ELSE '[]' END
      ELSE '[]' END) c
  WHERE CASE WHEN n.type = 'object' AND c.type = 'object' THEN
    json_extract(n.value, '$.id') = f.exit_id AND json_extract(c.value, '$.kind') = 'webhook'
    AND json_type(c.value, '$.url') = 'text' ELSE 0 END
  UNION
  SELECT f.id, f.ts, c.value FROM finished f, json_each(f.initial_thread, '$.invocation.returnDefaults') c
  WHERE CASE WHEN c.type = 'object' THEN json_extract(c.value, '$.kind') = 'webhook'
    AND json_type(c.value, '$.url') = 'text' ELSE 0 END
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
    'acknowledgementUncertain', json('true'),
    'lastError', json_object('code', 'interrupted', 'message',
      'Pre-upgrade return has no acknowledgement record; the effect may have happened.',
      'retryable', json('true'), 'acknowledgement', 'unknown')))
FROM pending;
--> statement-breakpoint
UPDATE runs SET last_event_seq = (SELECT MAX(seq) FROM run_events WHERE run_id = runs.id)
WHERE id IN (SELECT run_id FROM run_events WHERE type LIKE 'delivery.%');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `run_events_delivery_idx` ON `run_events` (`run_id`, `type`, `seq`);
