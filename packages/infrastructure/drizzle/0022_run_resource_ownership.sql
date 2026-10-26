CREATE TABLE `run_resource_uses` (
	`run_id` text NOT NULL,
	`key` text NOT NULL,
	`path` text NOT NULL,
	PRIMARY KEY(`run_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `run_resource_uses_key_idx` ON `run_resource_uses` (`key`);--> statement-breakpoint
CREATE TABLE `run_resources` (
	`key` text PRIMARY KEY NOT NULL,
	`owner_run_id` text NOT NULL,
	`kind` text NOT NULL,
	`path` text NOT NULL,
	`identity` text NOT NULL,
	`physical_path` text,
	`approval` text,
	`pending` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `run_resources_owner_idx` ON `run_resources` (`owner_run_id`);--> statement-breakpoint
CREATE INDEX `run_resources_pending_idx` ON `run_resources` (`pending`,`key`);--> statement-breakpoint
CREATE TABLE `workspace_reference_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`epoch` integer DEFAULT 0 NOT NULL,
	`sweeping` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_references` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`version_id` text,
	`path` text,
	`physical_path` text,
	`checked_epoch` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_references_physical_idx` ON `workspace_references` (`physical_path`);--> statement-breakpoint
CREATE INDEX `workspace_references_run_idx` ON `workspace_references` (`run_id`);--> statement-breakpoint
CREATE INDEX `workspace_references_version_idx` ON `workspace_references` (`version_id`);--> statement-breakpoint
CREATE INDEX `workspace_references_epoch_idx` ON `workspace_references` (`checked_epoch`,`id`);
--> statement-breakpoint
INSERT INTO workspace_reference_state(id, epoch, sweeping) VALUES (1, 0, 0);
--> statement-breakpoint
-- All source changes are transactional; filesystem observations are application-side.
CREATE TRIGGER workspace_version_insert AFTER INSERT ON loop_versions
WHEN json_valid(NEW.definition) AND json_extract(NEW.definition, '$.settings.workingDirectory.kind') = 'fixed'
BEGIN
  INSERT INTO workspace_references(id, version_id, path)
  VALUES ('version:' || NEW.id, NEW.id, json_extract(NEW.definition, '$.settings.workingDirectory.path'));
END;
--> statement-breakpoint
CREATE TRIGGER workspace_version_change AFTER UPDATE OF definition ON loop_versions
WHEN NEW.definition IS NOT OLD.definition
BEGIN
  DELETE FROM workspace_references WHERE version_id = NEW.id;
  INSERT INTO workspace_references(id, version_id, path)
    SELECT 'version:' || NEW.id, NEW.id, json_extract(NEW.definition, '$.settings.workingDirectory.path')
    WHERE json_valid(NEW.definition) AND json_extract(NEW.definition, '$.settings.workingDirectory.kind') = 'fixed';
END;
--> statement-breakpoint
CREATE TRIGGER workspace_version_delete AFTER DELETE ON loop_versions
BEGIN DELETE FROM workspace_references WHERE version_id = OLD.id; END;
--> statement-breakpoint
CREATE TRIGGER workspace_use_insert AFTER INSERT ON run_resource_uses
WHEN NEW.key LIKE 'workspace:%'
BEGIN
  INSERT INTO workspace_references(id, run_id, path)
    VALUES ('use:' || NEW.run_id || ':' || NEW.key, NEW.run_id, NEW.path);
  DELETE FROM workspace_references WHERE id = 'pending:' || NEW.run_id;
END;
--> statement-breakpoint
CREATE TRIGGER workspace_use_delete AFTER DELETE ON run_resource_uses
WHEN OLD.key LIKE 'workspace:%'
BEGIN DELETE FROM workspace_references WHERE id = 'use:' || OLD.run_id || ':' || OLD.key; END;
--> statement-breakpoint
CREATE TRIGGER workspace_run_insert AFTER INSERT ON runs
BEGIN
  INSERT INTO workspace_references(id, run_id)
    SELECT 'pending:' || NEW.id, NEW.id FROM loop_versions
    WHERE id = NEW.version_id AND json_valid(definition)
      AND json_extract(definition, '$.settings.workingDirectory.kind') = 'template';
END;
--> statement-breakpoint
CREATE TRIGGER workspace_run_version AFTER UPDATE OF version_id ON runs
WHEN NEW.version_id IS NOT OLD.version_id
BEGIN
  DELETE FROM workspace_references WHERE id = 'pending:' || NEW.id;
  INSERT INTO workspace_references(id, run_id)
    SELECT 'pending:' || NEW.id, NEW.id FROM loop_versions
    WHERE id = NEW.version_id AND json_valid(definition)
      AND json_extract(definition, '$.settings.workingDirectory.kind') = 'template'
      AND NOT EXISTS (SELECT 1 FROM run_resource_uses WHERE run_id = NEW.id AND key LIKE 'workspace:%');
END;
--> statement-breakpoint
CREATE TRIGGER workspace_run_delete AFTER DELETE ON runs
BEGIN DELETE FROM workspace_references WHERE run_id = OLD.id; END;
--> statement-breakpoint
-- Existing configurations remain protected until their physical paths are observed.
INSERT INTO workspace_references(id, version_id, path)
  SELECT 'version:' || id, id, json_extract(definition, '$.settings.workingDirectory.path') FROM loop_versions
  WHERE json_valid(definition) AND json_extract(definition, '$.settings.workingDirectory.kind') = 'fixed';
--> statement-breakpoint
INSERT INTO workspace_references(id, run_id)
  SELECT 'pending:' || r.id, r.id FROM runs r JOIN loop_versions v ON v.id = r.version_id
  WHERE json_valid(v.definition) AND json_extract(v.definition, '$.settings.workingDirectory.kind') = 'template';
