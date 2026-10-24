-- ADR-0047: pin effective execution limits once. Definitions retain omitted-setting defaults.
-- Damaged JSON stays byte-identical for the existing run diagnostics.
UPDATE runs SET pinned = json_set(pinned, '$.limits', json((
  SELECT json_object(
    'maxNodeVisits', CASE WHEN json_type(v.definition, '$.settings.maxNodeVisits') IS NULL
      THEN 10 ELSE json_extract(v.definition, '$.settings.maxNodeVisits') END,
    'runDeadlineSeconds', CASE WHEN json_type(v.definition, '$.settings.runDeadlineSeconds') IS NULL
      THEN NULL ELSE json_extract(v.definition, '$.settings.runDeadlineSeconds') END)
  FROM loop_versions v WHERE v.id = runs.version_id AND json_valid(v.definition))))
WHERE CASE WHEN json_valid(pinned) THEN json_type(pinned) = 'object'
  AND json_type(pinned, '$.limits') IS NULL ELSE 0 END
  AND EXISTS (SELECT 1 FROM loop_versions v WHERE v.id = runs.version_id AND json_valid(v.definition));
--> statement-breakpoint
UPDATE run_events SET payload = json_set(payload, '$.pinned.limits', json((
  SELECT json_extract(r.pinned, '$.limits') FROM runs r WHERE r.id = run_events.run_id)))
WHERE type = 'run.queued' AND CASE WHEN json_valid(payload)
  THEN json_type(payload, '$.pinned') = 'object' AND json_type(payload, '$.pinned.limits') IS NULL ELSE 0 END
  AND EXISTS (SELECT 1 FROM runs r WHERE r.id = run_events.run_id
    AND CASE WHEN json_valid(r.pinned) THEN json_type(r.pinned, '$.limits') = 'object' ELSE 0 END);
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.run.pinned.limits', json((
  SELECT json_object(
    'maxNodeVisits', CASE WHEN json_type(v.definition, '$.settings.maxNodeVisits') IS NULL
      THEN 10 ELSE json_extract(v.definition, '$.settings.maxNodeVisits') END,
    'runDeadlineSeconds', CASE WHEN json_type(v.definition, '$.settings.runDeadlineSeconds') IS NULL
      THEN NULL ELSE json_extract(v.definition, '$.settings.runDeadlineSeconds') END)
  FROM loop_versions v WHERE v.id = json_extract(intent, '$.run.versionId') AND json_valid(v.definition))))
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.run.pinned') = 'object'
  AND json_type(intent, '$.run.pinned.limits') IS NULL
  AND EXISTS (SELECT 1 FROM loop_versions v WHERE v.id = json_extract(intent, '$.run.versionId')
    AND json_valid(v.definition)) ELSE 0 END;

--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.queued.pinned.limits',
  json(json_extract(intent, '$.run.pinned.limits')))
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.queued.pinned') = 'object'
  AND json_type(intent, '$.queued.pinned.limits') IS NULL
  AND json_type(intent, '$.run.pinned.limits') = 'object' ELSE 0 END;
