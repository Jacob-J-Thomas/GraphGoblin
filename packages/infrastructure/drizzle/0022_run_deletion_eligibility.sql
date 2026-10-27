ALTER TABLE `runs` ADD `deletion_approval` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `deletion_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `runs` ADD `replay_source_run_id` text;
--> statement-breakpoint
-- One-time backfill, not work performed by execution/event writes.
UPDATE runs SET replay_source_run_id = CASE WHEN json_valid(initial_thread)
  THEN json_extract(initial_thread, '$.invocation.replayOf.runId') END;
--> statement-breakpoint
CREATE INDEX `runs_replay_source_idx` ON `runs` (`replay_source_run_id`);
--> statement-breakpoint
CREATE INDEX `runs_deletion_approval_idx` ON `runs` (`deletion_approval`);
--> statement-breakpoint
-- Revisions prevent an approve/withdraw cycle from reviving an older preview token.
CREATE TRIGGER runs_deletion_revision AFTER UPDATE OF deletion_approval ON runs
WHEN OLD.deletion_approval IS NOT NEW.deletion_approval
BEGIN
  UPDATE runs SET deletion_revision = deletion_revision + 1 WHERE id = NEW.id;
END;
--> statement-breakpoint
-- The application records replay provenance on insert. A thread relationship edit
-- synchronizes just that row; ordinary event appends never parse thread JSON.
CREATE TRIGGER runs_replay_source_update AFTER UPDATE OF initial_thread ON runs
WHEN OLD.initial_thread IS NOT NEW.initial_thread
BEGIN
  UPDATE runs SET replay_source_run_id = CASE WHEN json_valid(NEW.initial_thread)
    THEN json_extract(NEW.initial_thread, '$.invocation.replayOf.runId') END
    WHERE id = NEW.id;
END;
--> statement-breakpoint
-- Approved components are complete. Admission needs only parent/source PK probes
-- before walking the affected component using the parent and replay indexes.
CREATE TRIGGER runs_deletion_dependency_insert AFTER INSERT ON runs
WHEN EXISTS (SELECT 1 FROM runs WHERE id IN (NEW.parent_run_id, NEW.replay_source_run_id) AND deletion_approval IS NOT NULL)
BEGIN
  UPDATE runs SET deletion_approval = NULL WHERE id IN (
    WITH RECURSIVE related(id) AS (
      SELECT NEW.id
      UNION SELECT r.parent_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.parent_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.parent_run_id = related.id
      UNION SELECT r.replay_source_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.replay_source_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.replay_source_run_id = related.id
    ) SELECT id FROM related
  ) AND deletion_approval IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER runs_deletion_relationship AFTER UPDATE OF parent_run_id, replay_source_run_id ON runs
WHEN (OLD.parent_run_id IS NOT NEW.parent_run_id OR OLD.replay_source_run_id IS NOT NEW.replay_source_run_id)
  AND (OLD.deletion_approval IS NOT NULL OR EXISTS (
    SELECT 1 FROM runs WHERE id IN (OLD.parent_run_id, OLD.replay_source_run_id, NEW.parent_run_id, NEW.replay_source_run_id)
      AND deletion_approval IS NOT NULL))
BEGIN
  UPDATE runs SET deletion_approval = NULL WHERE id IN (
    WITH RECURSIVE related(id) AS (
      SELECT NEW.id UNION SELECT OLD.parent_run_id WHERE OLD.parent_run_id IS NOT NULL UNION SELECT OLD.replay_source_run_id WHERE OLD.replay_source_run_id IS NOT NULL
      UNION SELECT r.parent_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.parent_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.parent_run_id = related.id
      UNION SELECT r.replay_source_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.replay_source_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.replay_source_run_id = related.id
    ) SELECT id FROM related
  ) AND deletion_approval IS NOT NULL;
END;
--> statement-breakpoint
-- No global approval query: an unrelated append checks only OLD's nullable value.
-- Besides Resume, editing already-approved evidence withdraws its component's consent.
CREATE TRIGGER runs_deletion_activity AFTER UPDATE OF status, finalized_at, last_event_seq ON runs
WHEN OLD.deletion_approval IS NOT NULL AND
  (OLD.status IS NOT NEW.status OR OLD.finalized_at IS NOT NEW.finalized_at OR OLD.last_event_seq IS NOT NEW.last_event_seq)
BEGIN
  UPDATE runs SET deletion_approval = NULL WHERE id IN (
    WITH RECURSIVE related(id) AS (
      SELECT NEW.id
      UNION SELECT r.parent_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.parent_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.parent_run_id = related.id
      UNION SELECT r.replay_source_run_id FROM runs r JOIN related ON r.id = related.id WHERE r.replay_source_run_id IS NOT NULL
      UNION SELECT r.id FROM runs r JOIN related ON r.replay_source_run_id = related.id
    ) SELECT id FROM related
  ) AND deletion_approval IS NOT NULL;
END;
