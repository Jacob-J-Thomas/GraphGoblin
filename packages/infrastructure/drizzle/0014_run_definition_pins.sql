ALTER TABLE `runs` ADD `pinned` text;--> statement-breakpoint
CREATE INDEX `runs_version_idx` ON `runs` (`version_id`);--> statement-breakpoint
-- ADR-0041: a run pins an immutable definition record. Runs started from a draft referenced the
-- editable draft row; freeze that row once, as it is now, into a snapshot named by the run's id.
INSERT INTO loop_versions (id, loop_id, version, status, definition, created_at, published_at)
SELECT r.id, v.loop_id, v.version, 'snapshot', v.definition, r.created_at, NULL
FROM runs r JOIN loop_versions v ON v.id = r.version_id
WHERE v.status = 'draft';--> statement-breakpoint
UPDATE runs SET version_id = id
WHERE EXISTS (SELECT 1 FROM loop_versions s WHERE s.id = runs.id AND s.status = 'snapshot');--> statement-breakpoint
UPDATE runs SET
  initial_thread = json_set(initial_thread, '$.run.versionId', version_id),
  thread_snapshot = CASE WHEN thread_snapshot IS NULL THEN NULL
    ELSE json_set(thread_snapshot, '$.run.versionId', version_id) END
WHERE version_id = id;--> statement-breakpoint
UPDATE run_events SET payload = json_set(payload, '$.initialThread.run.versionId', run_id)
WHERE type = 'run.queued' AND json_type(payload, '$.initialThread') IS NOT NULL
  AND run_id IN (SELECT id FROM runs WHERE version_id = id);--> statement-breakpoint
-- Describe every pin. Inherited defaults: the owner's current Settings defaults and no process
-- defaults, because GG_DEFAULTS is not stored (see the CHANGELOG upgrade note).
UPDATE runs SET pinned = (
  SELECT json_object(
    'source', CASE v.status WHEN 'published' THEN 'published' ELSE 'draft' END,
    'version', v.version,
    'name', json_extract(v.definition, '$.name'),
    'label', json_extract(v.definition, '$.name')
      || CASE v.status WHEN 'published' THEN ' v' ELSE ' draft v' END || v.version,
    'defaults', json_object(
      'owner', json(COALESCE(
        (SELECT s.value FROM settings s WHERE s.owner_id = runs.owner_id AND s.key = 'defaults'),
        '{"byHarness":{}}')),
      'process', json('{"byHarness":{}}')))
  FROM loop_versions v WHERE v.id = runs.version_id);--> statement-breakpoint
UPDATE run_events SET payload = json_set(payload,
  '$.versionId', (SELECT r.version_id FROM runs r WHERE r.id = run_events.run_id),
  '$.pinned', json((SELECT r.pinned FROM runs r WHERE r.id = run_events.run_id)))
WHERE type = 'run.queued';--> statement-breakpoint
-- Saved webhook admission intents carry the run they will create; pin it the same way.
UPDATE webhook_receipts SET intent = json_set(intent, '$.run.pinned', json((
  SELECT json_object(
    'source', CASE v.status WHEN 'published' THEN 'published' ELSE 'draft' END,
    'version', v.version,
    'name', json_extract(v.definition, '$.name'),
    'label', json_extract(v.definition, '$.name')
      || CASE v.status WHEN 'published' THEN ' v' ELSE ' draft v' END || v.version,
    'defaults', json_object(
      'owner', json(COALESCE(
        (SELECT s.value FROM settings s
          WHERE s.owner_id = json_extract(webhook_receipts.intent, '$.run.ownerId')
            AND s.key = 'defaults'),
        '{"byHarness":{}}')),
      'process', json('{"byHarness":{}}')))
  FROM loop_versions v WHERE v.id = json_extract(webhook_receipts.intent, '$.run.versionId'))))
WHERE intent IS NOT NULL;--> statement-breakpoint
UPDATE webhook_receipts SET intent = json_set(intent,
  '$.queued.versionId', json_extract(intent, '$.run.versionId'),
  '$.queued.pinned', json(json_extract(intent, '$.run.pinned')))
WHERE intent IS NOT NULL;--> statement-breakpoint
-- A draft snapshot never changes, and is not deleted while a run pins it.
CREATE TRIGGER `loop_versions_snapshot_immutable` BEFORE UPDATE ON `loop_versions`
WHEN OLD.status = 'snapshot'
BEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_IMMUTABLE: a draft snapshot never changes'); END;--> statement-breakpoint
CREATE TRIGGER `loop_versions_snapshot_pinned` BEFORE DELETE ON `loop_versions`
WHEN OLD.status = 'snapshot' AND EXISTS (SELECT 1 FROM runs WHERE runs.version_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'LOOP_VERSION_SNAPSHOT_PINNED: a run still pins this draft snapshot'); END;
