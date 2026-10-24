-- ADR-0051 / #270: materialize additive null deadline defaults once.
-- 0018 and 0019 are reserved for WP-D4 and WP-C7; this data-only migration uses 0020.
-- Preserve authored finite/null/invalid values and malformed JSON for existing diagnostics.
-- The migrator transaction restores snapshot protection atomically with the rewrite.
DROP TRIGGER loop_versions_snapshot_immutable;
--> statement-breakpoint
UPDATE loop_versions SET definition = json_set(definition, '$.settings.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(definition) THEN json_extract(definition, '$.schemaVersion') = 4 AND json_type(definition, '$.settings') = 'object'
  AND json_type(definition, '$.settings.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE loop_versions SET definition = json_set(definition, '$.settings.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(definition) THEN json_extract(definition, '$.schemaVersion') = 4 AND json_type(definition, '$.settings') = 'object'
  AND json_type(definition, '$.settings.runDeadlineSeconds') IS NULL ELSE 0 END;
--> statement-breakpoint
CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`
WHEN OLD.status = 'snapshot'
BEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END;
--> statement-breakpoint
UPDATE runs SET pinned = json_set(pinned, '$.limits.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(pinned) THEN json_type(pinned, '$.limits') = 'object'
  AND json_type(pinned, '$.limits.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE run_events SET payload = json_set(payload, '$.pinned.limits.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(payload) THEN type = 'run.queued' AND json_type(payload, '$.pinned.limits') = 'object'
  AND json_type(payload, '$.pinned.limits.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.run.pinned.limits.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.run.pinned.limits') = 'object'
  AND json_type(intent, '$.run.pinned.limits.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.queued.pinned.limits.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.queued.pinned.limits') = 'object'
  AND json_type(intent, '$.queued.pinned.limits.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.snapshot.definition.settings.structuredTimeoutMs', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_extract(intent, '$.snapshot.definition.schemaVersion') = 4 AND json_type(intent, '$.snapshot.definition.settings') = 'object'
  AND json_type(intent, '$.snapshot.definition.settings.structuredTimeoutMs') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE runs SET pinned = json_set(pinned, '$.limits.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(pinned) THEN json_type(pinned, '$.limits') = 'object'
  AND json_type(pinned, '$.limits.runDeadlineSeconds') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE run_events SET payload = json_set(payload, '$.pinned.limits.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(payload) THEN type = 'run.queued' AND json_type(payload, '$.pinned.limits') = 'object'
  AND json_type(payload, '$.pinned.limits.runDeadlineSeconds') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.run.pinned.limits.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.run.pinned.limits') = 'object'
  AND json_type(intent, '$.run.pinned.limits.runDeadlineSeconds') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.queued.pinned.limits.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_type(intent, '$.queued.pinned.limits') = 'object'
  AND json_type(intent, '$.queued.pinned.limits.runDeadlineSeconds') IS NULL ELSE 0 END;
--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent, '$.snapshot.definition.settings.runDeadlineSeconds', NULL)
WHERE CASE WHEN json_valid(intent) THEN json_extract(intent, '$.snapshot.definition.schemaVersion') = 4 AND json_type(intent, '$.snapshot.definition.settings') = 'object'
  AND json_type(intent, '$.snapshot.definition.settings.runDeadlineSeconds') IS NULL ELSE 0 END;
